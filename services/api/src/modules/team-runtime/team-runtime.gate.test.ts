import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { agentConfigs, agentTeamEvents, agentTeamRuns, agentTeamTasks, pblGateEvidence, type Database } from '@qitu/database';
import {
  PBL_ASSISTANT_BY_PHASE,
  PBL_AUTONOMOUS_ADVANCE_ALLOWED,
  PBL_GATE_BY_PHASE,
  PBL_GATE_SOURCE_WHITELIST,
  PBL_INITIAL_PHASE,
  PBL_PHASE_ORDER,
  PBL_TEAM_ERROR_CODES,
  TEAM_RUN_CONTEXT_ALLOWED_KEYS,
  TEAM_RUN_CONTEXT_RESERVED_KEYS,
  THUNDER_FIGHTER_PBL_SPEC,
  nextPblPhase,
  pblGatesRequiredToEnter,
} from '@qitu/ai-client';
import {
  TEAM_FRAME_NAMES,
  TeamRuntimeService,
  assertGateEvidenceWritable,
  assertRunPhaseConsistent,
  buildTeamFrameData,
  decideDelegatedPhaseEntry,
  decideMentorUniqueness,
  decidePhaseAdvance,
  evaluateGateEntry,
  isUniqueViolationError,
  readRunPhaseContext,
  sanitizeTeamClientContext,
  type ActiveTeamRunRow,
} from './team-runtime.service';

const STU: CurrentUser = { id: 'stu-1', email: '', displayName: '', role: 'student' };
const ADMIN: CurrentUser = { id: 'admin-1', email: '', displayName: '', role: 'admin' };

function satisfied(...gates: string[]): Set<string> {
  return new Set(gates);
}

/* ------------------------------------------------------------------ */
/* 冻结规格常量：阶段与门禁的唯一真源（@qitu/ai-client pbl-team.ts）    */
/* ------------------------------------------------------------------ */

test('frozen PBL spec pins the four-phase order and gate conditions', () => {
  assert.deepEqual(PBL_PHASE_ORDER, ['exploration', 'concept_mastery', 'guided_practice', 'deliverable_review']);
  assert.deepEqual(PBL_GATE_BY_PHASE, {
    exploration: 'student_confirmed_intent',
    concept_mastery: 'TheoryMastered',
    guided_practice: 'code_playable_run_verified',
    deliverable_review: 'review_completed_and_archived',
  });
  assert.equal(THUNDER_FIGHTER_PBL_SPEC.theoryMasteredGate, true);
  assert.equal(THUNDER_FIGHTER_PBL_SPEC.allowAutonomousAdvance, false);
  assert.equal(PBL_AUTONOMOUS_ADVANCE_ALLOWED, false);
  assert.deepEqual(THUNDER_FIGHTER_PBL_SPEC.phases.map((phase) => phase.phase), [...PBL_PHASE_ORDER]);
  assert.deepEqual(pblGatesRequiredToEnter('guided_practice'), ['student_confirmed_intent', 'TheoryMastered']);
  assert.equal(nextPblPhase('deliverable_review'), null);
  assert.equal(PBL_ASSISTANT_BY_PHASE.guided_practice, 'fighter-code-guide');
  assert.equal(readRunPhaseContext({ phase: 'guided_practice' }), 'guided_practice');
  // D3：phase 缺失 → 视为首阶段（探索），绝不视为终点。
  assert.equal(readRunPhaseContext({}), 'exploration');
  assert.equal(readRunPhaseContext(null), PBL_INITIAL_PHASE);
  // D3：非法/伪造值 → 409，不得当成有效阶段继续判定。
  assert.throws(
    () => readRunPhaseContext({ phase: 'not-a-phase' }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(((error as ConflictException).getResponse() as { code?: string }).code, PBL_TEAM_ERROR_CODES.PHASE_ORDER_INVALID);
      return true;
    },
  );
});

/* ------------------------------------------------------------------ */
/* F1：客户端不得写阶段/门禁字段（键白名单，拒绝时 0 insert）          */
/* ------------------------------------------------------------------ */

test('client team-run context whitelist pins reserved state keys', () => {
  assert.ok(TEAM_RUN_CONTEXT_RESERVED_KEYS.includes('phase'));
  assert.ok(TEAM_RUN_CONTEXT_RESERVED_KEYS.includes('satisfiedGates'));
  assert.ok(TEAM_RUN_CONTEXT_RESERVED_KEYS.includes('pblPhase'));
  for (const key of ['phase', 'gates', 'theoryMasteredGate', 'allowAutonomousAdvance']) {
    assert.ok(TEAM_RUN_CONTEXT_RESERVED_KEYS.includes(key), `${key} must be reserved`);
    assert.equal(TEAM_RUN_CONTEXT_ALLOWED_KEYS.includes(key), false);
  }
  // 既有 AI 搭档链路（tutor.service.ts executeTurn）依赖的两个观测字段必须在白名单内。
  assert.ok(TEAM_RUN_CONTEXT_ALLOWED_KEYS.includes('turnCount'));
  assert.ok(TEAM_RUN_CONTEXT_ALLOWED_KEYS.includes('pedagogicMove'));
  assert.deepEqual(sanitizeTeamClientContext({ turnCount: 3, pedagogicMove: 'hint' }), { turnCount: 3, pedagogicMove: 'hint' });
  assert.deepEqual(sanitizeTeamClientContext(undefined), {});
  assert.deepEqual(sanitizeTeamClientContext(null), {});
});

test('client-forged context.phase is rejected with 400 TEAM_CONTEXT_RESERVED_KEY', () => {
  assert.throws(
    () => sanitizeTeamClientContext({ phase: 'deliverable_review' }),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal(((error as BadRequestException).getResponse() as { code?: string }).code, PBL_TEAM_ERROR_CODES.CONTEXT_RESERVED_KEY);
      return true;
    },
  );
  assert.throws(
    () => sanitizeTeamClientContext({ topic: 'x', satisfiedGates: ['TheoryMastered'] }),
    (error: unknown) => ((error as BadRequestException).getResponse() as { code?: string }).code === PBL_TEAM_ERROR_CODES.CONTEXT_RESERVED_KEY,
  );
  assert.throws(
    () => sanitizeTeamClientContext({ mystery: 1 }),
    (error: unknown) => ((error as BadRequestException).getResponse() as { code?: string }).code === PBL_TEAM_ERROR_CODES.CONTEXT_UNKNOWN_KEY,
  );
  assert.throws(
    () => sanitizeTeamClientContext('not-an-object'),
    (error: unknown) => ((error as BadRequestException).getResponse() as { code?: string }).code === PBL_TEAM_ERROR_CODES.CONTEXT_INVALID,
  );
});

/* ------------------------------------------------------------------ */
/* 最重要的一条：TheoryMastered 未达成 → 进入 guided_practice 被拒      */
/* ------------------------------------------------------------------ */

test('advancing to guided_practice is rejected when TheoryMastered is not satisfied', () => {
  const decision = decidePhaseAdvance({
    currentPhase: 'concept_mastery',
    targetPhase: 'guided_practice',
    trigger: 'manual',
    satisfiedGates: satisfied('student_confirmed_intent'),
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.status, 409);
    assert.equal(decision.errorCode, 'PBL_GATE_THEORY_MASTERED_REQUIRED');
    assert.equal(decision.requiredGate, 'TheoryMastered');
  }

  // 门禁累积判定：即使 run.context 被错误地写成实践阶段，进入判定仍然拒绝。
  const entry = evaluateGateEntry('guided_practice', satisfied('student_confirmed_intent'));
  assert.equal(entry.allowed, false);
  if (!entry.allowed) assert.equal(entry.errorCode, 'PBL_GATE_THEORY_MASTERED_REQUIRED');

  // 达成 TheoryMastered 后放行（且必须仍按顺序推进）。
  const allowed = decidePhaseAdvance({
    currentPhase: 'concept_mastery',
    targetPhase: 'guided_practice',
    trigger: 'manual',
    satisfiedGates: satisfied('student_confirmed_intent', 'TheoryMastered'),
  });
  assert.deepEqual(allowed, { allowed: true, phase: 'guided_practice' });
});

test('delegated calls entering guided_practice are rejected when TheoryMastered is missing', () => {
  const decision = decideDelegatedPhaseEntry({
    runPhase: 'concept_mastery',
    pblPhase: 'guided_practice',
    satisfiedGates: satisfied('student_confirmed_intent'),
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.status, 409);
    assert.equal(decision.errorCode, 'PBL_GATE_THEORY_MASTERED_REQUIRED');
  }
  // 门禁达成但阶段不一致：run 还在 concept_mastery，直接委派 guided_practice → 409 阶段不匹配。
  const mismatch = decideDelegatedPhaseEntry({
    runPhase: 'concept_mastery',
    pblPhase: 'guided_practice',
    satisfiedGates: satisfied('student_confirmed_intent', 'TheoryMastered'),
  });
  assert.equal(mismatch.allowed, false);
  if (!mismatch.allowed) assert.equal(mismatch.errorCode, 'TEAM_PHASE_MISMATCH');
});

/* ------------------------------------------------------------------ */
/* 学生未确认意图 → 不得离开探索阶段（正式项目创建的判定点在 projects） */
/* ------------------------------------------------------------------ */

// F3：这里不再重复实现「正式项目创建」判定。唯一判定点是
// services/api/src/modules/projects/intent-confirmation.state-machine.ts 的
// `canCreateFormalProject`（由 projects.service.ts 在项目创建入口调用）。
// 本节只钉住 team-runtime 自己的探索阶段门禁：意图未经服务端确认时，
// 不得推进离开 exploration（推进不了 = 拿不到后续阶段的委派/推进资格）。

test('leaving exploration is blocked while student intent gate is not satisfied', () => {
  const advance = decidePhaseAdvance({
    currentPhase: 'exploration',
    targetPhase: 'concept_mastery',
    trigger: 'manual',
    satisfiedGates: new Set<string>(),
  });
  assert.equal(advance.allowed, false);
  if (!advance.allowed) {
    assert.equal(advance.status, 409);
    assert.equal(advance.errorCode, 'PBL_GATE_STUDENT_INTENT_REQUIRED');
    assert.equal(advance.requiredGate, 'student_confirmed_intent');
  }
  const ok = decidePhaseAdvance({
    currentPhase: 'exploration',
    targetPhase: 'concept_mastery',
    trigger: 'manual',
    satisfiedGates: satisfied('student_confirmed_intent'),
  });
  assert.deepEqual(ok, { allowed: true, phase: 'concept_mastery' });
});

test('phase skipping and autonomous advance are rejected', () => {
  const skip = decidePhaseAdvance({
    currentPhase: 'exploration',
    targetPhase: 'guided_practice',
    trigger: 'manual',
    satisfiedGates: satisfied('student_confirmed_intent', 'TheoryMastered'),
  });
  assert.equal(skip.allowed, false);
  if (!skip.allowed) assert.equal(skip.errorCode, 'PBL_PHASE_ORDER_INVALID');

  const auto = decidePhaseAdvance({
    currentPhase: 'concept_mastery',
    targetPhase: 'guided_practice',
    trigger: 'autonomous',
    satisfiedGates: satisfied('student_confirmed_intent', 'TheoryMastered'),
  });
  assert.equal(auto.allowed, false);
  if (!auto.allowed) assert.equal(auto.errorCode, 'PBL_AUTONOMOUS_ADVANCE_FORBIDDEN');
});

/* ------------------------------------------------------------------ */
/* 班主任唯一性：一个学生同一时间只能有一个当前班主任                     */
/* ------------------------------------------------------------------ */

function runRow(over: Partial<ActiveTeamRunRow>): ActiveTeamRunRow {
  return {
    id: 'run-x',
    leaderAgentId: 'leader-a',
    studentUserId: 'stu-1',
    projectId: null,
    tutorSessionId: 'session-1',
    status: 'running',
    ...over,
  };
}

test('a second mentor for the same student is rejected, never co-existing', () => {
  const conflict = decideMentorUniqueness(
    [runRow({ id: 'run-a', leaderAgentId: 'leader-a' })],
    { leaderAgentId: 'leader-b', tutorSessionId: 'session-2', projectId: null },
  );
  assert.equal(conflict.kind, 'conflict');
  if (conflict.kind === 'conflict') {
    assert.equal(conflict.status, 409);
    assert.equal(conflict.errorCode, 'TEAM_MENTOR_UNIQUENESS_CONFLICT');
  }

  const replay = decideMentorUniqueness(
    [runRow({ id: 'run-a', leaderAgentId: 'leader-a', tutorSessionId: 'session-1', projectId: null })],
    { leaderAgentId: 'leader-a', tutorSessionId: 'session-1', projectId: null },
  );
  assert.deepEqual(replay, { kind: 'replay', runId: 'run-a' });

  const fresh = decideMentorUniqueness([], { leaderAgentId: 'leader-a', tutorSessionId: 'session-1', projectId: null });
  assert.deepEqual(fresh, { kind: 'allow' });
});

/* ------------------------------------------------------------------ */
/* 服务层强制（fake database）：HTTP 语义 = 409 ConflictException        */
/* ------------------------------------------------------------------ */

function makeChain(rows: unknown[]): Record<string, unknown> {
  const chain: Record<string, unknown> = {
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
    then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(onFulfilled, onRejected),
  };
  return chain;
}

function fakeDb(queues: Map<unknown, unknown[][]>): Database {
  const db: Record<string, unknown> = {
    select: () => ({
      from: (table: unknown) => {
        const queue = queues.get(table);
        const rows = queue && queue.length > 0 ? queue.shift() : [];
        return makeChain(rows ?? []);
      },
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => Promise.resolve([]),
        returning: () => Promise.resolve([]),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(db),
    execute: async () => ({ rows: [] }),
  };
  return db as unknown as Database;
}

const auditStub = { write: async () => 'audit-id' } as never;
const outboxStub = { write: async () => undefined } as never;

function fullRunRow(over: Record<string, unknown> = {}) {
  const now = new Date('2026-11-05T00:00:00.000Z');
  return {
    id: 'run-1',
    leaderAgentId: 'leader-a',
    studentUserId: 'stu-1',
    projectId: null,
    tutorSessionId: 'session-1',
    trigger: 'tutor.turn',
    status: 'running',
    context: { phase: 'concept_mastery' },
    createdBy: 'stu-1',
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function agentRow(id: string) {
  return {
    id,
    displayName: id,
    role: 'leader',
    roleDefinition: 'leader definition',
    parentAgentId: null,
    enabled: true,
    modelProviderId: null,
    modelId: null,
    capabilities: [],
  };
}

test('startRun rejects a different mentor for a student that already has an active run (409)', async () => {
  const queues = new Map<unknown, unknown[][]>([
    [agentConfigs, [[agentRow('leader-b')]]],
    [agentTeamRuns, [[], [fullRunRow({ id: 'run-a', leaderAgentId: 'leader-a' })]]],
  ]);
  const service = new TeamRuntimeService(fakeDb(queues), auditStub, outboxStub);
  await assert.rejects(
    () =>
      service.startRun(STU, {
        leaderAgentId: 'leader-b',
        studentUserId: 'stu-1',
        tutorSessionId: 'session-2',
        idempotencyKey: 'key-conflict-1',
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException, `expected ConflictException, got ${String(error)}`);
      const response = (error as ConflictException).getResponse() as { code?: string; message?: string };
      assert.equal(response.code, 'TEAM_MENTOR_UNIQUENESS_CONFLICT');
      assert.match(response.message ?? '', /班主任/);
      return true;
    },
  );
});

test('startRun replays the existing active run for the same mentor + session + project (idempotent)', async () => {
  const existing = fullRunRow({ id: 'run-a', leaderAgentId: 'leader-a' });
  const queues = new Map<unknown, unknown[][]>([
    [agentConfigs, [[agentRow('leader-a')]]],
    [agentTeamRuns, [[], [existing]]],
  ]);
  const service = new TeamRuntimeService(fakeDb(queues), auditStub, outboxStub);
  const view = await service.startRun(STU, {
    leaderAgentId: 'leader-a',
    studentUserId: 'stu-1',
    tutorSessionId: 'session-1',
    projectId: null,
    idempotencyKey: 'key-replay-1',
  });
  assert.equal(view.id, 'run-a');
});

/* ------------------------------------------------------------------ */
/* F1 服务层：拒绝时 0 insert；阶段由服务端初始化；脏数据被 409 拦截    */
/* ------------------------------------------------------------------ */

function fakeDbWithProbe(queues: Map<unknown, unknown[][]>, options: { insertFailures?: unknown[] } = {}) {
  const probe = {
    selectCalls: 0,
    insertCalls: 0,
    transactionCalls: 0,
    inserts: [] as unknown[],
    updates: [] as Record<string, unknown>[],
    insertTables: [] as unknown[],
    conflicts: [] as unknown[],
  };
  const failures = [...(options.insertFailures ?? [])];
  const db: Record<string, unknown> = {
    select: () => {
      probe.selectCalls += 1;
      return {
        from: (table: unknown) => {
          const queue = queues.get(table);
          const rows = queue && queue.length > 0 ? queue.shift() : [];
          // T22：队列项允许塞 Error，用于验证「冲刷失败不回滚建 run」。
          if (rows instanceof Error) throw rows;
          return makeChain(rows ?? []);
        },
      };
    },
    insert: (table: unknown) => {
      probe.insertCalls += 1;
      probe.insertTables.push(table);
      const failure = failures.shift();
      if (failure !== undefined) {
        return {
          values: (recordValue: unknown) => {
            probe.inserts.push(recordValue);
            throw failure;
          },
        };
      }
      // 兼容 `values(...).onConflictDoNothing(...)`（直接 await）与
      // `values(...).onConflictDoNothing(...).returning(...)` 两种链式形状。
      // returning 必须返回非空行：否则 startRun/delegate 会把插入当成
      // 「幂等冲突被跳过」（inserted.length === 0）而提前 return，
      // 永远不会走到 T22 的账本冲刷段。
      const tail: Record<string, unknown> = {
        returning: () => Promise.resolve([{ id: 'fake-inserted-row' }]),
        then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => Promise.resolve([]).then(onFulfilled, onRejected),
      };
      return {
        values: (recordValue: unknown) => {
          probe.inserts.push(recordValue);
          return {
            onConflictDoNothing: (cfg?: unknown) => {
              probe.conflicts.push(cfg);
              return tail;
            },
          };
        },
      };
    },
    update: () => ({
      set: (patchValue: Record<string, unknown>) => {
        probe.updates.push(patchValue);
        return { where: () => Promise.resolve([]) };
      },
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      probe.transactionCalls += 1;
      return cb(db);
    },
    execute: async () => ({ rows: [] }),
  };
  return { db: db as unknown as Database, probe };
}

test('startRun refuses client-forged context.phase with 400 and provably zero inserts', async () => {
  const { db, probe } = fakeDbWithProbe(new Map<unknown, unknown[][]>());
  const service = new TeamRuntimeService(db, auditStub, outboxStub);
  await assert.rejects(
    () =>
      service.startRun(STU, {
        leaderAgentId: 'leader-a',
        studentUserId: 'stu-1',
        context: { phase: 'deliverable_review' },
        idempotencyKey: 'f1-forge-1',
      }),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException, `expected BadRequestException, got ${String(error)}`);
      const response = (error as BadRequestException).getResponse() as { code?: string };
      assert.equal(response.code, PBL_TEAM_ERROR_CODES.CONTEXT_RESERVED_KEY);
      return true;
    },
  );
  // 被拒时不得落库：无任何 select / insert / transaction 执行。
  assert.equal(probe.selectCalls, 0);
  assert.equal(probe.insertCalls, 0);
  assert.equal(probe.transactionCalls, 0);
  assert.equal(probe.inserts.length, 0);
});

test('startRun initializes run.context.phase to the first frozen phase server-side', async () => {
  const queues = new Map<unknown, unknown[][]>([
    [agentConfigs, [[agentRow('leader-a')]]],
    [
      agentTeamRuns,
      [
        [],
        [],
        [fullRunRow({ context: { topic: 'thunder-fighter', phase: 'exploration' } })],
      ],
    ],
  ]);
  const { db, probe } = fakeDbWithProbe(queues);
  const service = new TeamRuntimeService(db, auditStub, outboxStub);
  const view = await service.startRun(STU, {
    leaderAgentId: 'leader-a',
    studentUserId: 'stu-1',
    tutorSessionId: 'session-1',
    context: { topic: 'thunder-fighter', turnCount: 3 },
    idempotencyKey: 'f1-init-1',
  });
  const runInsert = probe.inserts.find((recordValue) => recordValue !== null && typeof recordValue === 'object' && 'leaderAgentId' in (recordValue as Record<string, unknown>)) as Record<string, unknown>;
  assert.ok(runInsert, 'expected an agent_team_runs insert');
  assert.deepEqual(runInsert.context, { topic: 'thunder-fighter', turnCount: 3, phase: PBL_INITIAL_PHASE });
  assert.equal((view.context as Record<string, unknown>).phase, 'exploration');
});

test('a polluted run claiming a later phase without gate evidence is refused with 409 at every gate read', async () => {
  // 纯函数：声称处于后续阶段但缺少前置门禁事件 → 视为伪造/历史污染。
  assert.throws(
    () => assertRunPhaseConsistent('deliverable_review', new Set<string>()),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(((error as ConflictException).getResponse() as { code?: string }).code, PBL_TEAM_ERROR_CODES.PHASE_ORDER_INVALID);
      return true;
    },
  );

  // 服务层：即使 context.phase 是合法枚举值（旧脏数据），进入 guided_practice
  // 的委派仍被 409 挡住，且没有落任何任务。
  const queues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[fullRunRow({ context: { phase: 'guided_practice' } })]]],
    [agentTeamEvents, [[]]],
  ]);
  const { db, probe } = fakeDbWithProbe(queues);
  const service = new TeamRuntimeService(db, auditStub, outboxStub);
  await assert.rejects(
    () =>
      service.delegate(STU, 'run-1', {
        senderAgentId: 'leader-a',
        recipientAgentId: 'fighter-code-guide',
        taskType: 'code.mentor',
        idempotencyKey: 'f1-polluted-1',
        pblPhase: 'guided_practice',
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(((error as ConflictException).getResponse() as { code?: string }).code, PBL_TEAM_ERROR_CODES.PHASE_ORDER_INVALID);
      return true;
    },
  );
  assert.equal(probe.inserts.length, 0);

  // getPhaseStatus 同样不得把脏阶段当作有效状态继续报状态。
  const statusQueues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[fullRunRow({ context: { phase: 'deliverable_review' } })]]],
    [agentTeamEvents, [[]]],
  ]);
  const statusService = new TeamRuntimeService(fakeDb(statusQueues), auditStub, outboxStub);
  await assert.rejects(
    () => statusService.getPhaseStatus(STU, 'run-1'),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(((error as ConflictException).getResponse() as { code?: string }).code, PBL_TEAM_ERROR_CODES.PHASE_ORDER_INVALID);
      return true;
    },
  );
});

test('advancePhase stays the only phase writer: two sequential advances follow the frozen order', async () => {
  const run0 = fullRunRow({ context: { phase: 'exploration' } });
  const run1 = fullRunRow({ context: { phase: 'concept_mastery' } });
  const intentGate = {
    id: 'ev-intent',
    runId: 'run-1',
    taskId: null,
    topic: 'team.gate.satisfied',
    sequence: 0,
    payload: { gate: 'student_confirmed_intent', phase: 'exploration', evidenceRef: 'projects:intent:1', source: 'server' },
    occurredAt: new Date('2026-11-05T00:30:00.000Z'),
    createdAt: new Date('2026-11-05T00:30:00.000Z'),
  };
  const queues = new Map<unknown, unknown[][]>([
    // 调用1：getRunRow → run0；推进后回读 → run1。调用2：getRunRow → run1。
    [agentTeamRuns, [[run0], [run1], [run1]]],
    // 调用1：loadSatisfiedGates → [intent]；recordEvent 查重 → []。
    // 调用2：loadSatisfiedGates → [intent]；gate.blocked 查重 → []。
    [agentTeamEvents, [[intentGate], [], [intentGate], []]],
  ]);
  const { db, probe } = fakeDbWithProbe(queues);
  const service = new TeamRuntimeService(db, auditStub, outboxStub);

  const first = await service.advancePhase(STU, 'run-1', {
    targetPhase: 'concept_mastery',
    trigger: 'manual',
    idempotencyKey: 'seq-1',
  });
  assert.equal(first.phase, 'concept_mastery');
  assert.equal(first.previousPhase, 'exploration');
  assert.equal(probe.updates.length, 1, 'exactly one context phase write by the server');
  const writtenContext = (probe.updates[0] as Record<string, unknown>).context as Record<string, unknown>;
  assert.equal(writtenContext.phase, 'concept_mastery');

  // 第二次尝试（没有 TheoryMastered 证据）：409 拒绝，且不再有第二次阶段写入。
  await assert.rejects(
    () => service.advancePhase(STU, 'run-1', { targetPhase: 'guided_practice', trigger: 'manual', idempotencyKey: 'seq-2' }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(((error as ConflictException).getResponse() as { code?: string }).code, 'PBL_GATE_THEORY_MASTERED_REQUIRED');
      return true;
    },
  );
  assert.equal(probe.updates.length, 1, 'rejected advance must not write the phase');
});

test('advancePhase throws 409 PBL_GATE_THEORY_MASTERED_REQUIRED when the gate event is absent', async () => {
  // 真实场景：探索阶段门禁（学生意图）已经服务端确认，唯独 TheoryMastered
  // 尚未达成 —— 此时任何进入 guided_practice 的推进必须被 409 拒绝。
  const intentGate = {
    id: 'ev-intent',
    runId: 'run-1',
    taskId: null,
    topic: 'team.gate.satisfied',
    sequence: 0,
    payload: { gate: 'student_confirmed_intent', phase: 'exploration', evidenceRef: 'projects:intent:1', source: 'server' },
    occurredAt: new Date('2026-11-05T00:30:00.000Z'),
    createdAt: new Date('2026-11-05T00:30:00.000Z'),
  };
  const queues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[fullRunRow()]]],
    [agentTeamEvents, [[intentGate], []]],
  ]);
  const service = new TeamRuntimeService(fakeDb(queues), auditStub, outboxStub);
  await assert.rejects(
    () =>
      service.advancePhase(STU, 'run-1', {
        targetPhase: 'guided_practice',
        trigger: 'manual',
        idempotencyKey: 'adv-1',
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      const response = (error as ConflictException).getResponse() as { code?: string };
      assert.equal(response.code, 'PBL_GATE_THEORY_MASTERED_REQUIRED');
      return true;
    },
  );
});

test('advancePhase succeeds once TheoryMastered evidence was recorded server-side', async () => {
  const gateEvent = (gate: string) => ({
    id: `ev-${gate}`,
    runId: 'run-1',
    taskId: null,
    topic: 'team.gate.satisfied',
    sequence: 0,
    payload: { gate, phase: 'concept_mastery', evidenceRef: 'mastery:check:1', source: 'server' },
    occurredAt: new Date('2026-11-05T01:00:00.000Z'),
    createdAt: new Date('2026-11-05T01:00:00.000Z'),
  });
  const queues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[fullRunRow()], [fullRunRow({ context: { phase: 'guided_practice' } })]]],
    [agentTeamEvents, [[gateEvent('student_confirmed_intent'), gateEvent('TheoryMastered')], []]],
  ]);
  const service = new TeamRuntimeService(fakeDb(queues), auditStub, outboxStub);
  const result = await service.advancePhase(STU, 'run-1', {
    targetPhase: 'guided_practice',
    trigger: 'manual',
    idempotencyKey: 'adv-2',
  });
  assert.equal(result.phase, 'guided_practice');
  assert.equal(result.previousPhase, 'concept_mastery');
});

test('getPhaseStatus reports server gate state without leaking raw content', async () => {
  const queues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[fullRunRow()]]],
    [
      agentTeamEvents,
      [[{ payload: { gate: 'student_confirmed_intent' } }]],
    ],
  ]);
  const service = new TeamRuntimeService(fakeDb(queues), auditStub, outboxStub);
  const status = await service.getPhaseStatus(STU, 'run-1');
  assert.equal(status.phase, 'concept_mastery');
  assert.equal(status.nextPhase, 'guided_practice');
  assert.equal(status.requiredGateForNext, 'TheoryMastered');
  assert.equal(status.nextGateErrorCode, 'PBL_GATE_THEORY_MASTERED_REQUIRED');
  assert.equal(status.allowAutonomousAdvance, false);
  assert.equal(status.theoryMasteredGate, true);
  assert.deepEqual(status.satisfiedGates, ['student_confirmed_intent']);
});

test('recordGateSatisfied refuses student-authored gate evidence', async () => {
  const queues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[fullRunRow()]]],
    [agentTeamEvents, [[], []]],
  ]);
  const service = new TeamRuntimeService(fakeDb(queues), auditStub, outboxStub);
  await assert.rejects(
    () => service.recordGateSatisfied(STU, 'run-1', { gate: 'TheoryMastered' }, 'gate-1'),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      const response = (error as ConflictException).getResponse() as { code?: string };
      assert.equal(response.code, 'TEAM_GATE_WRITE_FORBIDDEN');
      return true;
    },
  );
  // 管理员写入走同一 recordEvent 幂等路径（事件主题固定）。
  const adminQueues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[fullRunRow()]]],
    [agentTeamEvents, [[], []]],
  ]);
  const adminService = new TeamRuntimeService(fakeDb(adminQueues), auditStub, outboxStub);
  const recorded = await adminService.recordGateSatisfied(ADMIN, 'run-1', { gate: 'TheoryMastered', evidenceRef: 'mastery:run:9', source: 'server_backfill' }, 'gate-2');
  assert.equal(recorded.gate, 'TheoryMastered');
  assert.equal(recorded.phase, 'concept_mastery');
});

test('listSessionStreamFrames emits distinguishable, sanitized team frames', async () => {
  const run = fullRunRow({ id: 'run-1', leaderAgentId: 'leader-a' });
  const phaseEvent = {
    id: 'ev-phase',
    runId: 'run-1',
    taskId: null,
    topic: 'team.phase_advanced',
    sequence: 1,
    payload: { previousPhase: 'exploration', phase: 'concept_mastery', passedGate: 'student_confirmed_intent', content: '学生原始对话，绝不应出现在帧里' },
    occurredAt: new Date('2026-11-05T02:00:00.000Z'),
    createdAt: new Date('2026-11-05T02:00:00.000Z'),
  };
  const blockedEvent = {
    ...phaseEvent,
    id: 'ev-blocked',
    topic: 'team.gate.blocked',
    payload: { attemptedPhase: 'guided_practice', requiredGate: 'TheoryMastered', errorCode: 'PBL_GATE_THEORY_MASTERED_REQUIRED' },
    occurredAt: new Date('2026-11-05T02:05:00.000Z'),
    createdAt: new Date('2026-11-05T02:05:00.000Z'),
  };
  const thinkingEvent = {
    ...phaseEvent,
    id: 'ev-think',
    topic: 'team.model.thinking',
    payload: { agentId: 'fighter-concept-coach', stageLabel: '概念讲解进行中' },
    occurredAt: new Date('2026-11-05T02:07:00.000Z'),
    createdAt: new Date('2026-11-05T02:07:00.000Z'),
  };
  const taskRow = {
    id: 'task-1',
    runId: 'run-1',
    parentTaskId: null,
    agentId: 'fighter-concept-coach',
    taskType: 'concept.explain',
    status: 'queued',
    input: { pblPhase: 'concept_mastery' },
    output: null,
    errorCode: null,
    attempts: 0,
    maxAttempts: 3,
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-11-05T02:10:00.000Z'),
  };
  const queues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[run]]],
    [agentTeamEvents, [[phaseEvent, blockedEvent, thinkingEvent]]],
    [agentTeamTasks, [[taskRow]]],
  ]);
  const service = new TeamRuntimeService(fakeDb(queues), auditStub, outboxStub);
  const frames = await service.listSessionStreamFrames(STU, 'session-1', { since: new Date('2026-11-05T01:59:00.000Z') });
  const kinds = frames.map((frame) => frame.kind);
  assert.deepEqual(kinds, ['phase_advanced', 'gate_blocked', 'thinking', 'member_delegated']);
  const serialized = JSON.stringify(frames);
  assert.equal(serialized.includes('学生原始对话'), false, 'raw student text must never appear in team frames');
  assert.equal(frames[0]?.data.frame, TEAM_FRAME_NAMES.phase_advanced);
  assert.equal(frames[1]?.data.errorCode, 'PBL_GATE_THEORY_MASTERED_REQUIRED');
  assert.equal(frames[3]?.data.recipientAgentId, 'fighter-concept-coach');
  assert.equal(frames[3]?.data.pblPhase, 'concept_mastery');
  // 帧载荷构造器同样剥离原文（与 SSE 层共享的机制）。
  const data = buildTeamFrameData('tool_invoked', { toolName: 'knowledge_search', status: 'done', text: '工具输出原文' });
  assert.equal(data.frame, 'team.tool_invoked');
  assert.equal('text' in data, false);
});

/* ------------------------------------------------------------------ */
/* F2：班主任唯一性的 DB 层兜底（迁移 0021 部分唯一索引 + 23505→409）   */
/* ------------------------------------------------------------------ */

function uniqueViolation23505(): Error {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "agent_team_runs_active_mentor_unique_idx"'),
    { code: '23505' },
  );
}

function countingAudit() {
  const calls: unknown[] = [];
  return { calls, writer: { write: async (entry: unknown) => { calls.push(entry); return 'audit-id'; } } as never };
}

test('F2 竞态败者：插入命中班主任唯一索引 23505 → 409 TEAM_MENTOR_UNIQUENESS_CONFLICT，且无第二行、无审计', async () => {
  // 时间线：败者 startRun(leader-b) 通过 check-then-insert（活跃 run 查询返回空），
  // 真正 INSERT 时被迁移 0021 的部分唯一索引拒绝（胜者 leader-a 的 run 在检查之后落库）。
  const winner = fullRunRow({ id: 'run-race', leaderAgentId: 'leader-a', tutorSessionId: 'session-1' });
  const queues = new Map<unknown, unknown[][]>([
    [agentConfigs, [[agentRow('leader-b')]]],
    // 1) 按幂等键查 existing → 空；2) 活跃 run 检查 → 空（竞态窗口）；3) 冲突后重读 → 胜者。
    [agentTeamRuns, [[], [], [winner]]],
  ]);
  const { db, probe } = fakeDbWithProbe(queues, { insertFailures: [uniqueViolation23505()] });
  const audit = countingAudit();
  const service = new TeamRuntimeService(db, audit.writer, outboxStub);
  await assert.rejects(
    () =>
      service.startRun(STU, {
        leaderAgentId: 'leader-b',
        studentUserId: 'stu-1',
        tutorSessionId: 'session-2',
        idempotencyKey: 'key-race-conflict',
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException, `expected ConflictException, got ${String(error)}`);
      const response = (error as ConflictException).getResponse() as { code?: string; message?: string };
      assert.equal(response.code, 'TEAM_MENTOR_UNIQUENESS_CONFLICT');
      assert.match(response.message ?? '', /班主任/);
      return true;
    },
  );
  // probe 计数：败者事务只尝试过一次 INSERT（且被唯一索引拒绝、随事务回滚），
  // 绝不允许出现第二次插入或任何审计写入 —— 即不存在「双活跃 run」。
  assert.equal(probe.insertCalls, 1);
  assert.equal(probe.inserts.length, 1);
  assert.equal(probe.transactionCalls, 1);
  assert.equal(audit.calls.length, 0, '回滚的败者事务不得留下审计');
});

test('F2 竞态败者与胜者同 leader+同会话+同项目 → 保持既有语义：幂等重放胜者 run，不 409', async () => {
  const twin = fullRunRow({ id: 'run-twin', leaderAgentId: 'leader-a', tutorSessionId: 'session-1', projectId: null });
  const queues = new Map<unknown, unknown[][]>([
    [agentConfigs, [[agentRow('leader-a')]]],
    [agentTeamRuns, [[], [], [twin]]],
  ]);
  const { db, probe } = fakeDbWithProbe(queues, { insertFailures: [uniqueViolation23505()] });
  const audit = countingAudit();
  const service = new TeamRuntimeService(db, audit.writer, outboxStub);
  const view = await service.startRun(STU, {
    leaderAgentId: 'leader-a',
    studentUserId: 'stu-1',
    tutorSessionId: 'session-1',
    projectId: null,
    idempotencyKey: 'key-race-replay',
  });
  assert.equal(view.id, 'run-twin', '完全匹配时必须重放既有活跃 run');
  assert.equal(probe.insertCalls, 1, '重放路径不得二次插入');
  assert.equal(audit.calls.length, 0, '重放败者不得重复审计');
});

test('F2 同 leader 但不同会话/项目的竞态：无法安全重放 → 明确 409（DB 一生活跃 run 语义）', async () => {
  const winner = fullRunRow({ id: 'run-other-session', leaderAgentId: 'leader-a', tutorSessionId: 'session-1' });
  const queues = new Map<unknown, unknown[][]>([
    [agentConfigs, [[agentRow('leader-a')]]],
    [agentTeamRuns, [[], [], [winner]]],
  ]);
  const { db } = fakeDbWithProbe(queues, { insertFailures: [uniqueViolation23505()] });
  const service = new TeamRuntimeService(db, auditStub, outboxStub);
  await assert.rejects(
    () =>
      service.startRun(STU, {
        leaderAgentId: 'leader-a',
        studentUserId: 'stu-1',
        tutorSessionId: 'session-2',
        idempotencyKey: 'key-race-allow-branch',
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      const response = (error as ConflictException).getResponse() as { code?: string; message?: string };
      assert.equal(response.code, PBL_TEAM_ERROR_CODES.MENTOR_UNIQUENESS_CONFLICT);
      assert.match(response.message ?? '', /活跃 run/);
      return true;
    },
  );
});

test('F2 isUniqueViolationError 识别 pg 直抛与 driverError 包装两种 23505 形状，拒绝误吞其他错误', () => {
  assert.equal(isUniqueViolationError(Object.assign(new Error('dup'), { code: '23505' })), true);
  assert.equal(isUniqueViolationError(Object.assign(new Error('dup'), { driverError: { code: '23505' } })), true);
  assert.equal(isUniqueViolationError(Object.assign(new Error('fk'), { code: '23503' })), false);
  assert.equal(isUniqueViolationError('not-an-error'), false);
  assert.equal(isUniqueViolationError(undefined), false);
});

/* 文件级断言：迁移 0021 / journal / schema 声明三处一致（可证伪的落盘证据）。 */

function repoRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, 'database', 'migrations', 'meta', '_journal.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo root with database/migrations not found from ' + process.cwd());
}

test('migration 0021 pins the active-mentor partial unique index; journal monotonic; schema synced', () => {
  const root = repoRoot();
  const migrations = join(root, 'database', 'migrations');
  const up = readFileSync(join(migrations, '0021_agent_team_run_mentor_uniqueness.sql'), 'utf8');
  const down = readFileSync(join(migrations, '0021_agent_team_run_mentor_uniqueness.down.sql'), 'utf8');
  assert.match(up, /CREATE UNIQUE INDEX IF NOT EXISTS "agent_team_runs_active_mentor_unique_idx"/);
  assert.match(up, /ON "agent_team_runs" \("student_user_id"\)/);
  assert.match(up, /WHERE "status" IN \('queued', 'running'\)/);
  assert.match(down, /DROP INDEX IF EXISTS "agent_team_runs_active_mentor_unique_idx"/);

  const journal = JSON.parse(readFileSync(join(migrations, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; when: number; tag: string }>;
  };
  // 不假设序号连续：main 可能已有其它分支占用中间 idx（如 0020_enable_team_agents），
  // 只要求 idx 严格递增且尾条是本分支的 0021。
  const idxs = journal.entries.map((entry) => entry.idx);
  for (let i = 1; i < idxs.length; i += 1) {
    assert.ok(idxs[i]! > idxs[i - 1]!, 'journal idx 必须严格递增');
  }
  const last = journal.entries[journal.entries.length - 1]!;
  const previous = journal.entries[journal.entries.length - 2]!;
  assert.equal(last.idx, 21);
  assert.equal(last.tag, '0021_agent_team_run_mentor_uniqueness');
  assert.ok(last.when > previous.when, 'journal when 必须严格递增');
  assert.ok(existsSync(join(migrations, `${last.tag}.sql`)), 'tag 必须与 up 文件名一致');
  assert.ok(existsSync(join(migrations, `${last.tag}.down.sql`)), 'tag 必须与 down 文件名一致');

  // schema 声明与迁移同步：agent_team_runs 上必须有同名部分唯一索引。
  const schema = readFileSync(join(root, 'packages', 'database', 'src', 'schema', 'team-runtime.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(schema, /uniqueIndex\('agent_team_runs_active_mentor_unique_idx'\)/);
  assert.match(schema, /\.on\(table\.studentUserId\)\s*\.where\(sql`status IN \('queued', 'running'\)`\)/);
});

/* ------------------------------------------------------------------ */
/* T14：recordGateForStudent —— 门禁证据的唯一内部写入通道              */
/* ------------------------------------------------------------------ */

function auditSpy() {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    write: async (entry: Record<string, unknown>) => {
      calls.push(entry);
      return 'audit-id';
    },
  };
}

function newServiceWithProbe(queues: Map<unknown, unknown[][]>) {
  const { db, probe } = fakeDbWithProbe(queues);
  const audit = auditSpy();
  const service = new TeamRuntimeService(db, audit as never, outboxStub);
  return { service, probe, audit };
}

function gateEventInserts(inserts: unknown[]) {
  return inserts.filter((recordValue) => (recordValue as Record<string, unknown> | null)?.topic === 'team.gate.satisfied') as Record<string, unknown>[];
}

test('recordGateForStudent: no active run → deferred 记账到待冲刷账本，零事件零审计，永不抛错；重复记账靠唯一索引仍只有一行', async () => {
  const queues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[], []]],
  ]);
  // 第二次账本插入模拟唯一索引 23505 冲突：必须被吞掉且仍返回 deferred（记账失败不得影响业务域）。
  const { db, probe } = fakeDbWithProbe(queues, { insertFailures: [undefined, uniqueViolation23505()] });
  const audit = auditSpy();
  const service = new TeamRuntimeService(db, audit as never, outboxStub);
  const input = { studentUserId: 'stu-1', gate: 'TheoryMastered', evidenceRef: 'mastery:check:1', source: 'learning-plan.theory-mastered' };
  const result = await service.recordGateForStudent(input);
  assert.deepEqual(result, { status: 'deferred', runId: null, gate: 'TheoryMastered', reason: 'pending_gate_evidence' });
  const second = await service.recordGateForStudent(input);
  assert.deepEqual(second, { status: 'deferred', runId: null, gate: 'TheoryMastered', reason: 'pending_gate_evidence' });
  // 两次尝试都打到同一张账本表；DB 层由唯一索引去重 → 一活行。第一次尝试
  // 必须声明幂等目标三元组 (student_user_id, gate, evidence_ref)；第二次在
  // values() 处即抛 23505（唯一索引冲突的真实形状），不会走到 onConflictDoNothing。
  const ledgerInserts = probe.inserts.filter((recordValue) => (recordValue as Record<string, unknown> | null)?.gate === 'TheoryMastered' && !(recordValue as Record<string, unknown>)?.topic);
  assert.equal(ledgerInserts.length, 2);
  assert.equal(probe.conflicts.length, 1, 'first ledger insert must use onConflictDoNothing');
  assert.deepEqual((probe.conflicts[0] as { target?: unknown }).target, [pblGateEvidence.studentUserId, pblGateEvidence.gate, pblGateEvidence.evidenceRef]);
  assert.equal(gateEventInserts(probe.inserts).length, 0);
  assert.equal(audit.calls.length, 0);
});

test('recordGateForStudent: active run → recorded, event payload and audit exactly right', async () => {
  const queues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[fullRunRow({ id: 'run-9', studentUserId: 'stu-1' })]]],
    [agentTeamEvents, [[], []]],
  ]);
  const { service, probe, audit } = newServiceWithProbe(queues);
  const result = await service.recordGateForStudent({
    studentUserId: 'stu-1',
    gate: 'TheoryMastered',
    evidenceRef: 'mastery:check:7',
    source: 'learning-plan.theory-mastered',
  });
  assert.equal(result.status, 'recorded');
  assert.equal(result.runId, 'run-9');
  assert.equal(result.gate, 'TheoryMastered');
  const events = gateEventInserts(probe.inserts);
  assert.equal(events.length, 1);
  const payload = events[0]?.payload as Record<string, unknown>;
  assert.equal(payload.gate, 'TheoryMastered');
  assert.equal(payload.phase, 'concept_mastery');
  assert.equal(payload.evidenceRef, 'mastery:check:7');
  assert.equal(payload.source, 'learning-plan.theory-mastered');
  assert.equal(events[0]?.idempotencyKey, 'gate:stu-1:TheoryMastered:mastery:check:7');
  assert.equal(audit.calls.length, 1);
  const entry = audit.calls[0] as Record<string, unknown>;
  assert.equal(entry.action, 'agent.team_gate.satisfied');
  assert.equal(entry.actorId, 'system:pbl-gate');
  assert.equal(entry.actorRole, 'system');
  const detail = entry.detail as Record<string, unknown>;
  assert.equal(detail.studentUserId, 'stu-1');
  assert.equal(detail.gate, 'TheoryMastered');
  assert.equal(detail.evidenceRef, 'mastery:check:7');
  assert.equal(detail.source, 'learning-plan.theory-mastered');
});

test('recordGateForStudent: same inputs replay as already_satisfied without second event or audit', async () => {
  const run = fullRunRow({ id: 'run-9', studentUserId: 'stu-1' });
  const queues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[run], [run]]],
    // 统一写入路径后每次调用只做一次同键查重：第一次 [] → 插入；第二次命中 [{id}] → already_satisfied。
    [agentTeamEvents, [[], [{ id: 'ev-gate-1' }]]],
  ]);
  const { service, probe, audit } = newServiceWithProbe(queues);
  const input = { studentUserId: 'stu-1', gate: 'TheoryMastered' as const, evidenceRef: 'mastery:check:7', source: 'learning-plan.theory-mastered' };
  const first = await service.recordGateForStudent(input);
  assert.equal(first.status, 'recorded');
  const second = await service.recordGateForStudent(input);
  assert.deepEqual(second, { status: 'already_satisfied', runId: 'run-9', gate: 'TheoryMastered' });
  assert.equal(gateEventInserts(probe.inserts).length, 1);
  assert.equal(audit.calls.length, 1);
});

test('recordGateForStudent: unknown gate throws PBL_GATE_UNKNOWN before touching the database', async () => {
  const { service, probe, audit } = newServiceWithProbe(new Map<unknown, unknown[][]>());
  await assert.rejects(
    () => service.recordGateForStudent({
      studentUserId: 'stu-1',
      gate: 'TheoryMasteredPleaseIgnore',
      evidenceRef: 'x:1',
      source: 'evil',
    }),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal(((error as BadRequestException).getResponse() as { code?: string }).code, PBL_TEAM_ERROR_CODES.GATE_UNKNOWN);
      return true;
    },
  );
  assert.equal(probe.selectCalls, 0);
  assert.equal(gateEventInserts(probe.inserts).length, 0);
  assert.equal(audit.calls.length, 0);
});

test('recordGateForStudent: different evidenceRef are different evidence, each recorded once', async () => {
  const run = fullRunRow({ id: 'run-9', studentUserId: 'stu-1' });
  const queues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[run], [run]]],
    [agentTeamEvents, [[], [], [], []]],
  ]);
  const { service, probe, audit } = newServiceWithProbe(queues);
  const a = await service.recordGateForStudent({ studentUserId: 'stu-1', gate: 'student_confirmed_intent', evidenceRef: 'intent_confirmation:aaa', source: 'projects.confirm-intent' });
  const b = await service.recordGateForStudent({ studentUserId: 'stu-1', gate: 'student_confirmed_intent', evidenceRef: 'intent_confirmation:bbb', source: 'projects.confirm-intent' });
  assert.equal(a.status, 'recorded');
  assert.equal(b.status, 'recorded');
  const events = gateEventInserts(probe.inserts);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.idempotencyKey, 'gate:stu-1:student_confirmed_intent:intent_confirmation:aaa');
  assert.equal(events[1]?.idempotencyKey, 'gate:stu-1:student_confirmed_intent:intent_confirmation:bbb');
  assert.equal(audit.calls.length, 2);
});

test('recordGateForStudent is internal-only: team-runtime.controller.ts never references it or the ledger', () => {
  const controllerPath = join(repoRoot(), 'services', 'api', 'src', 'modules', 'team-runtime', 'team-runtime.controller.ts');
  assert.ok(existsSync(controllerPath), 'controller source must exist at ' + controllerPath);
  const src = readFileSync(controllerPath, 'utf8');
  assert.equal(src.includes('recordGateForStudent'), false, 'no HTTP route may expose recordGateForStudent');
  assert.equal(src.includes('pblGateEvidence'), false, 'no HTTP route may expose the pending gate ledger');
  assert.equal(src.includes('pbl_gate_evidence'), false, 'no HTTP route may name the ledger table');
  assert.equal(src.includes('flushPending'), false, 'no HTTP route may trigger the flush');
});


/* ------------------------------------------------------------------ */
/* T22：待冲刷账本 → startRun 物化（解「先确认后建 run」永久 409 死锁）  */
/* ------------------------------------------------------------------ */

function ledgerRow(over: Record<string, unknown> = {}) {
  return {
    id: 'pblge-1',
    studentUserId: 'stu-1',
    gate: 'student_confirmed_intent',
    evidenceRef: 'intent_confirmation:abc',
    source: 'projects.confirm-intent',
    createdAt: new Date('2026-11-06T00:00:00.000Z'),
    consumedRunId: null,
    consumedAt: null,
    ...over,
  };
}

test('T22 main regression: deferred ledger row → startRun flushes it → gate satisfied → advancePhase exploration→concept_mastery succeeds', async () => {
  const created = fullRunRow({ id: 'run-1', studentUserId: 'stu-1', status: 'queued', context: { topic: 'thunder-fighter', phase: 'exploration' } });
  const conceptRun = fullRunRow({ id: 'run-1', studentUserId: 'stu-1', status: 'running', context: { topic: 'thunder-fighter', phase: 'concept_mastery' } });
  const flushedGateEvent = { payload: { gate: 'student_confirmed_intent', phase: 'exploration', evidenceRef: 'intent_confirmation:abc', source: 'projects.confirm-intent', via: 'ledger_flush' } };
  const queues = new Map<unknown, unknown[][]>([
    [agentConfigs, [[agentRow('leader-a')]]],
    [agentTeamRuns, [
      [],                     // p1 recordGateForStudent 活跃 run 查询 → 无
      [],                     // p2 startRun 幂等查询
      [],                     // p2 startRun 活跃 run 查询
      [created],              // p2 事务后回读
      [created],              // p3 getPhaseStatus
      [created],              // p4 advancePhase getRunRow
      [conceptRun],           // p4 推进后回读
    ]],
    [agentTeamEvents, [
      [],                     // p2 冲刷查重：无同键事件 → 插入
      [flushedGateEvent],     // p3 loadSatisfiedGates
      [flushedGateEvent],     // p4 loadSatisfiedGates
      [],                     // p4 recordEvent(phase_advanced) 查重
    ]],
    [pblGateEvidence, [[ledgerRow()]]], // p2 冲刷 select
  ]);
  const { db, probe } = fakeDbWithProbe(queues);
  const audit = auditSpy();
  const service = new TeamRuntimeService(db, audit as never, outboxStub);

  // p1：无 run → deferred 落账本 1 行。
  const deferred = await service.recordGateForStudent({
    studentUserId: 'stu-1',
    gate: 'student_confirmed_intent',
    evidenceRef: 'intent_confirmation:abc',
    source: 'projects.confirm-intent',
  });
  assert.equal(deferred.status, 'deferred');
  assert.equal(deferred.reason, 'pending_gate_evidence');
  assert.equal(probe.insertTables.filter((table) => table === pblGateEvidence).length, 1);
  assert.equal(gateEventInserts(probe.inserts).length, 0);

  // p2：startRun 建 run 并在同一事务内物化账本。
  const actor: CurrentUser = { id: 'stu-1', email: '', displayName: '', role: 'student' };
  const runView = await service.startRun(actor, {
    leaderAgentId: 'leader-a',
    studentUserId: 'stu-1',
    tutorSessionId: 'session-1',
    context: { topic: 'thunder-fighter' },
    idempotencyKey: 't22-run-1',
  });
  assert.equal(runView.id, 'run-1');
  const flushEvents = gateEventInserts(probe.inserts);
  assert.equal(flushEvents.length, 1, 'ledger flush must write exactly one gate event');
  const flushEvent = flushEvents[0] as Record<string, unknown>;
  assert.equal(flushEvent.idempotencyKey, 'gate:stu-1:student_confirmed_intent:intent_confirmation:abc');
  const flushPayload = flushEvent.payload as Record<string, unknown>;
  assert.equal(flushPayload.via, 'ledger_flush');
  assert.equal(flushPayload.gate, 'student_confirmed_intent');
  // 冲刷成功后 consumed_run_id/consumed_at 落值，且 run_id 与事件 runId 一致。
  const consumedUpdate = probe.updates.find((patchValue) => 'consumedRunId' in patchValue) as Record<string, unknown> | undefined;
  assert.ok(consumedUpdate, 'ledger row must be marked consumed');
  assert.equal(consumedUpdate.consumedRunId, flushEvent.runId);
  assert.equal(typeof consumedUpdate.consumedAt, 'object');

  // p3：阶段状态里 satisfiedGates 已包含该门禁。
  const status = await service.getPhaseStatus(actor, 'run-1');
  assert.deepEqual(status.satisfiedGates, ['student_confirmed_intent']);
  assert.equal(status.phase, 'exploration');
  assert.equal(status.nextPhase, 'concept_mastery');
  assert.equal(status.requiredGateForNext, null);

  // p4：探索 → 概念掌握推进成功（死锁已解）。
  const advanced = await service.advancePhase(actor, 'run-1', {
    targetPhase: 'concept_mastery',
    trigger: 'manual',
    idempotencyKey: 't22-advance-1',
  });
  assert.equal(advanced.phase, 'concept_mastery');
  assert.equal(advanced.previousPhase, 'exploration');
  // 审计：账本冲刷路径恰 1 条，detail.via='ledger_flush'。
  const gateAudits = audit.calls.filter((entry) => entry.action === 'agent.team_gate.satisfied');
  assert.equal(gateAudits.length, 1);
  assert.equal((gateAudits[0] as { detail?: Record<string, unknown> }).detail?.via, 'ledger_flush');
});

test('T22: direct recorded path never writes the ledger (no double-path duplication)', async () => {
  const queues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[fullRunRow({ id: 'run-9', studentUserId: 'stu-1' })]]],
    [agentTeamEvents, [[]]],
  ]);
  const { service, probe } = newServiceWithProbe(queues);
  const result = await service.recordGateForStudent({
    studentUserId: 'stu-1',
    gate: 'TheoryMastered',
    evidenceRef: 'mastery:check:9',
    source: 'learning-plan.theory-mastered',
  });
  assert.equal(result.status, 'recorded');
  assert.equal(probe.insertTables.filter((table) => table === pblGateEvidence).length, 0);
});

test('T22: a second startRun after terminal does not re-emit the same-key gate event', async () => {
  const runA = fullRunRow({ id: 'run-a', studentUserId: 'stu-1', status: 'queued', context: { phase: 'exploration' } });
  const runB = fullRunRow({ id: 'run-b', studentUserId: 'stu-1', status: 'queued', context: { phase: 'exploration' } });
  const queues = new Map<unknown, unknown[][]>([
    [agentConfigs, [[agentRow('leader-a')], [agentRow('leader-a')]]],
    [agentTeamRuns, [
      [], [], [runA],   // 第一次 startRun：幂等 / 活跃 / 回读
      [], [], [runB],   // 第二次 startRun（前一个已终态，活跃查询为空）
    ]],
    [agentTeamEvents, [[], []]], // 两次冲刷各自的同键查重（此处均返回空行但账本只有一行未消费）
    [pblGateEvidence, [[ledgerRow()], []]], // 第一次有账本；第二次已 consumed（空）
  ]);
  const { db, probe } = fakeDbWithProbe(queues);
  const audit = auditSpy();
  const service = new TeamRuntimeService(db, audit as never, outboxStub);
  await service.startRun(STU, { leaderAgentId: 'leader-a', studentUserId: 'stu-1', idempotencyKey: 't22-1' });
  await service.startRun(STU, { leaderAgentId: 'leader-a', studentUserId: 'stu-1', idempotencyKey: 't22-2' });
  assert.equal(gateEventInserts(probe.inserts).length, 1, 'flushed exactly once across two runs');
  assert.equal(probe.updates.filter((patchValue) => 'consumedRunId' in patchValue).length, 1);
});

test('T22: flush failure is logged and must not roll back or block run creation', async () => {
  const created = fullRunRow({ id: 'run-1', studentUserId: 'stu-1', status: 'queued', context: { phase: 'exploration' } });
  const queues = new Map<unknown, unknown[][]>([
    [agentConfigs, [[agentRow('leader-a')]]],
    [agentTeamRuns, [[], [], [created]]],
    // 队列项本身必须是 Error（shift 后直接 instanceof Error → select 抛出）。
    [pblGateEvidence, [new Error('simulated ledger read failure') as unknown as unknown[]]],
  ]);
  const { db, probe } = fakeDbWithProbe(queues);
  const audit = auditSpy();
  const service = new TeamRuntimeService(db, audit as never, outboxStub);
  const logged: string[] = [];
  const original = Logger.prototype.error;
  Logger.prototype.error = ((message: unknown) => {
    logged.push(String(message));
    return true;
  }) as typeof Logger.prototype.error;
  try {
    const runView = await service.startRun(STU, { leaderAgentId: 'leader-a', studentUserId: 'stu-1', idempotencyKey: 't22-flush-fail' });
    assert.equal(runView.id, 'run-1', 'run must still be created when the flush fails');
  } finally {
    Logger.prototype.error = original;
  }
  assert.equal(logged.some((line) => line.includes('冲刷失败')), true, 'flush failure must be logged, not silently swallowed');
  assert.equal(gateEventInserts(probe.inserts).length, 0);
  assert.equal(probe.updates.filter((patchValue) => 'consumedRunId' in patchValue).length, 0, 'failed flush must not mark ledger consumed');
});


/* ------------------------------------------------------------------ */
/* T25：门禁证据治理 —— evidenceRef 必填 + 按 gate 细分 source 白名单    */
/* ------------------------------------------------------------------ */

test('T25: admin gate write without usable evidenceRef → 400 PBL_GATE_EVIDENCE_REQUIRED, zero writes', async () => {
  for (const bad of [undefined, '', '   ', 'short']) {
    const queues = new Map<unknown, unknown[][]>([
      [agentTeamRuns, [[fullRunRow()]]],
      [agentTeamEvents, [[], []]],
    ]);
    const { db, probe } = fakeDbWithProbe(queues);
    const audit = auditSpy();
    const service = new TeamRuntimeService(db, audit as never, outboxStub);
    await assert.rejects(
      () => service.recordGateSatisfied(ADMIN, 'run-1', { gate: 'TheoryMastered', evidenceRef: bad, source: 'server_backfill' }, `t25-ev-${String(bad) || 'missing'}`),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(((error as BadRequestException).getResponse() as { code?: string }).code, PBL_TEAM_ERROR_CODES.GATE_EVIDENCE_REQUIRED);
        return true;
      },
    );
    assert.equal(gateEventInserts(probe.inserts).length, 0);
    assert.equal(audit.calls.length, 0);
  }
});

test('T25: gate=TheoryMastered + source=runner → 400 PBL_GATE_SOURCE_NOT_ALLOWED, zero writes', async () => {
  const queues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[fullRunRow()]]],
    [agentTeamEvents, [[], []]],
  ]);
  const { db, probe } = fakeDbWithProbe(queues);
  const audit = auditSpy();
  const service = new TeamRuntimeService(db, audit as never, outboxStub);
  await assert.rejects(
    () => service.recordGateSatisfied(ADMIN, 'run-1', { gate: 'TheoryMastered', evidenceRef: 'mastery:run:42', source: 'runner' }, 't25-src'),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal(((error as BadRequestException).getResponse() as { code?: string }).code, PBL_TEAM_ERROR_CODES.GATE_SOURCE_NOT_ALLOWED);
      return true;
    },
  );
  assert.equal(gateEventInserts(probe.inserts).length, 0);
  assert.equal(audit.calls.length, 0);
});

test('T25 table-driven: every gate accepts its whitelisted sources and writes exactly once', async () => {
  const cases: Array<{ gate: string; source: string; evidenceRef: string }> = [
    { gate: 'student_confirmed_intent', source: 'projects.confirm-intent', evidenceRef: 'intent_confirmation:t25-1' },
    { gate: 'student_confirmed_intent', source: 'mentor_review', evidenceRef: 'mentor:review:t25-1b' },
    { gate: 'TheoryMastered', source: 'learning-plan.theory-mastered', evidenceRef: 'mastery:unit:t25-2' },
    { gate: 'TheoryMastered', source: 'server_backfill', evidenceRef: 'backfill:0022:t25-2b' },
    { gate: 'code_playable_run_verified', source: 'runner', evidenceRef: 'runner:play:build:t25-3' },
    { gate: 'code_playable_run_verified', source: 'mentor_review', evidenceRef: 'mentor:review:t25-3b' },
    { gate: 'review_completed_and_archived', source: 'works.publish-approved', evidenceRef: 'artifact:t25-4' },
    { gate: 'review_completed_and_archived', source: 'server_backfill', evidenceRef: 'backfill:archive:t25-4b' },
  ];
  for (const testCase of cases) {
    const queues = new Map<unknown, unknown[][]>([
      [agentTeamRuns, [[fullRunRow()]]],
      [agentTeamEvents, [[], []]],
    ]);
    const { db, probe } = fakeDbWithProbe(queues);
    const audit = auditSpy();
    const service = new TeamRuntimeService(db, audit as never, outboxStub);
    const result = await service.recordGateSatisfied(ADMIN, 'run-1', testCase, `t25-ok-${testCase.gate}-${testCase.source}`);
    assert.equal(result.gate, testCase.gate);
    const events = gateEventInserts(probe.inserts);
    assert.equal(events.length, 1, `${testCase.gate}/${testCase.source} must write exactly one event`);
    const payload = events[0]?.payload as Record<string, unknown>;
    assert.equal(payload.evidenceRef, testCase.evidenceRef);
    assert.equal(payload.source, testCase.source);
    assert.equal(audit.calls.length, 1);
    assert.equal((audit.calls[0]?.detail as Record<string, unknown>).source, testCase.source);
  }
});

test('T25: internal recordGateForStudent enforces the same whitelist via the same validator', async () => {
  const queues = new Map<unknown, unknown[][]>([
    [agentTeamRuns, [[fullRunRow({ id: 'run-9', studentUserId: 'stu-1' })]]],
    [agentTeamEvents, [[]]],
  ]);
  const { db, probe } = fakeDbWithProbe(queues);
  const audit = auditSpy();
  const service = new TeamRuntimeService(db, audit as never, outboxStub);
  await assert.rejects(
    () => service.recordGateForStudent({ studentUserId: 'stu-1', gate: 'TheoryMastered', evidenceRef: 'mastery:check:t25', source: 'works.publish-approved' }),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal(((error as BadRequestException).getResponse() as { code?: string }).code, PBL_TEAM_ERROR_CODES.GATE_SOURCE_NOT_ALLOWED);
      return true;
    },
  );
  await assert.rejects(
    () => service.recordGateForStudent({ studentUserId: 'stu-1', gate: 'TheoryMastered', evidenceRef: 'x:1', source: 'mentor_review' }),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal(((error as BadRequestException).getResponse() as { code?: string }).code, PBL_TEAM_ERROR_CODES.GATE_EVIDENCE_REQUIRED);
      return true;
    },
  );
  assert.equal(gateEventInserts(probe.inserts).length, 0);
  assert.equal(audit.calls.length, 0);
  assert.equal(probe.insertTables.filter((table) => table === pblGateEvidence).length, 0, 'rejected internal writes must not touch the ledger either');
});

test('T25: whitelist constant is the single source of truth and live call sites stay inside it', () => {
  assert.deepEqual(PBL_GATE_SOURCE_WHITELIST, {
    student_confirmed_intent: ['projects.confirm-intent', 'mentor_review', 'server_backfill'],
    TheoryMastered: ['learning-plan.theory-mastered', 'mentor_review', 'server_backfill'],
    code_playable_run_verified: ['mentor_review', 'runner', 'server_backfill'],
    review_completed_and_archived: ['works.publish-approved', 'mentor_review', 'server_backfill'],
  });
  // 表驱动校验 assertGateEvidenceWritable 本身。
  assert.deepEqual(assertGateEvidenceWritable('TheoryMastered', '  mastery:unit:77  ', 'mentor_review'), { evidenceRef: 'mastery:unit:77', source: 'mentor_review' });
  assert.throws(() => assertGateEvidenceWritable('TheoryMastered', 'ok:1', 'mentor_review'), (error: unknown) => ((error as BadRequestException).getResponse() as { code?: string }).code === PBL_TEAM_ERROR_CODES.GATE_EVIDENCE_REQUIRED);
  // 扫描全仓（team-runtime 自身除外）recordGateForStudent 字面量调用点，
  // 每个 (gate, source) 组合必须命中白名单；已接线的 projects/works 至少 2 处。
  const modulesDir = join(repoRoot(), 'services', 'api', 'src', 'modules');
  const pairs: Array<{ file: string; gate: string; source: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'team-runtime') walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        const text = readFileSync(full, 'utf8');
        for (const match of text.matchAll(/recordGateForStudent\(\s*\{[\s\S]{0,400}?\}\)/g)) {
          const body = match[0];
          const gate = body.match(/gate:\s*'([^']+)'/)?.[1];
          const source = body.match(/source:\s*'([^']+)'/)?.[1];
          if (gate !== undefined && source !== undefined) pairs.push({ file: entry.name, gate, source });
        }
      }
    }
  };
  walk(modulesDir);
  assert.ok(pairs.length >= 2, `expected wired call sites (projects/works), found ${pairs.length}`);
  for (const pair of pairs) {
    assert.ok(((PBL_GATE_SOURCE_WHITELIST as Record<string, readonly string[]>)[pair.gate] ?? []).includes(pair.source), `call site ${pair.file}: (${pair.gate}, ${pair.source}) outside whitelist`);
  }
});
