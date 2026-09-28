import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { DirectoryPersonRef } from '@qitu/contracts';
import type { DirectoryService } from '../directory/directory.service';
import {
  GROWTH_RECORD_STORE,
  GrowthRecordStore,
  InMemoryGrowthRecordStore,
  type GrowthAppendResult,
} from './growth.persistence';
import {
  buildGrowthStoredRecord,
  cloneGrowthStoredRecord,
  deriveGrowthIdempotencyKey,
  deriveGrowthRecordId,
  isStudentFacingGrowthType,
  normaliseGrowthSource,
  normaliseGrowthVisibility,
  type GrowthRecordInput,
  type GrowthStoredRecord,
} from './growth.record';
import {
  toGrowthRecordInsert,
  toGrowthStoredRecord,
} from './growth.persistence.postgres';
import { GrowthService } from './growth.service';

/**
 * 迁移 0008 `growth_records` 的持久化边界回归。
 *
 * 覆盖：
 *  - 只追加 + 幂等键：同键重试返回 `replayed=true` 且不产生第二条；
 *  - 对象级作用域：`listByStudent` 只返回该学生；
 *  - 证据白名单在写入与读回两处都生效；
 *  - Postgres 行 ↔ 领域记录的纯映射（无需真实数据库）；
 *  - `GrowthService` 写记录经存储端口、启动水合读回。
 */

/* ----------------------------- 测试替身 ----------------------------- */

class PersistentMemoryStore extends GrowthRecordStore {
  readonly persistent = true;
  readonly records = new Map<string, GrowthStoredRecord>();
  appendCalls = 0;

  override seed(records: readonly GrowthStoredRecord[]): void {
    for (const record of records) {
      if (!this.records.has(record.idempotencyKey)) {
        this.records.set(record.idempotencyKey, cloneGrowthStoredRecord(record));
      }
    }
  }

  async append(record: GrowthStoredRecord): Promise<GrowthAppendResult> {
    this.appendCalls += 1;
    const existing = this.records.get(record.idempotencyKey);
    if (existing !== undefined) {
      return { record: cloneGrowthStoredRecord(existing), replayed: true };
    }
    const stored = cloneGrowthStoredRecord(record);
    this.records.set(stored.idempotencyKey, stored);
    return { record: cloneGrowthStoredRecord(stored), replayed: false };
  }

  async findByIdempotencyKey(key: string): Promise<GrowthStoredRecord | null> {
    const record = this.records.get(key);
    return record === undefined ? null : cloneGrowthStoredRecord(record);
  }

  async listByStudent(studentId: string): Promise<GrowthStoredRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.studentId === studentId)
      .map(cloneGrowthStoredRecord);
  }

  async listAll(): Promise<GrowthStoredRecord[]> {
    return [...this.records.values()].map(cloneGrowthStoredRecord);
  }
}

function makeDirectory(): DirectoryService {
  const users: Record<string, DirectoryPersonRef> = {
    'student-a': { userId: 'student-a', email: 'a@qtzx.local', displayName: '学生 A', role: 'student' },
    'student-b': { userId: 'student-b', email: 'b@qtzx.local', displayName: '学生 B', role: 'student' },
    'parent-a': { userId: 'parent-a', email: 'pa@qtzx.local', displayName: '家长 A', role: 'parent' },
  };
  const guardians: Record<string, string[]> = { 'parent-a': ['student-a'] };
  return {
    findUser: async (id: string) => users[id] ?? null,
    childrenOfParent: async (pid: string) => (guardians[pid] ?? []).map((id) => users[id]!),
  } as unknown as DirectoryService;
}

const input: GrowthRecordInput = {
  studentId: 'student-a',
  type: 'objective_mastered',
  occurredAt: '2026-05-01T10:00:00.000Z',
  title: '掌握「测试目标」',
  summaryStudent: '你在测试里说明了这个目标。',
  summaryParent: '孩子掌握了一个测试目标。',
  objectiveTitles: ['测试目标'],
  idempotencyKey: 'growth:test:objective-1',
};

/* ------------------------------- 用例 ------------------------------- */

test('只追加 + 幂等：同键重试返回 replayed=true，不产生第二条', async () => {
  const store = new InMemoryGrowthRecordStore();
  const first = await store.append(buildGrowthStoredRecord(input, '2026-05-01T10:00:00.000Z'));
  const second = await store.append(buildGrowthStoredRecord(input, '2026-05-01T10:00:05.000Z'));

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.record.id, first.record.id);
  assert.equal((await store.listAll()).length, 1);
});

test('对象级作用域：listByStudent 只返回该学生的记录', async () => {
  const store = new InMemoryGrowthRecordStore();
  await store.append(buildGrowthStoredRecord(input, '2026-05-01T10:00:00.000Z'));
  await store.append(
    buildGrowthStoredRecord(
      { ...input, studentId: 'student-b', idempotencyKey: 'growth:test:objective-2' },
      '2026-05-01T10:00:00.000Z',
    ),
  );

  const a = await store.listByStudent('student-a');
  const b = await store.listByStudent('student-b');
  assert.deepEqual(a.map((r) => r.studentId), ['student-a']);
  assert.deepEqual(b.map((r) => r.studentId), ['student-b']);
  assert.equal(a[0]!.id, deriveGrowthRecordId('growth:test:objective-1'));
});

test('证据白名单在写入时过滤：原始对话 / 风险标签被丢弃', () => {
  const record = buildGrowthStoredRecord(
    {
      ...input,
      evidenceIds: [
        'student_answer:answer-001',
        'raw_conversation:turn-001',
        'risk_signal:stall',
        'student_answer:answer-001',
      ],
    },
    '2026-05-01T10:00:00.000Z',
  );

  assert.deepEqual(record.evidenceIds, ['student_answer:answer-001']);
});

test('来源 / 可见性归一化：未知值回落到 server / student_private', () => {
  assert.equal(normaliseGrowthSource('tutor'), 'tutor');
  assert.equal(normaliseGrowthSource('client'), 'server');
  assert.equal(normaliseGrowthVisibility('guardian_visible'), 'guardian_visible');
  assert.equal(normaliseGrowthVisibility('public'), 'student_private');

  const record = buildGrowthStoredRecord(
    { ...input, source: 'client' as never, visibility: 'public' as never },
    '2026-05-01T10:00:00.000Z',
  );
  assert.equal(record.source, 'server');
  assert.equal(record.visibility, 'student_private');
});

test('幂等键派生按类型取自然键，缺省时稳定', () => {
  const artifact = deriveGrowthIdempotencyKey({
    ...input,
    type: 'artifact_published',
    artifactRef: 'artifact-9',
    idempotencyKey: undefined,
  });
  assert.equal(artifact, 'growth:artifact_published:student-a:artifact-9');

  const stage = deriveGrowthIdempotencyKey({
    ...input,
    type: 'project_stage_completed',
    projectId: 'project-1',
    stage: 'practice_ready',
    idempotencyKey: undefined,
  });
  assert.equal(stage, 'growth:project_stage_completed:student-a:project-1:practice_ready');

  const objective = deriveGrowthIdempotencyKey({
    ...input,
    type: 'objective_mastered',
    objectiveTitles: ['b', 'a'],
    idempotencyKey: undefined,
  });
  assert.equal(objective, 'growth:objective_mastered:student-a:a|b');
});

test('Postgres 映射：行 ↔ 领域记录往返保留字段，读回再次白名单过滤证据', () => {
  const record = buildGrowthStoredRecord(
    { ...input, evidenceIds: ['artifact:artifact-001'], projectId: 'project-1', stage: 'published' },
    '2026-05-01T10:00:00.000Z',
  );

  const insert = toGrowthRecordInsert(record);
  assert.deepEqual(insert.evidenceRefs, ['artifact:artifact-001']);
  assert.deepEqual(insert.occurredAt, new Date('2026-05-01T10:00:00.000Z'));

  // 模拟库中已有的历史脏证据：读回时必须被再次过滤。
  const row = {
    ...insert,
    objectiveTitles: insert.objectiveTitles ?? [],
    evidenceRefs: ['artifact:artifact-001', 'raw_conversation:turn-001'],
    schoolId: null,
    projectId: 'project-1',
    stage: 'published',
    source: 'server',
    visibility: 'student_private',
    createdAt: new Date('2026-05-01T10:00:00.000Z'),
  } as unknown as Parameters<typeof toGrowthStoredRecord>[0];

  const mapped = toGrowthStoredRecord(row, '校园植物观察手册');
  assert.equal(mapped.studentId, 'student-a');
  assert.equal(mapped.projectTitle, '校园植物观察手册');
  assert.deepEqual(mapped.evidenceIds, ['artifact:artifact-001']);
  assert.equal(mapped.encouragement, null); // 规范表未落该列，读回为 null
});

test('学生可见类型闭合集合：其它 type 不进入投影', () => {
  assert.equal(isStudentFacingGrowthType('objective_mastered'), true);
  assert.equal(isStudentFacingGrowthType('plan_confirmed'), false);
});

test('GrowthService：写记录经存储端口落库，同键重试不追加', async () => {
  const store = new PersistentMemoryStore();
  const service = new GrowthService(makeDirectory(), store, 'test');

  await service.record(input);
  await service.record(input); // 同幂等键重试

  assert.equal(store.appendCalls, 2);
  assert.equal((await store.listByStudent('student-a')).length, 1);
  const timeline = service.getTimeline('student-a', {
    type: 'all',
    projectId: null,
    from: null,
    to: null,
    cursor: null,
    limit: 20,
  });
  assert.equal(timeline.items.length, 1);
});

test('GrowthService：live 水合读回既有记录，不灌入演示数据', async () => {
  const store = new PersistentMemoryStore();
  store.seed([buildGrowthStoredRecord({ ...input, studentId: 'student-b', idempotencyKey: undefined }, '2026-05-01T10:00:00.000Z')]);

  const service = new GrowthService(makeDirectory(), store, 'live');
  // 水合前快照为空（构造时不会 seed 演示数据）。
  assert.equal(service.getSummary('student-b').objectivesMastered, 0);

  await service.onModuleInit();
  assert.equal(service.getSummary('student-b').objectivesMastered, 1);
  // 演示学生不在库中，因此没有 fixture。
  assert.equal(service.getTimeline('student-demo', {
    type: 'all',
    projectId: null,
    from: null,
    to: null,
    cursor: null,
    limit: 20,
  }).items.length, 0);
});

test('GrowthModule 存储端口令牌是 Symbol（防止字符串漂移）', () => {
  assert.equal(typeof GROWTH_RECORD_STORE, 'symbol');
});
