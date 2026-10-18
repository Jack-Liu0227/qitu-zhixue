import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import type { CurrentUser, ProjectStage } from '@qitu/contracts';
import type { AuditEntry } from '../../common/audit/audit-entry';
import { AuditWriter, type AuditTransaction } from '../../common/audit/audit.service';
import { AccessPolicy } from '../../common/access/access-policy';
import { OutboxWriter, type OutboxTransaction } from '../../common/outbox/outbox.service';
import type { OutboxEventInput } from '../../common/outbox/outbox.types';
import {
  IdempotencyStore,
  type IdempotencyExecuteOptions,
  type IdempotentHandler,
  type IdempotencyResult,
} from '../../common/idempotency';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import {
  InMemoryLearningPlanStore,
  type AttemptRecord,
  type CompleteAssessmentInput,
  type LearningPlanStore,
  type MasteryObjectiveMappingRecord,
  type PlanBundle,
} from '../learning-plan/learning-plan.store';
import { LearningPlanService } from '../learning-plan/learning-plan.service';
import { PlanGenerator } from '../learning-plan/plan-generator';
import { InMemoryTutorQuizStore, type AnswerAttemptRecord } from './tutor-quiz.store';
import { TutorQuizService } from './tutor-quiz.service';
import { TutorService, type StreamedTutorEvent, type TutorSessionRecord } from './tutor.service';
import type { TutorModelGateway } from './gateway-tutor.provider';
import { StuckSignalService } from '../plan-adjustment/stuck-signal.service';
import { TeamRuntimeService } from '../team-runtime/team-runtime.service';

/**
 * F1 判分路由的聚焦验证。
 *
 * 全部直接实例化 service / store，不启动 Nest、数据库或网络：
 * - 对象级授权（会话 403、计划归属 403、未确认意图 409、未下发题 404）；
 * - 判分级幂等（同键同载荷重放、同键异载荷 409）；
 * - 掌握度写回与答案/解析释放门（量化 >= 0.9 才释放）；
 * - 统一会话提示阶梯（D5：+1 封顶 3、合成 hint 回合、卡点信号）；
 * - `answer_attempts` 证据写入（客观题作答、不含标准答案）。
 */

const OWNER = 'stu-a';
const OTHER = 'stu-b';
const QUIZ_ID = 'optics.reflection.q1';
const CONCEPT_ID = 'optics.reflection';
const PLAN_ID = 'plan-optics';
const PROJECT_ID = 'prj-optics';
const TEMPLATE_VERSION = 'tplv-optics';
const OBJECTIVE_ID = 'obj-reflection';

const unusedGateway: TutorModelGateway = {
  complete: () => Promise.reject(new Error('判分测试不应调用模型网关')),
};

function student(id: string): CurrentUser {
  return { id, email: `${id}@example.com`, displayName: id, role: 'student' };
}

/* ------------------------------ 替身 ------------------------------ */

class SharedIdempotencyStore extends IdempotencyStore {
  private readonly records = new Map<string, { hash: string; status: number; body: unknown }>();
  readonly executed: string[] = [];

  async execute<T>(
    scope: string,
    key: string,
    requestHash: string,
    handler: IdempotentHandler<T>,
    _options?: IdempotencyExecuteOptions,
  ): Promise<IdempotencyResult<T>> {
    const id = `${scope}::${key}`;
    const existing = this.records.get(id);
    if (existing !== undefined) {
      if (existing.hash !== requestHash) {
        throw new IdempotencyError('IDEMPOTENCY_CONFLICT', '同键异载荷冲突');
      }
      return { status: existing.status, body: existing.body as T, replayed: true };
    }
    this.executed.push(id);
    const outcome = await handler();
    this.records.set(id, { hash: requestHash, status: outcome.status ?? 200, body: outcome.body });
    return { status: outcome.status ?? 200, body: outcome.body, replayed: false };
  }
}

class RecordingAuditWriter extends AuditWriter {
  readonly entries: AuditEntry[] = [];
  readonly writeTxs: Array<{ action: string; tx: AuditTransaction | undefined }> = [];

  async write(entry: AuditEntry, tx?: AuditTransaction): Promise<string> {
    this.entries.push(entry);
    this.writeTxs.push({ action: entry.action, tx });
    return `audit-${this.entries.length}`;
  }

  count(action: string): number {
    return this.entries.filter((entry) => entry.action === action).length;
  }

  txOf(action: string): AuditTransaction | undefined {
    return this.writeTxs.find((record) => record.action === action)?.tx;
  }
}

class RecordingOutboxWriter extends OutboxWriter {
  readonly writes: OutboxEventInput[] = [];

  async write(event: OutboxEventInput, _tx?: OutboxTransaction): Promise<string> {
    this.writes.push(event);
    return event.id;
  }

  async markPublished(): Promise<void> {}
  async markFailed(): Promise<void> {}

  topic(topic: string): number {
    return this.writes.filter((event) => event.topic === topic).length;
  }
}

/** 把评估事务的 tx 句柄替换为哨兵，验证 A3 判分审计/证据与掌握度同事务。 */
class TxProbeLearningStore extends InMemoryLearningPlanStore {
  readonly sentinel = { probe: 'assessment-tx' } as unknown as AuditTransaction;

  override async withAssessmentTransaction<T>(
    studentId: string,
    work: (store: LearningPlanStore, tx?: AuditTransaction) => Promise<T>,
  ): Promise<T> {
    return work(this, this.sentinel);
  }

  override async completeAssessment(input: CompleteAssessmentInput): Promise<void> {
    await super.completeAssessment({
      ...input,
      commit: async () => { await input.commit?.(this.sentinel); },
    });
  }
}

class TxRecordingQuizStore extends InMemoryTutorQuizStore {
  lastTx: AuditTransaction | undefined = undefined;

  override async appendAttempt(record: AnswerAttemptRecord, tx?: AuditTransaction): Promise<void> {
    this.lastTx = tx;
    await super.appendAttempt(record, tx);
  }
}

/* ------------------------------ 装配 ------------------------------ */

function makePlanBundle(studentUserId: string, projectId: string | null): PlanBundle {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  return {
    plan: {
      id: PLAN_ID,
      studentUserId,
      projectId,
      interest: '光学',
      goal: '理解光的反射、折射与透镜',
      weeks: 4,
      minutesPerSession: 60,
      templateVersion: TEMPLATE_VERSION,
      status: 'active',
      version: 1,
      idempotencyKey: `plan:${PLAN_ID}`,
      confirmedAt: projectId === null ? null : createdAt,
      completedAt: null,
      createdAt,
      updatedAt: createdAt,
    },
    modules: [{
      id: 'module-optics',
      planId: PLAN_ID,
      name: '光学基础',
      weekIndex: 1,
      objective: '建立光学概念',
      ordinal: 1,
    }],
    objectives: [{
      id: OBJECTIVE_ID,
      planId: PLAN_ID,
      moduleId: 'module-optics',
      name: '光的反射',
      type: 'memory',
      objective: '掌握反射定律',
      prerequisiteIds: [],
      ordinal: 1,
    }],
    sessions: [{
      id: 'session-optics',
      planId: PLAN_ID,
      moduleId: 'module-optics',
      index: 0,
      blocks: [{ kind: 'theory', minutes: 60 }],
      theoryObjectiveIds: [OBJECTIVE_ID],
      practiceObjectiveIds: [],
      mode: 'study',
    }],
  };
}

function opticsMapping(): MasteryObjectiveMappingRecord {
  return {
    id: `mapping:${OBJECTIVE_ID}`,
    schoolId: null,
    planId: PLAN_ID,
    objectiveId: OBJECTIVE_ID,
    templateVersion: TEMPLATE_VERSION,
    contentVersion: TEMPLATE_VERSION,
    knowledgePointId: CONCEPT_ID,
    courseVersion: TEMPLATE_VERSION,
    source: 'explicit',
    mappedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeLearningStore(studentUserId: string = OWNER): InMemoryLearningPlanStore {
  return new InMemoryLearningPlanStore();
}

async function seedOpticsPlan(store: InMemoryLearningPlanStore, studentUserId: string = OWNER): Promise<void> {
  await store.createPlan(makePlanBundle(studentUserId, PROJECT_ID));
  await store.upsertObjectiveMapping(opticsMapping());
}

/** 完整项目（含 project 记录）：用于走真实回合下发的集成测试。 */
async function seedOpticsProject(store: InMemoryLearningPlanStore, status: ProjectStage = 'theory_learning'): Promise<void> {
  await store.createPlan(makePlanBundle(OWNER, null));
  await store.upsertObjectiveMapping(opticsMapping());
  await store.confirmPlan({
    planId: PLAN_ID,
    project: {
      id: PROJECT_ID,
      studentId: OWNER,
      templateVersionId: TEMPLATE_VERSION,
      status,
      currentStageIndex: 2,
      stageTotal: 8,
      progressPercent: 25,
      title: '光学小实验',
      subtitle: null,
      tags: ['光学'],
    },
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
}

function newTutorService(learningStore?: InMemoryLearningPlanStore): TutorService {
  return new TutorService(
    'demo',
    unusedGateway,
    undefined, // platformData
    undefined, // stallSink
    undefined, // workspace
    undefined, // store（demo 走内存种子）
    undefined, // idempotencyStore
    undefined, // auditWriter
    undefined, // sdkFactory
    undefined, // projects
    undefined, // platformRegistry
    undefined, // teamRuntime
    learningStore, // learningStore
  );
}

function newLearningPlanService(
  store: InMemoryLearningPlanStore,
  audit: RecordingAuditWriter,
  idempotency: SharedIdempotencyStore,
  input: {
    outbox?: RecordingOutboxWriter;
    teamRuntime?: TeamRuntimeService;
  } = {},
): LearningPlanService {
  return new LearningPlanService(
    store,
    { generate: () => { throw new Error('判分测试不应生成计划'); } } as unknown as PlanGenerator,
    idempotency,
    audit,
    input.outbox ?? ({
      write: async () => 'outbox-id',
      markPublished: async () => {},
      markFailed: async () => {},
    } as unknown as OutboxWriter),
    {} as unknown as AccessPolicy,
    undefined, // MasteryDomainService 未接线：走 legacy 掌握度写回（masteryEvent=null）
    input.teamRuntime,
  );
}

function newQuizService(input: {
  store: InMemoryLearningPlanStore;
  quizStore: InMemoryTutorQuizStore;
  idempotency: SharedIdempotencyStore;
  audit: RecordingAuditWriter;
  tutor: TutorService;
  stuckSignals?: StuckSignalService;
  outbox?: RecordingOutboxWriter;
  teamRuntime?: TeamRuntimeService;
}): TutorQuizService {
  return new TutorQuizService(
    input.store,
    input.quizStore,
    input.idempotency,
    input.audit,
    newLearningPlanService(input.store, input.audit, input.idempotency, {
      outbox: input.outbox,
      teamRuntime: input.teamRuntime,
    }),
    undefined, // MasteryDomainService 未接线：走 legacy 掌握度写回（masteryEvent=null）
    input.tutor,
    input.stuckSignals,
  );
}

/** 直接向会话注入一条已下发的 quiz 回合，绕过整轮对话（测试聚焦判分链路）。 */
function forceEmitQuiz(session: TutorSessionRecord, quizId: string = QUIZ_ID): void {
  const seq = session.lastSeq + 1;
  session.turns.push({
    turnId: `${session.sessionId}:assistant:${seq}`,
    role: 'assistant',
    blocks: [{
      kind: 'quiz',
      questionId: quizId,
      stem: '光射到镜面上发生反射时，入射角与反射角之间是什么关系？',
      type: 'single',
      options: [
        { key: 'A', text: '入射角大于反射角' },
        { key: 'B', text: '入射角等于反射角' },
        { key: 'C', text: '入射角小于反射角' },
        { key: 'D', text: '两者没有固定关系' },
      ],
      linkedConceptIds: [CONCEPT_ID],
    }],
    hintLevel: null,
    stageBefore: null,
    stageAfter: null,
    seq,
    createdAt: new Date().toISOString(),
    modality: 'text',
    author: { id: 'tutor-leader', name: '学习搭档', role: '导师' },
    pedagogicMove: 'hint',
    expectedEvidence: null,
    promptVersion: null,
    evidenceRef: null,
  });
  session.lastSeq = seq;
}

function seedMasteryAttempt(store: InMemoryLearningPlanStore, attempt: AttemptRecord): Promise<void> {
  return store.appendAttempt(attempt);
}

function makeAttempt(attemptCount: number, isCorrect: boolean): AttemptRecord {
  return {
    id: `attempt-${attemptCount}`,
    studentUserId: OWNER,
    planId: PLAN_ID,
    objectiveId: OBJECTIVE_ID,
    questionId: QUIZ_ID,
    result: isCorrect ? 'correct' : 'incorrect',
    isCorrect,
    assessmentType: 'quiz',
    errorType: isCorrect ? null : 'deviation',
    hintsUsed: 0,
    attemptCount,
    qualityBasisPoints: isCorrect ? 10_000 : 0,
    userAnswer: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
  };
}

async function assertHttpError(
  fn: () => Promise<unknown>,
  status: number,
  code?: string,
): Promise<void> {
  await assert.rejects(fn, (error: unknown) => {
    const httpError = error as { getStatus?: () => number; getResponse?: () => unknown };
    assert.equal(httpError.getStatus?.(), status);
    if (code !== undefined) {
      const response = httpError.getResponse?.() as { code?: string } | undefined;
      assert.equal(response?.code, code);
    }
    return true;
  });
}

/* ------------------------------ 对象级授权 ------------------------------ */

test('跨学生：他人的会话判分统一 403，不返回任何字段', async () => {
  const store = makeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);

  const quiz = newQuizService({
    store,
    quizStore: new InMemoryTutorQuizStore(),
    idempotency: new SharedIdempotencyStore(),
    audit: new RecordingAuditWriter(),
    tutor,
  });

  await assertHttpError(
    () => quiz.answer(student(OTHER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'k' }, 'k'),
    403,
  );
});

test('探索会话（projectId=null）判分 409 PBL_INTENT_NOT_CONFIRMED', async () => {
  const store = makeLearningStore();
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(null, OWNER, 'expl-1');
  forceEmitQuiz(session);

  const quiz = newQuizService({
    store,
    quizStore: new InMemoryTutorQuizStore(),
    idempotency: new SharedIdempotencyStore(),
    audit: new RecordingAuditWriter(),
    tutor,
  });

  await assertHttpError(
    () => quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'k' }, 'k'),
    409,
    'PBL_INTENT_NOT_CONFIRMED',
  );
});

test('未下发的题库题号判分 404 TUTOR_QUIZ_NOT_EMITTED', async () => {
  const store = makeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  // 会话里没有任何 quiz 块。
  const quiz = newQuizService({
    store,
    quizStore: new InMemoryTutorQuizStore(),
    idempotency: new SharedIdempotencyStore(),
    audit: new RecordingAuditWriter(),
    tutor,
  });

  await assertHttpError(
    () => quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'k' }, 'k'),
    404,
    'TUTOR_QUIZ_NOT_EMITTED',
  );
});

test('计划存在但不属于该学生：403（不泄露计划存在性）', async () => {
  const store = makeLearningStore();
  // 计划与项目都属于 OTHER，但会话属于 OWNER（数据不一致场景的授权兜底）。
  await store.createPlan(makePlanBundle(OTHER, null));
  await store.confirmPlan({
    planId: PLAN_ID,
    project: {
      id: PROJECT_ID,
      studentId: OTHER,
      templateVersionId: TEMPLATE_VERSION,
      status: 'theory_learning',
      currentStageIndex: 2,
      stageTotal: 8,
      progressPercent: 25,
      title: '光学小实验',
      subtitle: null,
      tags: ['光学'],
    },
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);

  const quiz = newQuizService({
    store,
    quizStore: new InMemoryTutorQuizStore(),
    idempotency: new SharedIdempotencyStore(),
    audit: new RecordingAuditWriter(),
    tutor,
  });

  await assertHttpError(
    () => quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'k' }, 'k'),
    403,
  );
});

test('项目没有计划：409 PBL_INTENT_NOT_CONFIRMED', async () => {
  const store = makeLearningStore();
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);

  const quiz = newQuizService({
    store,
    quizStore: new InMemoryTutorQuizStore(),
    idempotency: new SharedIdempotencyStore(),
    audit: new RecordingAuditWriter(),
    tutor,
  });

  await assertHttpError(
    () => quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'k' }, 'k'),
    409,
    'PBL_INTENT_NOT_CONFIRMED',
  );
});

/* ------------------------------ 判分 / 掌握度 / 释放 ------------------------------ */

test('正确作答写回掌握度；量化达标（>=0.9）才释放解析与标准答案', async () => {
  const store = makeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);
  // 本用例聚焦「正确作答→掌握度写回」，归零会话 hint 等级，避免种子会话
  // 的 hintLevel=2 叠扣分影响 0.5/0.75/0.9 的预期值（hint 传播另有专测）。
  session.lastHintLevel = null;

  const quizStore = new InMemoryTutorQuizStore();
  const audit = new RecordingAuditWriter();
  const idempotency = new SharedIdempotencyStore();
  const quiz = newQuizService({ store, quizStore, idempotency, audit, tutor });

  const answer = async (key: string) => quiz.answer(
    student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: key }, key,
  );

  const first = await answer('correct-1');
  assert.equal(first.correct, true);
  assert.equal(first.attempts, 1);
  assert.equal(first.explanation, null, '一次答对不能过关，解析不得提前释放');
  assert.equal(first.correctKeys, null);
  assert.equal(first.conceptDeltas[0]?.after, 0.5);

  const second = await answer('correct-2');
  assert.equal(second.correct, true);
  assert.equal(second.explanation, null);
  assert.equal(second.conceptDeltas[0]?.after, 0.75);

  const third = await answer('correct-3');
  assert.equal(third.correct, true);
  assert.equal(third.conceptDeltas[0]?.after, 0.9);
  assert.equal(third.conceptDeltas[0]?.mastered, true);
  assert.ok(third.explanation !== null, '量化达标后必须释放解析');
  assert.deepEqual(third.correctKeys, ['B'], '量化达标后必须释放标准答案');
  assert.match(third.explanation ?? '', /反射定律/);
});

test('答错不释放答案，conceptDeltas 记录 before/after 且未掌握', async () => {
  const store = makeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);

  const quizStore = new InMemoryTutorQuizStore();
  const audit = new RecordingAuditWriter();
  const quiz = newQuizService({ store, quizStore, idempotency: new SharedIdempotencyStore(), audit, tutor });

  const result = await quiz.answer(
    student(OWNER), session, QUIZ_ID, { selectedKeys: ['A'], idempotencyKey: 'wrong-1' }, 'wrong-1',
  );
  assert.equal(result.correct, false);
  assert.equal(result.explanation, null);
  assert.equal(result.correctKeys, null);
  // A6：before === after 时不上报空 delta。
  assert.deepEqual(result.conceptDeltas, [], '答错后 before===after，conceptDeltas 应为空');
  assert.ok(result.nextGuidance !== null, '答错应给出不含答案的引导');
  assert.doesNotMatch(result.nextGuidance ?? '', /反射角/);
});

/* ------------------------------ A5 / A2 / A3 / A9 ------------------------------ */

test('已掌握目标再判分：400 QUESTION_NOT_AWAITING', async () => {
  const store = makeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);
  session.lastHintLevel = null;

  const quiz = newQuizService({
    store,
    quizStore: new InMemoryTutorQuizStore(),
    idempotency: new SharedIdempotencyStore(),
    audit: new RecordingAuditWriter(),
    tutor,
  });

  // 三次全对把 memory 目标推到 mastered。
  for (let index = 1; index <= 3; index += 1) {
    await quiz.answer(
      student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: `master-${index}` }, `master-${index}`,
    );
  }

  await assertHttpError(
    () => quiz.answer(
      student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'master-4' }, 'master-4',
    ),
    400,
    'QUESTION_NOT_AWAITING',
  );
});

test('判分在提交后经门禁桥写 TheoryMastered，且只在达标翻转时写一次', async () => {
  const store = new TxProbeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);
  session.lastHintLevel = null;

  const audit = new RecordingAuditWriter();
  const outbox = new RecordingOutboxWriter();
  const gateCalls: Array<{ studentUserId: string; gate: string; evidenceRef: string; source: string; tx?: AuditTransaction }> = [];
  const teamRuntime = {
    recordGateForStudent: async (
      input: { studentUserId: string; gate: string; evidenceRef: string; source: string },
      tx?: AuditTransaction,
    ) => {
      gateCalls.push({ ...input, tx });
      return { status: 'recorded' as const, runId: null, gate: input.gate };
    },
  } as unknown as TeamRuntimeService;
  const quiz = newQuizService({
    store,
    quizStore: new InMemoryTutorQuizStore(),
    idempotency: new SharedIdempotencyStore(),
    audit,
    tutor,
    outbox,
    teamRuntime,
  });

  await quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'gate-1' }, 'gate-1');
  await quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'gate-2' }, 'gate-2');
  assert.equal(audit.count('learning_plan.theory_mastered'), 0, '未达标不得写 theory_mastered');
  assert.equal(outbox.topic('learning.theory_mastered'), 0);
  assert.equal(gateCalls.length, 0, '未达标不得写门禁证据');

  await quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'gate-3' }, 'gate-3');
  assert.equal(audit.count('learning_plan.theory_mastered'), 1, '翻转达标才写一次 theory_mastered 审计');
  assert.equal(outbox.topic('learning.theory_mastered'), 1);
  assert.equal(gateCalls.length, 1, '门禁桥只在达标翻转时调用一次');
  assert.equal(gateCalls[0]?.studentUserId, OWNER);
  assert.equal(gateCalls[0]?.gate, 'TheoryMastered');
  assert.equal(gateCalls[0]?.source, 'learning-plan.theory-mastered');
  assert.equal(gateCalls[0]?.tx, undefined, '门禁桥在提交后执行：不带事务句柄（与 submitAnswer 同构）');
  assert.equal(gateCalls[0]?.evidenceRef, 'mastery:theory:session-optics');
});

test('门禁桥 best-effort：团队链路写入失败不影响已成立的作答与掌握度', async () => {
  const store = makeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);
  session.lastHintLevel = null;

  const teamRuntime = {
    recordGateForStudent: async () => {
      throw new Error('team-runtime unavailable');
    },
  } as unknown as TeamRuntimeService;
  const quiz = newQuizService({
    store,
    quizStore: new InMemoryTutorQuizStore(),
    idempotency: new SharedIdempotencyStore(),
    audit: new RecordingAuditWriter(),
    tutor,
    teamRuntime,
  });

  for (const attempt of ['bf-1', 'bf-2', 'bf-3']) {
    const result = await quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: attempt }, attempt);
    assert.equal(result.correct, true, `${attempt} 判分不受门禁桥故障影响`);
  }
  assert.notEqual(await store.findMastery(OWNER, OBJECTIVE_ID), null, '掌握度已落库');
});

test('判分审计与作答证据和掌握度写入同事务：commitTx 透传，不提交后补写', async () => {
  const store = new TxProbeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);
  session.lastHintLevel = null;

  const quizStore = new TxRecordingQuizStore();
  const audit = new RecordingAuditWriter();
  const quiz = newQuizService({
    store,
    quizStore,
    idempotency: new SharedIdempotencyStore(),
    audit,
    tutor,
  });

  await quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'tx-1' }, 'tx-1');

  assert.equal(audit.count('tutor.quiz.graded'), 1, '判分审计只写一次，提交后不补写');
  assert.equal(audit.txOf('tutor.quiz.graded'), store.sentinel, '判分审计使用评估事务句柄');
  assert.equal(quizStore.lastTx, store.sentinel, '作答证据写入与掌握度同事务');
  assert.notEqual(await store.findMastery(OWNER, OBJECTIVE_ID), null, '掌握度与审计同事务落库');
});

test('L3 卡点与 S1 迷思使用 contract 触发键：l3_cap:session:quiz 与 misconception:...:3', async () => {
  const store = makeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);
  session.lastHintLevel = null;

  const quizStore = new InMemoryTutorQuizStore();
  const ingested: Array<{ triggerKey: string; errorTypeCode: string }> = [];
  const stuckSignals = {
    ingest: async (signal: { triggerKey: string; errorTypeCode: string }) => {
      ingested.push({ triggerKey: signal.triggerKey, errorTypeCode: signal.errorTypeCode });
      return { created: true };
    },
  } as unknown as StuckSignalService;
  const quiz = newQuizService({
    store,
    quizStore,
    idempotency: new SharedIdempotencyStore(),
    audit: new RecordingAuditWriter(),
    tutor,
    stuckSignals,
  });

  // 三次同概念同类型答错：第一次触发 L3 卡点（阶梯 1→2→3 依次推进），
  // 第三次触发 S1 迷思（最近 3 次同错误）。
  await quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['A'], idempotencyKey: 'sig-1' }, 'sig-1');
  await quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['A'], idempotencyKey: 'sig-2' }, 'sig-2');
  await quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['A'], idempotencyKey: 'sig-3' }, 'sig-3');

  assert.equal(ingested.length, 2, 'L3 卡点一次 + S1 迷思一次');
  assert.ok(ingested.some((signal) => signal.triggerKey === `l3_cap:${session.sessionId}:${QUIZ_ID}`),
    'L3 触发键必须是 l3_cap:sessionId:quizId');
  assert.ok(ingested.some((signal) => signal.triggerKey === `misconception:${OWNER}:${CONCEPT_ID}:deviation:3`),
    'S1 触发键必须是 misconception:studentId:conceptId:errorType:3');
});

/* ------------------------------ 幂等 / 重放 ------------------------------ */

test('同一幂等键同载荷：重放不重复执行、只写一条证据、响应带 replayed', async () => {
  const store = makeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);

  const quizStore = new InMemoryTutorQuizStore();
  const audit = new RecordingAuditWriter();
  const idempotency = new SharedIdempotencyStore();
  const quiz = newQuizService({ store, quizStore, idempotency, audit, tutor });

  const first = await quiz.answer(
    student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'k-replay' }, 'k-replay',
  );
  const second = await quiz.answer(
    student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'k-replay' }, 'k-replay',
  );

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.deepEqual({ ...second, replayed: false }, first);
  assert.equal(idempotency.executed.length, 1);
  assert.equal(quizStore.list().length, 1, '重放不得再写 answer_attempts');
  assert.equal(audit.count('tutor.quiz.graded'), 1, '重放不得再写判分审计');
});

test('崩溃重放：同一幂等键重复 append 只落一行（不撞唯一索引）', async () => {
  const quizStore = new InMemoryTutorQuizStore();
  const record = {
    id: 'quiz-attempt-crash',
    schoolId: null,
    studentUserId: OWNER,
    tutorSessionId: 'session-1',
    quizId: QUIZ_ID,
    objectiveId: null,
    planId: null,
    conceptId: 'opt-theory-refraction',
    result: 'incorrect' as const,
    isCorrect: false,
    assessmentType: 'quiz' as const,
    errorType: 'deviation' as const,
    hintsUsed: 3,
    attemptCount: 1,
    qualityBasisPoints: 0,
    userAnswer: '["A"]',
    idempotencyKey: 'student.tutor.quiz.answer:u:session-1:q:crash-key',
    createdAt: new Date(),
  };
  await quizStore.appendAttempt(record);
  await quizStore.appendAttempt({ ...record, id: 'quiz-attempt-crash-2' });
  assert.equal(quizStore.list().length, 1, '同幂等键重复写必须静默去重');
  // 不同幂等键仍照常记录。
  await quizStore.appendAttempt({ ...record, id: 'quiz-attempt-3', idempotencyKey: 'another-key' });
  assert.equal(quizStore.list().length, 2);
});

test('同一幂等键不同载荷：409 IDEMPOTENCY_CONFLICT', async () => {
  const store = makeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);

  const quiz = newQuizService({
    store,
    quizStore: new InMemoryTutorQuizStore(),
    idempotency: new SharedIdempotencyStore(),
    audit: new RecordingAuditWriter(),
    tutor,
  });

  await quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'k-conflict' }, 'k-conflict');
  await assertHttpError(
    () => quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['A'], idempotencyKey: 'k-conflict' }, 'k-conflict'),
    409,
    'IDEMPOTENCY_CONFLICT',
  );
});

/* ------------------------------ 统一提示阶梯（D5） ------------------------------ */

test('统一会话阶梯：答错 +1 推进、封顶 3、合成 hint 回合、L3 发卡点信号', async () => {
  const store = makeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);
  session.lastHintLevel = null; // 从 0 开始推进，使断言不受演示种子影响

  const quizStore = new InMemoryTutorQuizStore();
  const audit = new RecordingAuditWriter();
  const quiz = newQuizService({ store, quizStore, idempotency: new SharedIdempotencyStore(), audit, tutor });

  const answerWrong = async (key: string) => quiz.answer(
    student(OWNER), session, QUIZ_ID, { selectedKeys: ['A'], idempotencyKey: key }, key,
  );

  const turnsBefore = session.turns.length;

  const w1 = await answerWrong('ladder-1');
  assert.equal(w1.hintLevel, 1);
  assert.equal(session.lastHintLevel, 1);
  assert.equal(session.turns.length, turnsBefore + 1, '阶梯前进时追加一条合成 hint 回合');
  assert.equal(session.turns.at(-1)?.blocks[0]?.kind, 'hint');
  assert.equal(session.turns.at(-1)?.hintLevel, 1);

  const w2 = await answerWrong('ladder-2');
  assert.equal(w2.hintLevel, 2);
  assert.equal(session.lastHintLevel, 2);

  const w3 = await answerWrong('ladder-3');
  assert.equal(w3.hintLevel, 3);
  assert.equal(session.lastHintLevel, 3);
  assert.equal(audit.count('tutor.stuck_signal'), 1, '首次触及 L3 封顶必须发卡点信号');

  const turnsAtCap = session.turns.length;
  const w4 = await answerWrong('ladder-4');
  assert.equal(w4.hintLevel, 3, 'L3 封顶后不再推进');
  assert.equal(session.lastHintLevel, 3);
  assert.equal(session.turns.length, turnsAtCap, '封顶后不得再追加 hint 回合');
  assert.equal(audit.count('tutor.stuck_signal'), 2, '封顶后的答错继续发卡点信号');
});

test('答对不推进阶梯', async () => {
  const store = makeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);
  session.lastHintLevel = null;

  const quiz = newQuizService({
    store,
    quizStore: new InMemoryTutorQuizStore(),
    idempotency: new SharedIdempotencyStore(),
    audit: new RecordingAuditWriter(),
    tutor,
  });

  const turnsBefore = session.turns.length;
  const result = await quiz.answer(
    student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'correct-ladder' }, 'correct-ladder',
  );
  assert.equal(result.hintLevel, 1, '无推进时返回当前阶梯（null → 1）');
  assert.equal(session.lastHintLevel, null, '答对不改写会话阶梯');
  assert.equal(session.turns.length, turnsBefore, '答对不追加 hint 回合');
});

/* ------------------------------ 证据写入 / 未映射降级 ------------------------------ */

test('answer_attempts 写入客观作答证据，不含标准答案；hints_used 记录作答时阶梯', async () => {
  const store = makeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);
  session.lastHintLevel = 2;

  const quizStore = new InMemoryTutorQuizStore();
  const quiz = newQuizService({
    store,
    quizStore,
    idempotency: new SharedIdempotencyStore(),
    audit: new RecordingAuditWriter(),
    tutor,
  });

  await quiz.answer(student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'evidence-1' }, 'evidence-1');

  assert.equal(quizStore.list().length, 1);
  const row = quizStore.list()[0]!;
  assert.equal(row.studentUserId, OWNER);
  assert.equal(row.tutorSessionId, session.sessionId);
  assert.equal(row.quizId, QUIZ_ID);
  assert.equal(row.objectiveId, OBJECTIVE_ID);
  assert.equal(row.planId, PLAN_ID);
  assert.equal(row.conceptId, CONCEPT_ID);
  assert.equal(row.isCorrect, true);
  assert.equal(row.hintsUsed, 2, 'hints_used 记录作答时的统一会话阶梯');
  assert.equal(row.userAnswer, JSON.stringify(['B']));
  assert.ok(row.idempotencyKey.includes(QUIZ_ID), '行级幂等键包含 scope 与 key');
});

test('概念未映射：conceptDeltas 空、审计告警、证据仍写入且不写掌握度', async () => {
  const store = makeLearningStore();
  await seedOpticsPlan(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);
  forceEmitQuiz(session);

  // 判分时反查不到映射：把映射恢复为默认 local 键，模拟「下发后映射失效」。
  await store.upsertObjectiveMapping({
    ...opticsMapping(),
    knowledgePointId: `local:${OBJECTIVE_ID}`,
  });

  const quizStore = new InMemoryTutorQuizStore();
  const audit = new RecordingAuditWriter();
  const quiz = newQuizService({ store, quizStore, idempotency: new SharedIdempotencyStore(), audit, tutor });

  const result = await quiz.answer(
    student(OWNER), session, QUIZ_ID, { selectedKeys: ['B'], idempotencyKey: 'unmapped-1' }, 'unmapped-1',
  );

  assert.deepEqual(result.conceptDeltas, []);
  assert.equal(result.correct, true);
  assert.equal(audit.count('tutor.quiz.unmapped-concept'), 1);
  assert.equal(quizStore.list().length, 1, '未映射仍记录作答证据');
  assert.equal(quizStore.list()[0]!.objectiveId, null);
  assert.equal(quizStore.list()[0]!.planId, null);
  assert.equal((await store.findMastery(OWNER, OBJECTIVE_ID)), null, '未映射不得写掌握度');
});

/* ------------------------------ 下发集成 ------------------------------ */

test('executeTurn 会为未掌握理论目标追加题库公开投影，且不落 expectedKeys', async () => {
  const store = makeLearningStore();
  await seedOpticsProject(store);
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);

  const before = session.turns.length;
  await drain(tutor.runTurn(session, { content: '开始学习', idempotencyKey: 'turn-emit', actorId: OWNER }));

  assert.equal(session.turns.length, before + 2, '一轮学生回合 + 助手回合');
  const assistant = session.turns.find((turn) => turn.role === 'assistant' && turn.seq === session.lastSeq);
  assert.ok(assistant, '助手回合存在');
  const quizBlocks = assistant.blocks.filter((block) => block.kind === 'quiz');
  assert.equal(quizBlocks.length, 1);
  assert.equal(quizBlocks[0]?.questionId, QUIZ_ID);
  assert.doesNotMatch(JSON.stringify(assistant), /expectedKeys|反射定律|explanation/);
});

test('题库投影仅在概念掌握阶段输出：practice 阶段不追加 quiz block（A8）', async () => {
  const store = makeLearningStore();
  await seedOpticsProject(store, 'practice_building');
  const tutor = newTutorService(store);
  const session = tutor.getOrCreateSession(PROJECT_ID, OWNER);

  const before = session.turns.length;
  await drain(tutor.runTurn(session, { content: '开始制作', idempotencyKey: 'turn-practice', actorId: OWNER }));

  assert.equal(session.turns.length, before + 2, '一轮学生回合 + 助手回合');
  const assistant = session.turns.find((turn) => turn.role === 'assistant' && turn.seq === session.lastSeq);
  assert.ok(assistant, '助手回合存在');
  assert.deepEqual(assistant.blocks.filter((block) => block.kind === 'quiz'), [], '非概念掌握阶段不得下发题库投影');
});

async function drain(
  generator: AsyncGenerator<StreamedTutorEvent, void, undefined>,
): Promise<StreamedTutorEvent[]> {
  const events: StreamedTutorEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}
