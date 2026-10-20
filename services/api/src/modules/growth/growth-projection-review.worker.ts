import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { outbox, type Database } from '@qitu/database';
import { and, asc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DATABASE_TOKEN } from '../../database';
import { GrowthProjectionOwnerService } from './growth-projection-owner.service';

/** Internal durable consumer. No model or client can call the acceptance operation. */
@Injectable()
export class GrowthProjectionReviewWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(GrowthProjectionReviewWorker.name);

  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null, private readonly owner: GrowthProjectionOwnerService) {}

  onModuleInit() {
    if (this.db && process.env.QITU_GROWTH_PROJECTION_WORKER !== 'false') {
      this.timer = setInterval(() => { void this.tick().catch(() => this.logger.warn('GROWTH_PROJECTION_REVIEW_RETRY')); }, 2_000);
      this.timer.unref();
    }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick(): Promise<'idle' | 'published' | 'retry'> {
    if (!this.db || this.busy) return 'idle';
    this.busy = true;
    try {
      const db = this.db;
      const job = await db.transaction(async (tx) => {
        const now = new Date();
        await tx.update(outbox).set({ status: 'pending', leaseOwner: null, leaseUntil: null }).where(and(
          eq(outbox.topic, 'growth.projection.ready'), eq(outbox.status, 'processing'), sql`${outbox.leaseUntil} < ${now}`,
        ));
        const [row] = await tx.select().from(outbox).where(and(eq(outbox.topic, 'growth.projection.ready'), eq(outbox.status, 'pending')))
          .orderBy(asc(outbox.createdAt)).limit(1).for('update', { skipLocked: true });
        if (!row) return null;
        const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
          ? row.payload as Record<string, unknown> : {};
        const candidateId = payload.candidateId;
        if (typeof candidateId !== 'string' || candidateId.length === 0 || candidateId.length > 180) {
          await tx.update(outbox).set({ status: 'failed', lastError: 'PROJECTION_READY_INVALID' }).where(eq(outbox.id, row.id));
          return null;
        }
        const leaseOwner = randomUUID();
        await tx.update(outbox).set({ status: 'processing', attempts: row.attempts + 1, leaseOwner, leaseUntil: new Date(now.getTime() + 60_000) }).where(eq(outbox.id, row.id));
        return { id: row.id, candidateId, attempts: row.attempts + 1, leaseOwner };
      });
      if (!job) return 'idle';
      try {
        const result = await this.owner.processReady(job.candidateId);
        await db.update(outbox).set({ status: 'published', publishedAt: new Date(), lastError: result.errorCode,
          leaseOwner: null, leaseUntil: null }).where(and(eq(outbox.id, job.id), eq(outbox.leaseOwner, job.leaseOwner)));
        return 'published';
      } catch {
        await db.update(outbox).set({ status: job.attempts >= 5 ? 'failed' : 'pending', lastError: 'PROJECTION_REVIEW_FAILED',
          leaseOwner: null, leaseUntil: null }).where(and(eq(outbox.id, job.id), eq(outbox.leaseOwner, job.leaseOwner)));
        return 'retry';
      }
    } finally { this.busy = false; }
  }
}
