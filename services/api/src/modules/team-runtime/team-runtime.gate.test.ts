import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { agentConfigs, agentTeamEvents, agentTeamRuns, agentTeamTasks, type Database } from '@qitu/database';
import {
  PBL_ASSISTANT_BY_PHASE,
  PBL_AUTONOMOUS_ADVANCE_ALLOWED,
  PBL_GATE_BY_PHASE,
  PBL_PHASE_ORDER,
  THUNDER_FIGHTER_PBL_SPEC,
  nextPblPhase,
  pblGatesRequiredToEnter,
} from '@qitu/ai-client';
import {
  TEAM_FRAME_NAMES,
  TeamRuntimeService,
  buildTeamFrameData,
  decideDelegatedPhaseEntry,
  decideFormalProjectCreation,
  decideMentorUniqueness,
  decidePhaseAdvance,
  evaluateGateEntry,
  readRunPhaseContext,
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
  assert.equal(readRunPhaseContext({}), 'exploration');
  assert.equal(readRunPhaseContext({ phase: 'not-a-phase' }), 'exploration');
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
/* 学生未确认意图 → 不得创建正式项目 / 不得离开探索阶段                  */
/* ------------------------------------------------------------------ */

test('formal project creation is blocked while student intent is not confirmed', () => {
  const blocked = decideFormalProjectCreation(new Set<string>());
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) {
    assert.equal(blocked.status, 409);
    assert.equal(blocked.errorCode, 'PBL_GATE_STUDENT_INTENT_REQUIRED');
    assert.equal(blocked.requiredGate, 'student_confirmed_intent');
  }
  const allowed = decideFormalProjectCreation(satisfied('student_confirmed_intent'));
  assert.deepEqual(allowed, { allowed: true, phase: 'concept_mastery' });

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
  }
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
  const recorded = await adminService.recordGateSatisfied(ADMIN, 'run-1', { gate: 'TheoryMastered', evidenceRef: 'mastery:run:9' }, 'gate-2');
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
