import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_AUTO_REBASE_ATTEMPTS,
  MAX_REMEDIAL_DEPTH,
  type StudentStuckSignal,
} from '@qitu/contracts';
import type { AuditEntry } from '../../common/audit/audit-entry';
import { AuditWriter } from '../../common/audit/audit.service';
import type { OutboxEventInput } from '../../common/outbox/outbox.types';
import { OutboxWriter } from '../../common/outbox/outbox.service';
import {
  assertAppendOnlyOutlineMutation,
  buildRemediationNodePayload,
} from './append-only-guard';
import {
  assertNoRawStudentText,
  buildDesensitizedStuckSummary,
  scanDesensitized,
} from './desensitize';
import { PlanAdjustmentError } from './plan-adjustment.errors';
import {
  STUCK_SIGNAL_AUDIT_ACTION,
  STUCK_SIGNAL_OUTBOX_TOPIC,
  PlanAdjustmentService,
} from './plan-adjustment.service';
import {
  InMemoryPlanAdjustmentStore,
  type OutlineObjective,
  type PlanAdjustmentRecord,
  type RemediationNodePayload,
} from './plan-adjustment.store';
import { StuckSignalService } from './stuck-signal.service';

/** 直接实例化（不经过 Nest DI）的记录型审计 / outbox 桩。 */
class RecordingAudit extends AuditWriter {
  readonly entries: AuditEntry[] = [];
  async write(entry: AuditEntry): Promise<string> {
    this.entries.push(entry);
    return `audit-${this.entries.length}`;
  }
}

class RecordingOutbox extends OutboxWriter {
  readonly events: OutboxEventInput[] = [];
  async write(event: OutboxEventInput): Promise<string> {
    this.events.push(event);
    return event.id;
  }
  async markPublished(): Promise<void> {}
  async markFailed(): Promise<void> {}
}

function stuckSignal(overrides: Partial<StudentStuckSignal> = {}): StudentStuckSignal {
  return {
    studentId: 'stu-1',
    projectId: 'proj-1',
    planId: 'plan-1',
    sessionId: 'sess-1',
    stemNodeId: 'node-1',
    conceptId: 'kpi-1',
    trigger: 'repeated_assessment_error',
    triggerKey: 'misconception:stu-1:kpi-1:structural:3',
    errorTypeCode: 'structural',
    nodeRefs: ['node-1'],
    evidenceRefs: ['answer_attempt:a1', 'tutor_turn:sess-1:3'],
    emittedAt: '2026-10-18T10:00:00.000Z',
    ...overrides,
  };
}

function baseObjectives(): Array<Omit<OutlineObjective, 'isRemedial'> & { isRemedial?: boolean }> {
  return [
    {
      id: 'node-1',
      planId: 'plan-1',
      moduleId: 'mod-1',
      name: '理解方向',
      type: 'concept',
      objective: '能说出方向概念',
      prerequisiteIds: [],
      ordinal: 1,
    },
    {
      id: 'node-2',
      planId: 'plan-1',
      moduleId: 'mod-1',
      name: '应用步骤',
      type: 'procedure',
      objective: '能按步骤执行',
      prerequisiteIds: ['node-1'],
      ordinal: 2,
    },
  ];
}

function buildHarness(objectives = baseObjectives(), revision = 1) {
  const store = new InMemoryPlanAdjustmentStore();
  store.seedPlan('plan-1', revision, objectives);
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const adjustments = new PlanAdjustmentService(store, audit, outbox);
  const service = new StuckSignalService(store, adjustments);
  return { store, audit, outbox, adjustments, service };
}

/** 直接面向存储层（不经服务层）的 append 调整行夹具。 */
function appendAdjustment(overrides: Partial<PlanAdjustmentRecord> = {}): PlanAdjustmentRecord {
  return {
    id: 'padj-append-failure',
    projectId: 'proj-1',
    planId: 'plan-1',
    stemNodeId: 'node-1',
    baseRevision: 1,
    nextRevision: 2,
    trigger: 'repeated_assessment_error',
    evidenceRefs: ['answer_attempt:a1'],
    action: 'append_optional_remediation',
    status: 'applied',
    policyVersion: 'pbl.adjustment.v1',
    idempotencyKey: 'plan.adjustment:proj-1:node-1:repeated_assessment_error',
    triggerKey: 'misconception:stu-1:kpi-1:structural:3',
    remedialDepth: 0,
    remediationPayload: appendPayload(),
    createdAt: new Date('2026-10-18T10:00:00.000Z'),
    updatedAt: new Date('2026-10-18T10:00:00.000Z'),
    ...overrides,
  };
}

function appendPayload(): RemediationNodePayload {
  return {
    nodeId: 'remedial:node-1:1',
    moduleId: 'mod-1',
    name: '补救：方向再练',
    type: 'procedure',
    objective: '再练习一次',
    prerequisiteIds: ['node-1'],
    ordinal: 3,
    isRemedial: true,
  };
}

/** 直接面向存储层（不经服务层）的 recommend 调整行夹具。 */
function recommendAdjustment(overrides: Partial<PlanAdjustmentRecord> = {}): PlanAdjustmentRecord {
  return appendAdjustment({
    id: 'padj-recommend-failure',
    nextRevision: 1,
    trigger: 'explicit_stuck',
    triggerKey: 'explicit_help:sess-1:turn-1',
    idempotencyKey: 'plan.adjustment:proj-1:node-1:explicit_stuck',
    action: 'recommend_teacher_support',
    status: 'proposed',
    remediationPayload: null,
    ...overrides,
  });
}

test('F4: first crossing appends one remedial node + desensitized summary, no raw text in audit detail', async () => {
  const { store, audit, outbox, service } = buildHarness();

  const result = await service.ingest(stuckSignal());

  assert.equal(result.created, true);
  assert.equal(result.replayed, false);
  assert.equal(result.rebaseExhausted, false);
  assert.equal(result.adjustment?.action, 'append_optional_remediation');
  assert.equal(result.adjustment?.status, 'applied');
  assert.equal(result.adjustment?.baseRevision, 1);
  assert.equal(result.adjustment?.nextRevision, 2);

  const objectives = await store.listObjectives('plan-1');
  assert.equal(objectives.length, 3);
  const remedial = objectives.find((objective) => objective.isRemedial);
  assert.ok(remedial, 'expected one remedial node');
  assert.deepEqual(remedial.prerequisiteIds, ['node-1']);
  assert.equal(remedial.moduleId, 'mod-1');

  assert.equal(await store.readPlanRevision('plan-1'), 2);

  assertNoRawStudentText(result.summary);
  assert.equal(result.summary.priority, 'normal');
  assert.equal(result.summary.stemNodeId, 'node-1');
  assert.equal(result.summary.nodeRefs[0], 'node-1');

  assert.equal(audit.entries.length, 1);
  assert.equal(audit.entries[0]?.action, STUCK_SIGNAL_AUDIT_ACTION);
  assertNoRawStudentText(audit.entries[0]?.detail);

  assert.equal(outbox.events.length, 1);
  assert.equal(outbox.events[0]?.topic, STUCK_SIGNAL_OUTBOX_TOPIC);
  assertNoRawStudentText(outbox.events[0]?.payload);
});

test('F4: replay of the same triggerKey returns the same adjustment without duplicate rows or audit', async () => {
  const { store, audit, outbox, service } = buildHarness();
  const first = await service.ingest(stuckSignal());
  assert.equal(store.adjustmentCount, 1);
  audit.entries.length = 0;
  outbox.events.length = 0;

  const second = await service.ingest(stuckSignal());

  assert.equal(second.created, false);
  assert.equal(second.replayed, true);
  assert.equal(second.adjustment?.id, first.adjustment?.id);
  assert.equal(store.adjustmentCount, 1);
  assert.equal(audit.entries.length, 0, 'replay must not duplicate audit');
  assert.equal(outbox.events.length, 0, 'replay must not duplicate outbox');
});

test('F4: depth circuit breaker on the same stem node recommends teacher support without touching the outline', async () => {
  const { store, audit, service } = buildHarness();

  await service.ingest(stuckSignal({
    trigger: 'explicit_stuck',
    triggerKey: 'explicit_help:sess-1:turn-1',
    errorTypeCode: 'turn_cap',
  }));
  assert.equal(store.adjustmentCount, 1);

  const beforeObjectives = await store.listObjectives('plan-1');
  const beforeRevision = await store.readPlanRevision('plan-1');

  const second = await service.ingest(stuckSignal({
    trigger: 'repeated_assessment_error',
    triggerKey: 'misconception:stu-1:kpi-1:deviation:3',
    errorTypeCode: 'deviation',
  }));

  assert.equal(second.created, true);
  assert.equal(second.adjustment?.action, 'recommend_teacher_support');
  assert.equal(second.adjustment?.status, 'proposed');
  assert.equal(second.summary.priority, 'high');
  assert.equal(second.adjustment?.remediationPayload, null);

  const afterObjectives = await store.listObjectives('plan-1');
  assert.equal(afterObjectives.length, beforeObjectives.length, 'circuit breaker must not write outline');
  assert.equal(await store.readPlanRevision('plan-1'), beforeRevision);

  assert.equal(audit.entries.length, 2);
  assertNoRawStudentText(audit.entries[1]?.detail);
});

test('F4: optimistic-lock autoRebase retries on a concurrent revision bump without a client 409', async () => {
  const store = new InMemoryPlanAdjustmentStore();
  store.seedPlan('plan-1', 1, baseObjectives());
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const adjustments = new PlanAdjustmentService(store, audit, outbox);
  const service = new StuckSignalService(store, adjustments);

  let bumped = false;
  const originalCommitAppend = store.commitAppend.bind(store);
  store.commitAppend = async (input) => {
    if (!bumped) {
      bumped = true;
      // 模拟并发写入者把计划版本从 1 抬到 2（服务端已读到的 base 仍是 1）。
      store.setPlanRevision(input.adjustment.planId, 2);
    }
    return originalCommitAppend(input);
  };

  const result = await service.ingest(stuckSignal());

  assert.equal(result.rebaseExhausted, false);
  assert.equal(result.created, true);
  assert.equal(result.adjustment?.action, 'append_optional_remediation');
  assert.equal(result.adjustment?.baseRevision, 2, 'rebase must re-read the bumped revision');
  assert.equal(result.adjustment?.nextRevision, 3);
  assert.equal(await store.readPlanRevision('plan-1'), 3);
  assert.equal(store.adjustmentCount, 1);
});

test('F4: rebase exhaustion writes an ADJUSTMENT_REBASE_EXHAUSTED warning audit and never throws a 409', async () => {
  const store = new InMemoryPlanAdjustmentStore();
  store.seedPlan('plan-1', 1, baseObjectives());
  const audit = new RecordingAudit();
  const outbox = new RecordingOutbox();
  const adjustments = new PlanAdjustmentService(store, audit, outbox);
  const service = new StuckSignalService(store, adjustments);

  const originalCommitAppend = store.commitAppend.bind(store);
  store.commitAppend = async (input) => {
    // 每次都抢先把版本抬走 → 永远 conflict。
    store.setPlanRevision(input.adjustment.planId, (await store.readPlanRevision(input.adjustment.planId) ?? 0) + 1);
    return originalCommitAppend(input);
  };

  const result = await service.ingest(stuckSignal());

  assert.equal(result.rebaseExhausted, true);
  assert.equal(result.adjustment, null);
  assert.equal(result.summary.priority, 'high');
  assert.equal(store.adjustmentCount, 0, 'no adjustment row on exhaustion');

  const warning = audit.entries.find((entry) => (
    entry.detail !== null &&
    entry.detail !== undefined &&
    (entry.detail as Record<string, unknown>).code === 'ADJUSTMENT_REBASE_EXHAUSTED'
  ));
  assert.ok(warning, 'expected ADJUSTMENT_REBASE_EXHAUSTED warning audit');
  assertNoRawStudentText(warning.detail);
  assert.equal(MAX_AUTO_REBASE_ATTEMPTS, 3);
});

test('F4: append-only guard rejects deleting or weakening a template-required objective', () => {
  const before: OutlineObjective[] = baseObjectives().map((objective) => ({
    ...objective,
    isRemedial: false,
  }));

  const deleted = before.slice(0, -1);
  assert.throws(
    () => assertAppendOnlyOutlineMutation(before, deleted),
    (error: unknown) => error instanceof PlanAdjustmentError && error.code === 'ADJUSTMENT_INVALID',
  );

  const weakened = before.map((objective) => (
    objective.id === 'node-1' ? { ...objective, type: 'procedure' as const } : objective
  ));
  assert.throws(
    () => assertAppendOnlyOutlineMutation(before, weakened),
    (error: unknown) => error instanceof PlanAdjustmentError && error.code === 'ADJUSTMENT_INVALID',
  );

  // 重排既有节点（ordinal/moduleId 改写）也是削弱：顺序本身是教学序列，不得静默重算。
  const reordered = before.map((objective) => (
    objective.id === 'node-2' ? { ...objective, ordinal: 99 } : objective
  ));
  assert.throws(
    () => assertAppendOnlyOutlineMutation(before, reordered),
    (error: unknown) => error instanceof PlanAdjustmentError && error.code === 'ADJUSTMENT_INVALID',
  );

  const remoduled = before.map((objective) => (
    objective.id === 'node-2' ? { ...objective, moduleId: 'mod-9' } : objective
  ));
  assert.throws(
    () => assertAppendOnlyOutlineMutation(before, remoduled),
    (error: unknown) => error instanceof PlanAdjustmentError && error.code === 'ADJUSTMENT_INVALID',
  );

  const nonRemedialAppend = [
    ...before,
    { id: 'node-3', planId: 'plan-1', moduleId: 'mod-1', name: 'x', type: 'memory' as const, objective: 'y', prerequisiteIds: ['node-1'], ordinal: 3, isRemedial: false },
  ];
  assert.throws(
    () => assertAppendOnlyOutlineMutation(before, nonRemedialAppend),
    (error: unknown) => error instanceof PlanAdjustmentError && error.code === 'ADJUSTMENT_INVALID',
  );

  // 合法形态：只追加一个 isRemedial 节点。
  const payload = buildRemediationNodePayload(stuckSignal(), before);
  const appended = [...before, { ...payload, id: payload.nodeId, planId: 'plan-1' }];
  assert.doesNotThrow(() => assertAppendOnlyOutlineMutation(before, appended));

  // stem node 不在 outline 中 → 拒绝。
  assert.throws(
    () => buildRemediationNodePayload(stuckSignal({ stemNodeId: 'missing-node' }), before),
    (error: unknown) => error instanceof PlanAdjustmentError && error.code === 'ADJUSTMENT_INVALID',
  );
});

test('F4: concurrent-ish double ingest of the same key yields exactly one adjustment', async () => {
  const { store, service } = buildHarness();
  const signal = stuckSignal();

  const [left, right] = await Promise.all([service.ingest(signal), service.ingest(signal)]);

  assert.equal(store.adjustmentCount, 1);
  assert.equal([left, right].filter((result) => result.created).length, 1);
  assert.equal([left, right].filter((result) => result.replayed || !result.created).length, 1);
  assert.equal(left.adjustment?.id, right.adjustment?.id);
});

test('F4: commitAppend 回调失败 → outline/revision/调整行全部回滚，错误上抛', async () => {
  const store = new InMemoryPlanAdjustmentStore();
  store.seedPlan('plan-1', 1, baseObjectives());
  const adjustment = appendAdjustment();
  const payload = adjustment.remediationPayload;
  assert.ok(payload, 'append adjustment must carry a remediation payload');
  const failure = new Error('audit/outbox 事务失败');

  await assert.rejects(
    store.commitAppend({
      adjustment,
      payload,
      commit: async () => {
        throw failure;
      },
    }),
    (error: unknown) => error === failure,
  );

  assert.equal((await store.listObjectives('plan-1')).length, 2, 'outline 不得新增补救节点');
  assert.equal(await store.readPlanRevision('plan-1'), 1, 'revision 不得递增');
  assert.equal(store.adjustmentCount, 0, '调整行不得落库');
  assert.equal(await store.findByIdempotencyKey('proj-1', adjustment.idempotencyKey), null);
});

test('F4: commitRecommend 回调失败 → 调整行不落，错误上抛', async () => {
  const store = new InMemoryPlanAdjustmentStore();
  store.seedPlan('plan-1', 1, baseObjectives());
  const adjustment = recommendAdjustment();
  const failure = new Error('audit/outbox 事务失败');

  await assert.rejects(
    store.commitRecommend({
      adjustment,
      commit: async () => {
        throw failure;
      },
    }),
    (error: unknown) => error === failure,
  );

  assert.equal(store.adjustmentCount, 0, '调整行不得落库');
  assert.equal(await store.findByIdempotencyKey('proj-1', adjustment.idempotencyKey), null);
});

test('F4: desensitized summary scan rejects raw student text beyond ids/codes', () => {
  const summary = buildDesensitizedStuckSummary(
    stuckSignal({ errorTypeCode: 'tir.direction' }),
    'normal',
  );

  assert.deepEqual(
    Object.keys(summary).sort(),
    ['conceptId', 'errorTypeCode', 'evidenceRefs', 'nodeRefs', 'occurredAt', 'planId', 'priority', 'projectId', 'stemNodeId', 'studentId'].sort(),
  );
  assertNoRawStudentText(summary);
  assertNoRawStudentText(JSON.parse(JSON.stringify(summary)) as unknown);
  assert.equal(scanDesensitized(summary).length, 0);

  // 负数：夹带学生原文（键名 + CJK 值）必须被扫描器抓住。
  assert.throws(() => assertNoRawStudentText({
    studentId: 'stu-1',
    rawAnswer: '我认为答案是 3，因为老师讲过',
  }));

  assert.ok(MAX_REMEDIAL_DEPTH === 1);
});
