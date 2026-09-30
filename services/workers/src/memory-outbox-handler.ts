import type { AgentMemoryRecord, MemoryIndexPort } from '@qitu/agent-memory';

export interface MemoryOutboxPayload {
  memoryId: string;
  operation?: 'delete';
}

export interface MemoryRecordSource {
  get(id: string): Promise<AgentMemoryRecord | null>;
  markIndexed(id: string, indexId?: string | null): Promise<void>;
  markIndexFailed(id: string, error: unknown): Promise<void>;
}

/** Idempotent handler for the memory-only outbox topic. */
export class MemoryOutboxHandler {
  constructor(private readonly source: MemoryRecordSource, private readonly index: MemoryIndexPort) {}

  async handle(payload: MemoryOutboxPayload): Promise<void> {
    const record = await this.source.get(payload.memoryId);
    if (record === null) return;
    try {
        let indexId: string | null = null;
        if (payload.operation === 'delete' || record.status === 'deleted') {
          await this.index.remove(record);
        } else if (record.status === 'active') {
          indexId = await this.index.reconcile(record);
        }
        await this.source.markIndexed(record.id, indexId);
    } catch (error) {
      await this.source.markIndexFailed(record.id, error);
      throw error;
    }
  }
}
