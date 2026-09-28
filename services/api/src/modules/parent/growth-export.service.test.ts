import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  CurrentUser,
  ParentGrowthEntry,
  ParentGrowthPageData,
} from '@qitu/contracts';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import {
  IdempotencyStore,
} from '../../common/idempotency/idempotency.service';
import type {
  IdempotencyResult,
  IdempotentHandler,
} from '../../common/idempotency/idempotency.types';
import { AuditWriter } from '../../common/audit/audit.service';
import type { AuditEntry } from '../../common/audit/audit-entry';
import type { GrowthService } from '../growth/growth.service';
import { ParentGrowthExportService } from './growth-export.service';
import { GrowthExportStore, type GrowthExportRecord } from './growth-export.types';

/* ------------------------- 测试替身 ------------------------- */

class InMemoryGrowthExportStore extends GrowthExportStore {
  readonly records = new Map<string, GrowthExportRecord>();
  readonly expired = new Set<string>();
  readonly downloaded = new Set<string>();

  async save(record: GrowthExportRecord): Promise<void> {
    this.records.set(record.id, { ...record });
  }
  async findById(id: string): Promise<GrowthExportRecord | null> {
    return this.records.get(id) ?? null;
  }
  async markExpired(id: string): Promise<void> {
    const record = this.records.get(id);
    if (record) record.status = 'expired';
    this.expired.add(id);
  }
  async markDownloaded(id: string, at: Date): Promise<void> {
    const record = this.records.get(id);
    if (record) record.downloadedAt = at;
    this.downloaded.add(id);
  }
}

class FakeIdempotencyStore extends IdempotencyStore {
  readonly executed = new Map<string, { requestHash: string; result: IdempotencyResult<unknown> }>();
  handlerRuns = 0;

  async execute<T>(
    scope: string,
    key: string,
    requestHash: string,
    handler: IdempotentHandler<T>,
  ): Promise<IdempotencyResult<T>> {
    const composite = `${scope}::${key}`;
    const existing = this.executed.get(composite);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyError('IDEMPOTENCY_CONFLICT', '同 key 不同载荷');
      }
      return { ...(existing.result as IdempotencyResult<T>), replayed: true };
    }
    this.handlerRuns += 1;
    const produced = await handler();
    const result: IdempotencyResult<T> = {
      status: produced.status ?? 200,
      body: produced.body,
      replayed: false,
    };
    this.executed.set(composite, { requestHash, result: result as IdempotencyResult<unknown> });
    return result;
  }
}

class FakeAuditWriter extends AuditWriter {
  readonly entries: AuditEntry[] = [];
  async write(entry: AuditEntry): Promise<string> {
    this.entries.push(entry);
    return `audit-${this.entries.length}`;
  }
}

const PARENT: CurrentUser = {
  id: 'parent-1',
  email: 'Parent@Example.com',
  displayName: '家长',
  role: 'parent',
};

const FORBIDDEN_KEYS = ['rawConversation', 'voiceTranscript', 'riskLevel', 'email', 'modelInference'];

function makeEntry(): ParentGrowthEntry {
  return {
    id: 'growth-1',
    type: 'objective_mastered',
    occurredAt: '2025-03-01T00:00:00.000Z',
    title: '完成理论学习',
    summaryParent: '孩子完成了一次理论学习。',
    projectTitle: '校园植物观察手册',
    stage: 'theory_learning',
    artifactRef: null,
    // 故意注入越界字段，验证服务端投影会丢弃。
    rawConversation: '原始对话不应出现',
    voiceTranscript: '原始语音不应出现',
    riskLevel: 'high',
    email: 'child@example.com',
    modelInference: { guess: 'A' },
  } as unknown as ParentGrowthEntry;
}

function makePage(): ParentGrowthPageData {
  return {
    summary: {
      childId: 'student-1',
      childDisplayName: '小宇',
      streakDays: 3,
      projectsCompleted: 1,
      objectivesMastered: 2,
      artifactsPublished: 1,
      lastActivityAt: '2025-03-01T00:00:00.000Z',
      email: 'child@example.com',
      riskLevel: 'high',
    } as unknown as ParentGrowthPageData['summary'],
    timeline: { items: [makeEntry()], nextCursor: null, hasNext: false },
  };
}

interface Harness {
  service: ParentGrowthExportService;
  store: InMemoryGrowthExportStore;
  audit: FakeAuditWriter;
  idempotency: FakeIdempotencyStore;
  setCanRead: (value: boolean) => void;
}

function createHarness(store: GrowthExportStore | null = new InMemoryGrowthExportStore()): Harness {
  let canRead = true;
  const growth = {
    canParentReadChild: async () => canRead,
    getParentPage: async () => makePage(),
  } as unknown as GrowthService;
  const audit = new FakeAuditWriter();
  const idempotency = new FakeIdempotencyStore();
  const service = new ParentGrowthExportService(growth, idempotency, audit, store);
  return {
    service,
    store: store as InMemoryGrowthExportStore,
    audit,
    idempotency,
    setCanRead: (value: boolean) => {
      canRead = value;
    },
  };
}

const VALID_BODY = {
  confirmChildId: 'student-1',
  confirmGuardianEmail: 'parent@example.com',
  reason: '了解孩子近期成长',
};

function collectKeys(value: unknown, found: Set<string>): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    found.add(key);
    collectKeys(nested, found);
  }
}

/* ------------------------- 请求导出 ------------------------- */

test('授权监护人请求导出：返回任务元数据，落库脱敏正文并写审计', async () => {
  const h = createHarness();
  const job = await h.service.requestExport(PARENT, 'student-1', VALID_BODY, 'key-1');

  assert.equal(job.childId, 'student-1');
  assert.equal(job.status, 'ready');
  assert.equal(typeof job.exportId, 'string');
  assert.equal(h.store.records.size, 1);

  const record = h.store.records.get(job.exportId)!;
  assert.notEqual(record.document, null);
  const keys = new Set<string>();
  collectKeys(record.document, keys);
  for (const forbidden of FORBIDDEN_KEYS) {
    assert.equal(keys.has(forbidden), false, `落库正文不应包含 ${forbidden}`);
  }
  assert.equal(JSON.stringify(record.document).includes('原始对话不应出现'), false);

  assert.equal(h.audit.entries.length, 1);
  assert.equal(h.audit.entries[0]!.action, 'parent.growth_export.requested');
  assert.equal(h.audit.entries[0]!.targetType, 'parent_growth_export');
  // 审计 detail 不含正文。
  assert.equal('document' in (h.audit.entries[0]!.detail ?? {}), false);
});

test('跨家长请求导出：403 拒绝且不落库、不执行幂等 handler', async () => {
  const h = createHarness();
  h.setCanRead(false);

  await assert.rejects(
    () => h.service.requestExport(PARENT, 'student-1', VALID_BODY, 'key-1'),
    (error: unknown) => error instanceof ForbiddenException,
  );
  assert.equal(h.store.records.size, 0);
  assert.equal(h.idempotency.handlerRuns, 0);
  assert.equal(h.audit.entries[0]!.action, 'parent.growth_export.denied');
});

test('确认信息不匹配：400，且不触发授权 / 落库', async () => {
  const h = createHarness();
  await assert.rejects(
    () =>
      h.service.requestExport(
        PARENT,
        'student-1',
        { ...VALID_BODY, confirmGuardianEmail: 'someone-else@example.com' },
        'key-1',
      ),
    (error: unknown) =>
      error instanceof BadRequestException &&
      (error.getResponse() as { code?: string }).code === 'PARENT_EXPORT_INVALID',
  );
  assert.equal(h.store.records.size, 0);
});

test('目的为空或超长：400 PARENT_EXPORT_INVALID', async () => {
  const h = createHarness();
  await assert.rejects(
    () => h.service.requestExport(PARENT, 'student-1', { ...VALID_BODY, reason: '   ' }, 'key-1'),
    (error: unknown) => error instanceof BadRequestException,
  );
  await assert.rejects(
    () =>
      h.service.requestExport(PARENT, 'student-1', { ...VALID_BODY, reason: 'x'.repeat(201) }, 'key-2'),
    (error: unknown) => error instanceof BadRequestException,
  );
  assert.equal(h.store.records.size, 0);
});

test('同 Idempotency-Key 重放：返回同一任务，不产生第二条记录、不重复审计', async () => {
  const h = createHarness();
  const first = await h.service.requestExport(PARENT, 'student-1', VALID_BODY, 'key-1');
  const second = await h.service.requestExport(PARENT, 'student-1', VALID_BODY, 'key-1');

  assert.equal(second.exportId, first.exportId);
  assert.equal(h.store.records.size, 1);
  assert.equal(h.idempotency.handlerRuns, 1);
  assert.equal(h.audit.entries.length, 1);
});

test('同一 key 不同载荷：抛 IDEMPOTENCY_CONFLICT', async () => {
  const h = createHarness();
  await h.service.requestExport(PARENT, 'student-1', VALID_BODY, 'key-1');
  await assert.rejects(
    () =>
      h.service.requestExport(PARENT, 'student-1', { ...VALID_BODY, reason: '换一个目的' }, 'key-1'),
    (error: unknown) =>
      error instanceof ConflictException &&
      (error.getResponse() as { code?: string }).code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('未配置持久化（store 为 null）：503 诚实失败，不落内存', async () => {
  const h = createHarness(null);
  await assert.rejects(
    () => h.service.requestExport(PARENT, 'student-1', VALID_BODY, 'key-1'),
    (error: unknown) => error instanceof ServiceUnavailableException,
  );
  assert.equal(h.idempotency.handlerRuns, 0);
});

/* ------------------------- 下载导出 ------------------------- */

test('监护人下载：返回脱敏正文并记录 downloaded / 审计', async () => {
  const h = createHarness();
  const job = await h.service.requestExport(PARENT, 'student-1', VALID_BODY, 'key-1');
  const document = await h.service.downloadExport(PARENT, job.exportId);

  assert.equal(document.exportId, job.exportId);
  assert.equal(document.entries.length, 1);
  assert.equal(h.store.downloaded.has(job.exportId), true);
  assert.equal(h.audit.entries.some((e) => e.action === 'parent.growth_export.downloaded'), true);
});

test('下载时授权已撤销：403，不返回任何正文', async () => {
  const h = createHarness();
  const job = await h.service.requestExport(PARENT, 'student-1', VALID_BODY, 'key-1');
  h.setCanRead(false);

  await assert.rejects(
    () => h.service.downloadExport(PARENT, job.exportId),
    (error: unknown) => error instanceof ForbiddenException,
  );
  assert.equal(h.store.downloaded.has(job.exportId), false);
  assert.equal(h.audit.entries.at(-1)!.action, 'parent.growth_export.denied');
});

test('下载他人导出：404，不泄露存在性', async () => {
  const h = createHarness();
  const job = await h.service.requestExport(PARENT, 'student-1', VALID_BODY, 'key-1');
  const other: CurrentUser = { ...PARENT, id: 'parent-2', email: 'other@example.com' };

  await assert.rejects(
    () => h.service.downloadExport(other, job.exportId),
    (error: unknown) => error instanceof NotFoundException,
  );
});

test('未知导出 id：404', async () => {
  const h = createHarness();
  await assert.rejects(
    () => h.service.downloadExport(PARENT, 'pge-unknown'),
    (error: unknown) => error instanceof NotFoundException,
  );
});

test('超出有效期：410 并把状态置为 expired', async () => {
  const h = createHarness();
  const job = await h.service.requestExport(PARENT, 'student-1', VALID_BODY, 'key-1');
  const record = h.store.records.get(job.exportId)!;
  record.expiresAt = new Date(Date.now() - 1000);

  await assert.rejects(
    () => h.service.downloadExport(PARENT, job.exportId),
    (error: unknown) => error instanceof GoneException,
  );
  assert.equal(h.store.expired.has(job.exportId), true);
});

test('正文尚未生成（pending）：409 NOT_READY', async () => {
  const h = createHarness();
  h.store.records.set('pge-pending', {
    id: 'pge-pending',
    parentId: PARENT.id,
    childId: 'student-1',
    childDisplayName: '小宇',
    status: 'pending',
    reason: '测试',
    document: null,
    createdAt: new Date(),
    readyAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    downloadedAt: null,
  });

  await assert.rejects(
    () => h.service.downloadExport(PARENT, 'pge-pending'),
    (error: unknown) =>
      error instanceof ConflictException &&
      (error.getResponse() as { code?: string }).code === 'PARENT_EXPORT_NOT_READY',
  );
});

test('下载时未配置持久化：503', async () => {
  const h = createHarness(null);
  await assert.rejects(
    () => h.service.downloadExport(PARENT, 'pge-1'),
    (error: unknown) => error instanceof ServiceUnavailableException,
  );
});
