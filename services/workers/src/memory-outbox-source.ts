import { and, asc, eq } from 'drizzle-orm';
import { agentMemoryRecords, outbox, type Database } from '@qitu/database';
import type { AgentMemoryRecord } from '@qitu/agent-memory';
import type { MemoryRecordSource, MemoryOutboxPayload } from './memory-outbox-handler';

/** Durable source for the agent-memory outbox consumer. */
export class PostgresMemoryRecordSource implements MemoryRecordSource {
  constructor(private readonly db: Database, private readonly maxAttempts = 5) {}

  async claim(): Promise<{ outboxId: string; payload: MemoryOutboxPayload; attempts: number } | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(outbox)
        .where(and(eq(outbox.topic, 'agent-memory.index'), eq(outbox.status, 'pending')))
        .orderBy(asc(outbox.createdAt)).limit(1).for('update', { skipLocked: true });
      if (!row) return null;
      const payload = row.payload as MemoryOutboxPayload;
      if (typeof payload.memoryId !== 'string' || payload.memoryId.length === 0) {
        await tx.update(outbox).set({ status: 'failed', attempts: row.attempts + 1, lastError: 'MEMORY_PAYLOAD_INVALID' }).where(eq(outbox.id, row.id));
        return null;
      }
      await tx.update(outbox).set({ status: 'processing', attempts: row.attempts + 1 }).where(eq(outbox.id, row.id));
      return { outboxId: row.id, payload, attempts: row.attempts + 1 };
    });
  }

  shouldFail(attempts: number): boolean {
    return attempts >= this.maxAttempts;
  }

  async complete(outboxId: string): Promise<void> {
    await this.db.update(outbox).set({ status: 'published', publishedAt: new Date(), lastError: null }).where(eq(outbox.id, outboxId));
  }

  async retry(outboxId: string, error: unknown, terminal = false): Promise<void> {
    const message = error instanceof Error ? error.message.slice(0, 240) : 'MEMORY_INDEX_FAILED';
    await this.db.update(outbox).set({ status: terminal ? 'failed' : 'pending', lastError: message }).where(eq(outbox.id, outboxId));
  }

  async get(id: string) {
    const [row] = await this.db.select().from(agentMemoryRecords).where(eq(agentMemoryRecords.id, id)).limit(1);
    return row ? toMemoryRecord(row) : null;
  }

  async markIndexed(id: string, indexId?: string | null): Promise<void> {
    await this.db.update(agentMemoryRecords).set({ indexStatus: 'indexed', indexBackend: indexId ? 'mem0' : null, indexId: indexId ?? null, updatedAt: new Date() }).where(eq(agentMemoryRecords.id, id));
  }

  async markIndexFailed(id: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message.slice(0, 240) : 'MEMORY_INDEX_FAILED';
    await this.db.update(agentMemoryRecords).set({ indexStatus: 'failed', updatedAt: new Date(), metadata: { indexError: message } }).where(eq(agentMemoryRecords.id, id));
  }
}

export function memoryIndexConfig(options: NodeJS.ProcessEnv): { baseUrl: string; apiKey?: string } | null {
  const baseUrl = options.QITU_MEM0_URL?.trim();
  if (!baseUrl) return null;
  const apiKey = options.QITU_MEM0_TOKEN?.trim();
  return apiKey ? { baseUrl, apiKey } : { baseUrl };
}

function toMemoryRecord(row: typeof agentMemoryRecords.$inferSelect): AgentMemoryRecord {
  return {
    id: row.id, studentId: row.studentId, partnerId: row.partnerId,
    scope: row.scope as AgentMemoryRecord['scope'], kind: row.kind as AgentMemoryRecord['kind'],
    content: row.content, sourceRef: row.sourceRef, sourceEventId: row.sourceEventId,
    status: row.status as AgentMemoryRecord['status'], version: row.version,
    expiresAt: row.expiresAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(), indexId: row.indexId,
  };
}
