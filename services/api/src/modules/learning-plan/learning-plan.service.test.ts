import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import { buildQuestion } from '@qitu/ai-client';
import type { CurrentUser, LearningPlanView } from '@qitu/contracts';
import type { AuditEntry } from '../../common/audit/audit-entry';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import type { OutboxEventInput } from '../../common/outbox/outbox.types';
import { OutboxWriter } from '../../common/outbox/outbox.service';
import type { AccessPolicy } from '../../common/access/access-policy';
import {
  InMemoryLearningPlanStore,
  type MasteryObjectiveMappingRecord,
} from './learning-plan.store';
import { LearningPlanService, assertGeneratePlanInput } from './learning-plan.service';
import type { TeamRuntimeService } from '../team-runtime/team-runtime.service';
import {
  assertNoServerOwnedFields,
  DeterministicPlanGenerator,
  PlanGenerationError,
  type GeneratePlanInput,
  type GeneratedPlan,
} from './plan-generator';
import { validateGeneratedPlan } from './session-plan-validator';

/* ------------------------------------------------------------------ *
 * 测试替身（语义与真实实现一致：同键同载荷重放，同键异载荷冲突）
 * ------------------------------------------------------------------ */

class FakeIdempotencyStore {
  private readonly records = new Map<string, { hash: string; body: unknown; status: number }>();
  executions = 0;

  async execute<T>(
    scope: string,
    key: string,
    requestHash: string,
    handler: () => Promise<{ status?: number; body: T }>,
  ): Promise<{ status: number; body: T; replayed: boolean }> {
    const id = `${scope}::${key}`;
    const existing = this.records.get(id);
    if (existing !== undefined) {
      if (existing.hash !== requestHash) {
        throw new IdempotencyError('IDEMPOTENCY_CONFLICT', 'conflict');
      }
      return { status: existing.status, body: existing.body as T, replayed: true };
    }
    this.executions += 1;
    const outcome = await handler();
    this.records.set(id, { hash: requestHash, body: outcome.body, status: outcome.status ?? 200 });
    return { status: outcome.status ?? 200, body: outcome.body, replayed: false };
  }
}

class FakeAuditWriter {
  readonly entries: AuditEntry[] = [];
  async write(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  count(action: string): number {
    return this.entries.filter((entry) => entry.action === action).length;
  }
}

class FakeOutboxWriter {
  readonly events: OutboxEventInput[] = [];
  async write(event: OutboxEventInput): Promise<string> {
    this.events.push(event);
    return event.id;
  }
  async markPublished(): Promise<void> {}
  async markFailed(): Promise<void> {}
}

/** 只允许「当前在带」的班主任读；管理员 fail-closed。 */
class FakeAccessPolicy {
  mentorOf = new Set<string>();
  async canReadStudent(actor: CurrentUser, studentId: string): Promise<boolean> {
    if (actor.role === 'student') return actor.id === studentId;
    if (actor.role !== 'teacher') return false;
    return this.mentorOf.has(`${actor.id}::${studentId}`);
  }
}

class FailingAssessmentStore extends InMemoryLearningPlanStore {
  override async appendMasteryEvent(_event: Parameters<InMemoryLearningPlanStore['appendMasteryEvent']>[0]): Promise<void> {
    throw new Error('assessment transaction failure');
  }
}

interface Harness {
  service: LearningPlanService;
  store: InMemoryLearningPlanStore;
  idempotency: FakeIdempotencyStore;
  audit: FakeAuditWriter;
  outbox: FakeOutboxWriter;
  access: FakeAccessPolicy;
  teamRuntime: FakeTeamRuntime;
}

/**
 * 门禁桥的替身：只记录调用参数与返回状态。门禁事件 / 审计 / 账本的去重是
 * `TeamRuntimeService.recordGateForStudent` 自己的职责（见
 * `team-runtime.gate.test.ts` 的 T26），这里只验证「本服务在正确时机、用正确
 * 参数递交了一次证据」。
 */
class FakeTeamRuntime {
  readonly calls: Array<{ studentUserId: string; gate: string; evidenceRef: string; source: string }> = [];
  status: 'recorded' | 'already_satisfied' | 'deferred' = 'recorded';
  failWith: Error | null = null;

  async recordGateForStudent(input: {
    studentUserId: string;
    gate: string;
    evidenceRef: string;
    source: string;
  }): Promise<{ status: 'recorded' | 'already_satisfied' | 'deferred'; runId: string | null; gate: string }> {
    this.calls.push({ ...input });
    if (this.failWith !== null) throw this.failWith;
    return { status: this.status, runId: null, gate: input.gate };
  }
}

function makeHarness(
  generator: DeterministicPlanGenerator = new DeterministicPlanGenerator(),
  store: InMemoryLearningPlanStore = new InMemoryLearningPlanStore(),
): Harness {
  const idempotency = new FakeIdempotencyStore();
  const audit = new FakeAuditWriter();
  const outbox = new FakeOutboxWriter();
  const access = new FakeAccessPolicy();
  const teamRuntime = new FakeTeamRuntime();
  const service = new LearningPlanService(
    store,
    generator,
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter,
    outbox as unknown as OutboxWriter,
    access as unknown as AccessPolicy,
    undefined,
    teamRuntime as unknown as TeamRuntimeService,
  );
  return { service, store, idempotency, audit, outbox, access, teamRuntime };
}

function student(id: string): CurrentUser {
  return { id, email: `${id}@example.com`, displayName: id, role: 'student' };
}

function teacher(id: string): CurrentUser {
  return { id, email: `${id}@example.com`, displayName: id, role: 'teacher' };
}

async function assertHttpError(
  fn: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(fn, (error: unknown) => {
    const httpError = error as { getStatus?: () => number; getResponse?: () => unknown };
    assert.equal(httpError.getStatus?.(), status);
    const response = httpError.getResponse?.() as { code?: string } | undefined;
    assert.equal(response?.code, code);
    return true;
  });
}

function flattenObjectives(plan: LearningPlanView): Array<{
  id: string;
  name: string;
  type: 'memory' | 'concept' | 'procedure' | 'design';
}> {
  return plan.modules.flatMap((module) =>
    module.objectives.map((objective) => ({
      id: objective.id,
      name: objective.name,
      type: objective.type,
    })),
  );
}

/**
 * 驱动学生把当前会话的目标答到达标：每轮先读 `next-step` 拿题，再用同一目标
 * + 同一序号重建服务端题面取标准答案（测试与服务端共享确定性题库）。
 */
async function submitCorrectAnswer(
  harness: Harness,
  user: CurrentUser,
  plan: LearningPlanView,
  sessionId: string,
  key: string,
): Promise<{ theoryMastered: boolean }> {
  const next = await harness.service.getNextStep(user, plan.id, sessionId);
  assert.ok(next.question, '应下发题面');
  assert.ok(next.objectiveId, '应指向目标');
  const question = next.question;
  const index = Number(question.questionId.slice(question.questionId.lastIndexOf('-') + 1));
  const objective = flattenObjectives(plan).find((item) => item.id === next.objectiveId);
  assert.ok(objective, `目标 ${next.objectiveId} 必须存在`);
  const card = buildQuestion({
    objective: { id: objective.id, name: objective.name, type: objective.type },
    index,
    seed: objective.id,
  });
  const response = await harness.service.submitAnswer(
    user,
    plan.id,
    sessionId,
    { questionId: question.questionId, answer: card.expectedAnswer },
    key,
  );
  return { theoryMastered: response.theoryMastered };
}

/* ------------------------------------------------------------------ *
 * 用例
 * ------------------------------------------------------------------ */

describe('LearningPlanService（4/8 周计划 + 掌握度门禁）', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
  });

  it('生成计划只产生 draft，绝不创建项目', async () => {
    const { service, store, audit } = harness;
    const user = student('student-1');
    const generated = await service.generatePlan(user, { interest: '钢琴', weeks: 4 });

    assert.equal(generated.deduplicated, false);
    assert.equal(generated.plan.status, 'draft');
    assert.equal(generated.plan.projectId, null);
    assert.equal(generated.plan.templateVersion, 'curriculum-plan-v1');
    assert.equal(generated.plan.sessions.length, 20);
    assert.equal(generated.plan.modules.length, 4);

    const persisted = await store.findBundle(generated.plan.id);
    assert.equal(persisted?.plan.projectId, null);
    assert.equal(
      await store.findProject('proj-anything'),
      null,
      '生成阶段不允许出现任何项目行',
    );
    assert.equal(audit.count('learning_plan.generate'), 1);
  });

  it('同一签名重复生成被去重，审计只写一次', async () => {
    const { service, audit } = harness;
    const user = student('student-1');
    const first = await service.generatePlan(user, { interest: '钢琴', weeks: 8 });
    const second = await service.generatePlan(user, { interest: '钢琴', weeks: 8 });
    assert.equal(second.deduplicated, true);
    assert.equal(second.plan.id, first.plan.id);
    assert.equal(audit.count('learning_plan.generate'), 1);
  });

  it('客户端传入 stage / mastery / theoryMastered / projectId 一律被拒绝', () => {
    for (const body of [
      { interest: '钢琴', weeks: 4, stage: 'practice_building' },
      { interest: '钢琴', weeks: 4, mastery: 0.99 },
      { interest: '钢琴', weeks: 4, theoryMastered: true },
      { interest: '钢琴', weeks: 4, projectId: 'proj-x' },
      { answer: 'x', masteryBasisPoints: 10000 },
    ]) {
      assert.throws(() => assertNoServerOwnedFields(body), PlanGenerationError);
    }
    assert.doesNotThrow(() => assertNoServerOwnedFields({ interest: '钢琴', weeks: 4 }));
    // 周数只允许 4 / 8。
    assert.throws(() => assertGeneratePlanInput({ interest: '钢琴', weeks: 6 }), PlanGenerationError);
  });

  it('不可信的模型输出（结构非法）被拒绝，而不是被修复', async () => {
    class MalformedGenerator extends DeterministicPlanGenerator {
      override generate(input: GeneratePlanInput): GeneratedPlan {
        const plan = super.generate(input);
        // 破坏一节课的时长（合计 != 60），模拟模型幻觉。
        const first = plan.sessions[0];
        if (first !== undefined && first.blocks[0] !== undefined) {
          first.blocks[0].minutes = 5;
        }
        return plan;
      }
    }
    const bad = makeHarness(new MalformedGenerator());
    await assert.rejects(
      () => bad.service.generatePlan(student('student-1'), { interest: '钢琴', weeks: 4 }),
      (error: unknown) => error instanceof PlanGenerationError,
    );
    assert.equal((await bad.store.listPlansByStudent('student-1')).length, 0);
    assert.equal(validateGeneratedPlan.length > 0, true);
  });

  it('显式 PblSchedule 生成 1×120 分钟计划，并保留 TheoryMastered 结构校验', () => {
    const input = assertGeneratePlanInput({
      interest: '桌面互动机器人',
      weeks: 4,
      schedule: {
        durationWeeks: 4,
        weeklyMinutes: 120,
        sessionsPerWeek: 1,
        sessionMinutes: 120,
      },
    });
    const plan = new DeterministicPlanGenerator().generate(input);

    assert.equal(plan.schedule?.sessionsPerWeek, 1);
    assert.equal(plan.minutesPerSession, 120);
    assert.equal(plan.sessions.length, 4);
    assert.equal(plan.sessions[0]?.blocks.reduce((sum, block) => sum + block.minutes, 0), 120);
    assert.doesNotThrow(() => validateGeneratedPlan(plan));
  });

  it('显式 PblSchedule 生成 2×60 分钟计划；无 schedule 仍保持旧 5×60 语义', () => {
    const input = assertGeneratePlanInput({
      interest: 'Python',
      weeks: 8,
      schedule: {
        durationWeeks: 8,
        weeklyMinutes: 120,
        sessionsPerWeek: 2,
        sessionMinutes: 60,
      },
    });
    const scheduled = new DeterministicPlanGenerator().generate(input);
    assert.equal(scheduled.sessions.length, 16);
    assert.doesNotThrow(() => validateGeneratedPlan(scheduled));

    const legacy = new DeterministicPlanGenerator().generate(
      assertGeneratePlanInput({ interest: 'Python', weeks: 8 }),
    );
    assert.equal(legacy.schedule, undefined);
    assert.equal(legacy.sessions.length, 40);
    assert.doesNotThrow(() => validateGeneratedPlan(legacy));
  });

  it('拒绝无效或与 weeks 不一致的 PblSchedule', () => {
    assert.throws(
      () => assertGeneratePlanInput({
        interest: '机器人',
        weeks: 4,
        schedule: { durationWeeks: 8, weeklyMinutes: 120, sessionsPerWeek: 1, sessionMinutes: 120 },
      }),
      PlanGenerationError,
    );
    assert.throws(
      () => assertGeneratePlanInput({
        interest: '机器人',
        weeks: 4,
        schedule: { durationWeeks: 4, weeklyMinutes: 90, sessionsPerWeek: 1, sessionMinutes: 90 },
      }),
      PlanGenerationError,
    );
  });

  it('确认计划恰好创建一个项目；同幂等键重复确认不重复建项目、不重复审计', async () => {
    const { service, store, audit } = harness;
    const user = student('student-1');
    const generated = await service.generatePlan(user, { interest: '绘画', weeks: 4 });
    const planId = generated.plan.id;

    const first = await service.confirmPlan(user, planId, 'confirm-key-1');
    assert.equal(first.project.stage, 'intent_confirmed');
    assert.equal(first.plan.status, 'active');
    assert.equal(first.plan.projectId, first.project.id);
    assert.equal(first.replayed, false);

    const replay = await service.confirmPlan(user, planId, 'confirm-key-1');
    assert.equal(replay.replayed, true);
    assert.equal(replay.project.id, first.project.id);
    assert.equal(audit.count('learning_plan.confirm'), 1);

    // 换一个幂等键再次确认：计划已 active，仍只返回同一个项目。
    const again = await service.confirmPlan(user, planId, 'confirm-key-2');
    assert.equal(again.project.id, first.project.id);
    const project = await store.findProject(first.project.id);
    assert.ok(project);
  });

  it('TheoryMastered 之前实践接口一律 403，达标后解锁', async () => {
    const { service } = harness;
    const user = student('student-1');
    const generated = await service.generatePlan(user, { interest: '机器人', weeks: 4 });
    const confirmed = await service.confirmPlan(user, generated.plan.id, 'k-confirm');
    const plan = confirmed.plan;
    const theorySession = plan.sessions[0];
    const practiceSession = plan.sessions[1];
    assert.ok(theorySession && practiceSession);
    assert.equal(practiceSession.practiceObjectiveIds.length, 1);
    assert.equal(practiceSession.theoryMastered, false);

    await assertHttpError(
      () => service.startSession(user, plan.id, practiceSession.id),
      403,
      'THEORY_MASTERED_REQUIRED',
    );
    await assertHttpError(
      () => service.getNextStep(user, plan.id, practiceSession.id),
      403,
      'THEORY_MASTERED_REQUIRED',
    );
    await assertHttpError(
      () =>
        service.submitAnswer(
          user,
          plan.id,
          practiceSession.id,
          { questionId: 'q-x-0', answer: 'x' },
          'k-answer',
        ),
      403,
      'THEORY_MASTERED_REQUIRED',
    );

    // 三次正确作答把 memory 目标练到 0.9 门槛。
    for (let i = 0; i < 3; i += 1) {
      await submitCorrectAnswer(harness, user, plan, theorySession.id, `k-theory-${i}`);
    }
    const mastered = await service.getPlan(user, plan.id);
    assert.equal(mastered.sessions[0]?.theoryMastered, true);
    assert.equal(mastered.sessions[1]?.practiceUnlocked, true);

    const started = await service.startSession(user, plan.id, practiceSession.id);
    assert.equal(started.session.practiceUnlocked, true);
  });

  it('TheoryMastered 只在状态翻转时审计 + 发事件一次', async () => {
    const { service, audit, outbox } = harness;
    const user = student('student-1');
    const generated = await service.generatePlan(user, { interest: '园艺', weeks: 4 });
    const confirmed = await service.confirmPlan(user, generated.plan.id, 'k-confirm');
    const plan = confirmed.plan;
    const theorySession = plan.sessions[0];
    assert.ok(theorySession);

    for (let i = 0; i < 3; i += 1) {
      await submitCorrectAnswer(harness, user, plan, theorySession.id, `k-t-${i}`);
    }
    // 再答一题也不会重复触发（已掌握的目标不再作为候选）。
    assert.equal(audit.count('learning_plan.theory_mastered'), 1);
    assert.equal(outbox.events.filter((event) => event.topic === 'learning.theory_mastered').length, 1);
  });

  /* ---------------------------------------------------------------- *
   * WS2：TheoryMastered → 门禁证据桥（唯一内部通道）                  *
   * ---------------------------------------------------------------- */

  it('理论达标翻转时只递交一次门禁证据，evidenceRef 稳定为 mastery:theory:<sessionId>', async () => {
    const { service, teamRuntime, audit } = harness;
    const user = student('student-1');
    const generated = await service.generatePlan(user, { interest: '天文', weeks: 4 });
    const confirmed = await service.confirmPlan(user, generated.plan.id, 'k-confirm-gate');
    const plan = confirmed.plan;
    const theorySession = plan.sessions[0];
    assert.ok(theorySession);

    // 达标之前一个证据都不递交。
    assert.equal(teamRuntime.calls.length, 0);
    let flipKey = '';
    for (let i = 0; i < 3; i += 1) {
      flipKey = `k-gate-${i}`;
      await submitCorrectAnswer(harness, user, plan, theorySession.id, flipKey);
    }
    assert.equal(teamRuntime.calls.length, 1, '翻转只应递交一次证据');
    const call = teamRuntime.calls[0];
    assert.equal(call?.studentUserId, 'student-1');
    assert.equal(call?.gate, 'TheoryMastered');
    assert.equal(call?.source, 'learning-plan.theory-mastered');
    assert.equal(call?.evidenceRef, `mastery:theory:${theorySession.id}`);
    assert.equal(call?.evidenceRef.startsWith('mastery:theory:'), true);
    assert.notEqual(call?.evidenceRef, `theory-mastered:${theorySession.id}`, '审计键与门禁幂等域必须可区分');

    // 同一会话再答一题：状态已翻转，既不重复审计也不重复递交门禁证据。
    await submitCorrectAnswer(harness, user, plan, theorySession.id, 'k-gate-more');
    assert.equal(teamRuntime.calls.length, 1);
    assert.equal(audit.count('learning_plan.theory_mastered'), 1);
  });

  it('同键重放不再递交门禁证据（重放不执行回调，也不重复写门禁）', async () => {
    const { service, teamRuntime } = harness;
    const user = student('student-1');
    const generated = await service.generatePlan(user, { interest: '昆虫', weeks: 4 });
    const confirmed = await service.confirmPlan(user, generated.plan.id, 'k-confirm-replay');
    const plan = confirmed.plan;
    const theorySession = plan.sessions[0];
    assert.ok(theorySession);

    // 第一题：先读题面拿到题 id 与标准答案，再用固定键首次提交。
    const next = await service.getNextStep(user, plan.id, theorySession.id);
    assert.ok(next.question);
    assert.ok(next.objectiveId);
    const objective = flattenObjectives(plan).find((item) => item.id === next.objectiveId);
    assert.ok(objective);
    const question = next.question;
    const index = Number(question.questionId.slice(question.questionId.lastIndexOf('-') + 1));
    const card = buildQuestion({
      objective: { id: objective.id, name: objective.name, type: objective.type },
      index,
      seed: objective.id,
    });
    const first = await service.submitAnswer(
      user,
      plan.id,
      theorySession.id,
      { questionId: question.questionId, answer: card.expectedAnswer },
      'k-replay-fixed',
    );
    assert.equal(first.replayed, false);

    const callsAfterFirst = teamRuntime.calls.length;
    // 同键重放同一请求：命中幂等记录 → 回调不执行 → 门禁证据不得再递交。
    const replay = await service.submitAnswer(
      user,
      plan.id,
      theorySession.id,
      { questionId: question.questionId, answer: card.expectedAnswer },
      'k-replay-fixed',
    );
    assert.equal(replay.replayed, true);
    assert.equal(teamRuntime.calls.length, callsAfterFirst, '重放不得追加门禁证据递交');
  });

  it('门禁写入失败不回滚已成立的理论达标（只记 warn）', async () => {
    const { service, teamRuntime, audit, store, outbox } = harness;
    teamRuntime.failWith = new Error('gate writer unavailable');
    const user = student('student-1');
    const generated = await service.generatePlan(user, { interest: '气象', weeks: 4 });
    const confirmed = await service.confirmPlan(user, generated.plan.id, 'k-confirm-fail');
    const plan = confirmed.plan;
    const theorySession = plan.sessions[0];
    assert.ok(theorySession);

    const results: boolean[] = [];
    for (let i = 0; i < 3; i += 1) {
      results.push((await submitCorrectAnswer(harness, user, plan, theorySession.id, `k-fail-${i}`)).theoryMastered);
    }
    // 作答全部成功返回，理论达标成立，审计与出箱事件照旧只写一次。
    assert.equal(results.at(-1), true, '门禁失败不得影响作答结果');
    assert.equal(audit.count('learning_plan.theory_mastered'), 1);
    assert.equal(outbox.events.filter((event) => event.topic === 'learning.theory_mastered').length, 1);
    const mastery = await store.listMasteryForPlan('student-1', plan.id);
    assert.ok(mastery.length > 0, '掌握记录必须已落库');
  });

  it('实践证据翻转同样桥接门禁，且实践 403 保持权威分层', async () => {
    const { service, teamRuntime } = harness;
    const user = student('student-1');
    const generated = await service.generatePlan(user, { interest: '桥梁', weeks: 4 });
    const confirmed = await service.confirmPlan(user, generated.plan.id, 'k-confirm-practice');
    const plan = confirmed.plan;
    const theorySession = plan.sessions[0];
    assert.ok(theorySession);

    // 达标前实践接口 403（THEORY_MASTERED_REQUIRED），且不递交任何门禁证据。
    const practiceSession = plan.sessions[1];
    assert.ok(practiceSession);
    await assertHttpError(
      () => service.submitEvidence(user, plan.id, practiceSession.id, { objectiveId: 'x', evidenceRef: 'artifact:1' }, 'k-ev-early'),
      403,
      'THEORY_MASTERED_REQUIRED',
    );
    assert.equal(teamRuntime.calls.length, 0);

    for (let i = 0; i < 3; i += 1) {
      await submitCorrectAnswer(harness, user, plan, theorySession.id, `k-prac-${i}`);
    }
    assert.equal(teamRuntime.calls.length, 1);
    assert.equal(teamRuntime.calls[0]?.evidenceRef, `mastery:theory:${theorySession.id}`);
  });

  it('排课是去重签名的一部分：4 周 1×120 与 4 周 2×60 各得一份草稿', async () => {
    const { service, store } = harness;
    const user = student('student-1');
    const onePerWeek = await service.generatePlan(user, {
      interest: '机器人',
      weeks: 4,
      schedule: { durationWeeks: 4, weeklyMinutes: 120, sessionsPerWeek: 1, sessionMinutes: 120 },
    });
    const one = onePerWeek.plan;
    const twoPerWeek = await service.generatePlan(user, {
      interest: '机器人',
      weeks: 4,
      schedule: { durationWeeks: 4, weeklyMinutes: 120, sessionsPerWeek: 2, sessionMinutes: 60 },
    });
    const two = twoPerWeek.plan;

    assert.equal(onePerWeek.deduplicated, false);
    assert.equal(twoPerWeek.deduplicated, false, '不同排课不得被当成重复计划');
    assert.notEqual(one.id, two.id);
    assert.equal(one.sessions.length, 4);
    assert.equal(two.sessions.length, 8);
    assert.equal(one.minutesPerSession, 120);
    assert.equal(two.minutesPerSession, 60);
    assert.equal((await store.listPlansByStudent('student-1')).length, 2);

    // 同一排课重复请求 → 命中自己那份，不产生第三份。
    const again = await service.generatePlan(user, {
      interest: '机器人',
      weeks: 4,
      schedule: { durationWeeks: 4, weeklyMinutes: 120, sessionsPerWeek: 1, sessionMinutes: 120 },
    });
    assert.equal(again.deduplicated, true);
    assert.equal(again.plan.id, one.id);
    assert.equal((await store.listPlansByStudent('student-1')).length, 2);
  });

  it('显式 mapping 时写入 append-only mastery event，重复提交不重复写事件', async () => {
    const { service, store } = harness;
    const user = student('student-1');
    const plan = (
      await service.confirmPlan(
        user,
        (await service.generatePlan(user, { interest: '编程', weeks: 4 })).plan.id,
        'k-confirm',
      )
    ).plan;
    const session = plan.sessions[0];
    assert.ok(session);
    const objectiveId = session.theoryObjectiveIds[0];
    assert.ok(objectiveId);
    const mapping: MasteryObjectiveMappingRecord = {
      id: 'mapping-programming-1',
      schoolId: null,
      planId: plan.id,
      objectiveId,
      templateVersion: plan.templateVersion,
      contentVersion: plan.templateVersion,
      knowledgePointId: 'kp-programming-1',
      courseVersion: 'course-v1',
      source: 'explicit',
      mappedAt: new Date(),
    };
    await store.upsertObjectiveMapping(mapping);

    const next = await service.getNextStep(user, plan.id, session.id);
    assert.ok(next.question);
    const questionId = next.question.questionId;
    const answer = buildQuestion({
      objective: {
        id: objectiveId,
        name: flattenObjectives(plan).find((item) => item.id === objectiveId)?.name ?? '',
        type: 'memory',
      },
      index: 0,
      seed: objectiveId,
    }).expectedAnswer;
    const first = await service.submitAnswer(
      user,
      plan.id,
      session.id,
      { questionId, answer },
      'k-answer',
    );
    const replay = await service.submitAnswer(
      user,
      plan.id,
      session.id,
      { questionId, answer },
      'k-answer',
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.result, first.result);
    const events = await store.listMasteryEvents({
      studentUserId: user.id,
      knowledgePointId: mapping.knowledgePointId,
      courseVersion: mapping.courseVersion,
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.id, `mastery-event:${questionId}`);
    assert.notEqual(events[0]?.score, null);
    assert.equal(events[0]?.qualitativeMastered, null);
  });

  it('评估事务失败时回滚 pending、attempt、mastery 和 event', async () => {
    const failing = makeHarness(new DeterministicPlanGenerator(), new FailingAssessmentStore());
    const user = student('student-1');
    const plan = (
      await failing.service.confirmPlan(
        user,
        (await failing.service.generatePlan(user, { interest: '数学', weeks: 4 })).plan.id,
        'k-confirm',
      )
    ).plan;
    const session = plan.sessions[0];
    assert.ok(session);
    const objectiveId = session.theoryObjectiveIds[0];
    assert.ok(objectiveId);
    await failing.store.upsertObjectiveMapping({
      id: 'mapping-math-1',
      schoolId: null,
      planId: plan.id,
      objectiveId,
      templateVersion: plan.templateVersion,
      contentVersion: plan.templateVersion,
      knowledgePointId: 'kp-math-1',
      courseVersion: 'course-v1',
      source: 'explicit',
      mappedAt: new Date(),
    });
    const next = await failing.service.getNextStep(user, plan.id, session.id);
    assert.ok(next.question);
    await assert.rejects(
      () => failing.service.submitAnswer(user, plan.id, session.id, {
        questionId: next.question!.questionId,
        answer: buildQuestion({
          objective: { id: objectiveId, name: '数学', type: 'memory' },
          index: 0,
          seed: objectiveId,
        }).expectedAnswer,
      }, 'k-failing'),
      /assessment transaction failure/,
    );
    const pending = await failing.store.findPendingQuestion(next.question.questionId);
    assert.equal(pending?.status, 'awaiting');
    assert.equal((await failing.store.listAttempts(user.id, objectiveId)).length, 0);
    assert.equal(await failing.store.findMastery(user.id, objectiveId), null);
    assert.equal((await failing.store.listMasteryEvents({
      studentUserId: user.id,
      knowledgePointId: 'kp-math-1',
      courseVersion: 'course-v1',
    })).length, 0);
  });

  it('重试作答只产生一次 attempt，重放返回原判分', async () => {
    const { service, store } = harness;
    const user = student('student-1');
    const generated = await service.generatePlan(user, { interest: '烹饪', weeks: 4 });
    const confirmed = await service.confirmPlan(user, generated.plan.id, 'k-confirm');
    const plan = confirmed.plan;
    const theorySession = plan.sessions[0];
    assert.ok(theorySession);
    const objective = theorySession.theoryObjectiveIds[0];
    assert.ok(objective);

    const next = await service.getNextStep(user, plan.id, theorySession.id);
    assert.ok(next.question);
    const questionId = next.question.questionId;
    const card = buildQuestion({
      objective: {
        id: objective,
        name: flattenObjectives(plan).find((item) => item.id === objective)?.name ?? '',
        type: 'memory',
      },
      index: 0,
      seed: objective,
    });

    const first = await service.submitAnswer(
      user,
      plan.id,
      theorySession.id,
      { questionId, answer: '故意答错' },
      'k-answer-retry',
    );
    const replay = await service.submitAnswer(
      user,
      plan.id,
      theorySession.id,
      { questionId, answer: '故意答错' },
      'k-answer-retry',
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.result, first.result);
    assert.equal((await store.listAttempts(user.id, objective)).length, 1);
    assert.equal((await store.listMasteryEvents({
      studentUserId: user.id,
      knowledgePointId: objective,
      courseVersion: plan.templateVersion,
    })).length, 0, 'mapping 缺失时不能把 objectiveId 猜成 canonical KP');

    // 同键不同答案 → 409。
    await assertHttpError(
      () =>
        service.submitAnswer(
          user,
          plan.id,
          theorySession.id,
          { questionId, answer: card.expectedAnswer },
          'k-answer-retry',
        ),
      409,
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('跨学生访问 → 403；班主任仅在当前在带时可读', async () => {
    const { service, access } = harness;
    const owner = student('student-1');
    const stranger = student('student-2');
    const generated = await service.generatePlan(owner, { interest: '摄影', weeks: 4 });

    await assertHttpError(() => service.getPlan(stranger, generated.plan.id), 403, 'LEARNING_PLAN_FORBIDDEN');
    await assertHttpError(
      () => service.confirmPlan(stranger, generated.plan.id, 'k-x'),
      403,
      'LEARNING_PLAN_FORBIDDEN',
    );

    const mentor = teacher('teacher-1');
    await assertHttpError(() => service.getPlan(mentor, generated.plan.id), 403, 'LEARNING_PLAN_FORBIDDEN');
    access.mentorOf.add(`teacher-1::student-1`);
    const readable = await service.getPlan(mentor, generated.plan.id);
    assert.equal(readable.id, generated.plan.id);
    // 班主任不能写。
    await assertHttpError(
      () => service.confirmPlan(mentor, generated.plan.id, 'k-y'),
      403,
      'LEARNING_PLAN_FORBIDDEN',
    );
  });

  it('未知计划 → 404（不泄露存在性以外的信息）', async () => {
    await assertHttpError(
      () => harness.service.getPlan(student('student-1'), 'plan-missing'),
      404,
      'LEARNING_PLAN_NOT_FOUND',
    );
  });

  it('计划确认后不可变：模板版本与目标顺序冻结', async () => {
    const { service, store } = harness;
    const user = student('student-1');
    const generated = await service.generatePlan(user, { interest: '书法', weeks: 4 });
    const before = await store.findBundle(generated.plan.id);
    const confirmed = await service.confirmPlan(user, generated.plan.id, 'k-confirm');
    const after = await store.findBundle(generated.plan.id);
    assert.equal(after?.plan.templateVersion, before?.plan.templateVersion);
    assert.deepEqual(
      after?.objectives.map((objective) => objective.id),
      before?.objectives.map((objective) => objective.id),
    );
    assert.equal(confirmed.plan.templateVersion, 'curriculum-plan-v1');
  });

  it('未答题落库：重复 next-step 复用同一题，题面投影不含答案 / 解析', async () => {
    const { service, store } = harness;
    const user = student('student-1');
    const generated = await service.generatePlan(user, { interest: '围棋', weeks: 4 });
    const confirmed = await service.confirmPlan(user, generated.plan.id, 'k-confirm');
    const plan = confirmed.plan;
    const session = plan.sessions[0];
    assert.ok(session);

    const first = await service.getNextStep(user, plan.id, session.id);
    // 首次出题是「生成动作 + 题面」，题面同时落库为 awaiting。
    assert.ok(['probe', 'assess', 'practice'].includes(first.action));
    assert.ok(first.question);
    const questionId = first.question.questionId;

    const stored = await store.findPendingQuestion(questionId);
    assert.ok(stored, '题面必须落库到 pending_questions');
    assert.equal(stored.status, 'awaiting');
    assert.equal(stored.studentUserId, user.id);
    assert.equal(stored.planId, plan.id);
    assert.equal(stored.sessionId, session.id);
    assert.ok(stored.expectedAnswer.length > 0, '服务端必须持有标准答案');
    assert.ok(stored.explanation.length > 0, '服务端必须持有解析');

    assert.equal('expectedAnswer' in first.question, false);
    assert.equal('explanation' in first.question, false);
    assert.deepEqual(
      Object.keys(first.question).sort(),
      ['allowFreeText', 'attempt', 'options', 'prompt', 'questionId', 'questionType'].sort(),
    );

    // 未作答时重复 next-step 命中同一道未答题，不产生第二道。
    const second = await service.getNextStep(user, plan.id, session.id);
    assert.equal(second.action, 'answer_pending');
    assert.equal(second.question?.questionId, questionId);
    assert.equal(second.objectiveId, first.objectiveId);
  });

  it('只能回答本人本计划的未答题；跨学生题 id 被拒', async () => {
    const { service } = harness;
    const owner = student('student-1');
    const stranger = student('student-2');
    const ownerPlan = (
      await service.confirmPlan(
        owner,
        (await service.generatePlan(owner, { interest: '象棋', weeks: 4 })).plan.id,
        'k-owner',
      )
    ).plan;
    const strangerPlan = (
      await service.confirmPlan(
        stranger,
        (await service.generatePlan(stranger, { interest: '象棋', weeks: 4 })).plan.id,
        'k-stranger',
      )
    ).plan;
    const ownerSession = ownerPlan.sessions[0];
    const strangerSession = strangerPlan.sessions[0];
    assert.ok(ownerSession && strangerSession);

    const ownerNext = await service.getNextStep(owner, ownerPlan.id, ownerSession.id);
    assert.ok(ownerNext.question);

    await assertHttpError(
      () =>
        service.submitAnswer(
          stranger,
          strangerPlan.id,
          strangerSession.id,
          { questionId: ownerNext.question!.questionId, answer: 'x' },
          'k-cross',
        ),
      409,
      'QUESTION_NOT_AWAITING',
    );
  });

  it('已作答题不再可答：换幂等键重复提交也被拒，attempt 只有一条', async () => {
    const { service, store } = harness;
    const user = student('student-1');
    const plan = (
      await service.confirmPlan(
        user,
        (await service.generatePlan(user, { interest: '陶艺', weeks: 4 })).plan.id,
        'k-confirm',
      )
    ).plan;
    const session = plan.sessions[0];
    assert.ok(session);
    const objective = session.theoryObjectiveIds[0];
    assert.ok(objective);

    const next = await service.getNextStep(user, plan.id, session.id);
    assert.ok(next.question);
    const questionId = next.question.questionId;
    const answer = buildQuestion({
      objective: {
        id: objective,
        name: flattenObjectives(plan).find((item) => item.id === objective)?.name ?? '',
        type: 'memory',
      },
      index: Number(questionId.slice(questionId.lastIndexOf('-') + 1)),
      seed: objective,
    }).expectedAnswer;

    const first = await service.submitAnswer(
      user,
      plan.id,
      session.id,
      { questionId, answer },
      'k-first',
    );
    assert.equal(first.isCorrect, true);
    assert.equal((await store.listAttempts(user.id, objective)).length, 1);

    await assertHttpError(
      () =>
        service.submitAnswer(user, plan.id, session.id, { questionId, answer }, 'k-second'),
      409,
      'QUESTION_NOT_AWAITING',
    );
    assert.equal((await store.listAttempts(user.id, objective)).length, 1);
  });
});
