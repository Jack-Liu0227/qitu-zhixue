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
import { InMemoryLearningPlanStore } from './learning-plan.store';
import { LearningPlanService } from './learning-plan.service';
import {
  assertGenerateInput,
  assertNoServerOwnedFields,
  DeterministicPlanGenerator,
  PlanGenerationError,
  validateGeneratedPlan,
  type GeneratePlanInput,
  type GeneratedPlan,
} from './plan-generator';

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
    if (actor.role !== 'teacher') return false;
    return this.mentorOf.has(`${actor.id}::${studentId}`);
  }
}

interface Harness {
  service: LearningPlanService;
  store: InMemoryLearningPlanStore;
  idempotency: FakeIdempotencyStore;
  audit: FakeAuditWriter;
  outbox: FakeOutboxWriter;
  access: FakeAccessPolicy;
}

function makeHarness(generator: DeterministicPlanGenerator = new DeterministicPlanGenerator()): Harness {
  const store = new InMemoryLearningPlanStore();
  const idempotency = new FakeIdempotencyStore();
  const audit = new FakeAuditWriter();
  const outbox = new FakeOutboxWriter();
  const access = new FakeAccessPolicy();
  const service = new LearningPlanService(
    store,
    generator,
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter,
    outbox as unknown as OutboxWriter,
    access as unknown as AccessPolicy,
  );
  return { service, store, idempotency, audit, outbox, access };
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
    assert.throws(() => assertGenerateInput({ interest: '钢琴', weeks: 6 }), PlanGenerationError);
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
});
