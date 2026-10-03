import type { MasteryGraphPayload, MasteryGraphPort, MasteryGraphReceipt } from './mastery-graph-provider';

export interface MasteryProjectionJob { outboxId: string; leaseOwner: string; payload: MasteryGraphPayload }
export interface MasteryProjectionSource {
  claim(): Promise<MasteryProjectionJob | null>;
  finish(job: MasteryProjectionJob, receipt: MasteryGraphReceipt): Promise<boolean>;
  fail(job: MasteryProjectionJob, errorCode: string): Promise<void>;
  rebuild(afterEventId: string | null, limit: number): Promise<{ count: number; nextCursor: string | null }>;
  reconcile(afterEventId: string | null, limit: number, inspect: MasteryGraphPort['inspect']): Promise<{ checked: number; repaired: number; nextCursor: string | null }>;
}

export class MasteryProjectionWorker {
  constructor(private readonly source: MasteryProjectionSource, private readonly graph: MasteryGraphPort) {}
  async runOnce(): Promise<'idle' | 'published' | 'retry' | 'lease_lost'> {
    const job = await this.source.claim();
    if (!job) return 'idle';
    try {
      const receipt = await this.graph.reconcile(job.payload);
      if (receipt.payloadHash !== job.payload.payloadHash || receipt.projectionKey !== job.payload.projectionKey) throw new Error('GRAPHITI_RECEIPT_MISMATCH');
      return await this.source.finish(job, receipt) ? 'published' : 'lease_lost';
    } catch (error) {
      // Never persist external exception bodies, which may contain credentials or student content.
      const code = error instanceof Error && /^(?:GRAPHITI_[A-Z_0-9]+)$/u.test(error.message) ? error.message : 'GRAPHITI_UNAVAILABLE';
      await this.source.fail(job, code);
      return 'retry';
    }
  }
  rebuild(afterEventId: string | null = null, limit = 100) { return this.source.rebuild(afterEventId, limit); }
  reconcile(afterEventId: string | null = null, limit = 100) { return this.source.reconcile(afterEventId, limit, (key) => this.graph.inspect(key)); }
}
