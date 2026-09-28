import assert from 'node:assert/strict';
import type { CurrentUser } from '@qitu/contracts';
import type { AuditEntry } from '../../common/audit/audit-entry';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyError } from '../../common/idempotency/idempotency.errors';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { KeywordRetrievalPort } from './knowledge.retrieval.port';
import {
  KnowledgeScopeAuthorizer,
} from './knowledge.scope-authorizer';
import type { KnowledgeActorContext } from './knowledge.scope-policy';
import { KnowledgeService } from './knowledge.service';
import { InMemoryKnowledgeStore } from './knowledge.store';
import type { KnowledgeChunk, KnowledgeDocument } from './knowledge.types';

/* ==================== 测试替身 ==================== */

/** 与真实实现保持相同可观察语义的内存幂等存储。 */
export class FakeIdempotencyStore {
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

export class FakeAuditWriter {
  readonly entries: AuditEntry[] = [];
  async write(entry: AuditEntry): Promise<string> {
    this.entries.push(entry);
    return `audit-${this.entries.length}`;
  }
}

/** 按 actor.id 解析主体上下文与项目可访问性的 authorizer 替身。 */
export class FakeKnowledgeScopeAuthorizer extends KnowledgeScopeAuthorizer {
  constructor(
    private readonly contexts: Record<string, KnowledgeActorContext>,
    private readonly projectAccess: Record<string, readonly string[]> = {},
  ) {
    super();
  }

  async loadActorContext(actor: CurrentUser): Promise<KnowledgeActorContext> {
    return (
      this.contexts[actor.id] ?? { actorId: actor.id, role: actor.role, schoolId: null }
    );
  }

  async canAccessProject(actor: CurrentUser, projectId: string): Promise<boolean> {
    return (this.projectAccess[actor.id] ?? []).includes(projectId);
  }
}

export interface KnowledgeHarness {
  service: KnowledgeService;
  store: InMemoryKnowledgeStore;
  idempotency: FakeIdempotencyStore;
  audit: FakeAuditWriter;
  authorizer: FakeKnowledgeScopeAuthorizer;
}

export function makeKnowledgeHarness(options?: {
  contexts?: Record<string, KnowledgeActorContext>;
  projectAccess?: Record<string, readonly string[]>;
}): KnowledgeHarness {
  const store = new InMemoryKnowledgeStore();
  const idempotency = new FakeIdempotencyStore();
  const audit = new FakeAuditWriter();
  const authorizer = new FakeKnowledgeScopeAuthorizer(
    options?.contexts ?? {},
    options?.projectAccess ?? {},
  );
  const service = new KnowledgeService(
    store,
    new KeywordRetrievalPort(),
    authorizer,
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditWriter,
  );
  return { service, store, idempotency, audit, authorizer };
}

/* ==================== 工厂 ==================== */

export function makeActor(
  id: string,
  role: CurrentUser['role'],
  displayName = id,
): CurrentUser {
  return { id, email: `${id}@example.test`, displayName, role };
}

export function makeDocument(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  const now = new Date('2025-01-01T00:00:00.000Z');
  return {
    id: 'doc-1',
    schoolId: null,
    scope: 'system',
    ownerUserId: null,
    projectId: null,
    title: '标题',
    summary: '摘要',
    tags: [],
    content: '正文',
    source: 'seed',
    sourceRef: null,
    checksum: 'checksum-1',
    version: 'v1',
    status: 'verified',
    verifiedBy: 'admin-1',
    verifiedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeChunk(
  documentId: string,
  ordinal: number,
  content: string,
): KnowledgeChunk {
  return {
    id: `${documentId}#${ordinal}`,
    documentId,
    ordinal,
    content,
    tokenCount: null,
    embedding: null,
    embeddingModel: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
  };
}

export async function assertHttpError(
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
