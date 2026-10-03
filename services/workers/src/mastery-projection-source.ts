import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import { masteryEvents, masteryGraphReceipts, outbox, type Database } from '@qitu/database';
import { randomUUID } from 'node:crypto';
import type { MasteryAssessmentEvent } from '@qitu/contracts';
import { masteryGraphPayload, type MasteryGraphPort, type MasteryGraphReceipt } from './mastery-graph-provider';
import type { MasteryProjectionJob, MasteryProjectionSource } from './mastery-projection-worker';

type EventRow = typeof masteryEvents.$inferSelect;

export class PostgresMasteryProjectionSource implements MasteryProjectionSource {
  constructor(private readonly db: Database, private readonly maxAttempts = 8, private readonly leaseMs = 60000) {}

  async claim(): Promise<MasteryProjectionJob | null> {
    return this.db.transaction(async (tx) => {
      // Expired workers cannot hold jobs indefinitely. Recovery is serialized with claim.
      await tx.execute(sql`UPDATE outbox o SET status = 'pending'
        FROM mastery_graph_receipts r WHERE o.topic = 'mastery.assessed' AND o.status = 'processing'
        AND o.payload->>'eventId' = r.event_id AND r.lease_until <= now()`);
      const [row] = await tx.select().from(outbox).where(and(eq(outbox.topic, 'mastery.assessed'), eq(outbox.status, 'pending')))
        .orderBy(asc(outbox.createdAt)).limit(1).for('update', { skipLocked: true });
      if (!row) return null;
      const eventId = (row.payload as { eventId?: unknown }).eventId;
      if (typeof eventId !== 'string') {
        await tx.update(outbox).set({ status: 'failed', lastError: 'MASTERY_EVENT_MISSING' }).where(eq(outbox.id, row.id));
        return null;
      }
      const [event] = await tx.select().from(masteryEvents).where(eq(masteryEvents.id, eventId));
      if (!event) {
        await tx.update(outbox).set({ status: 'failed', lastError: 'MASTERY_EVENT_MISSING' }).where(eq(outbox.id, row.id));
        return null;
      }
      const payload = masteryGraphPayload(toEvent(event));
      const leaseOwner = randomUUID();
      const now = new Date();
      const leaseUntil = new Date(now.getTime() + this.leaseMs);
      const attempts = row.attempts + 1;
      await tx.insert(masteryGraphReceipts).values({ eventId, schoolId: event.schoolId, status: 'processing', payloadHash: payload.payloadHash, attempts, leaseOwner, leaseUntil, updatedAt: now })
        .onConflictDoUpdate({ target: masteryGraphReceipts.eventId, set: { status: 'processing', payloadHash: payload.payloadHash, attempts, leaseOwner, leaseUntil, updatedAt: now } });
      await tx.update(outbox).set({ status: 'processing', attempts }).where(eq(outbox.id, row.id));
      return { outboxId: row.id, leaseOwner, payload };
    });
  }

  async finish(job: MasteryProjectionJob, receipt: MasteryGraphReceipt): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.update(masteryGraphReceipts).set({ status: 'published', projectionId: receipt.projectionId, lastError: null, leaseOwner: null, leaseUntil: null, updatedAt: new Date() })
        .where(and(eq(masteryGraphReceipts.eventId, job.payload.event.id), eq(masteryGraphReceipts.leaseOwner, job.leaseOwner), eq(masteryGraphReceipts.payloadHash, receipt.payloadHash))).returning({ eventId: masteryGraphReceipts.eventId });
      if (!rows.length) return false;
      await tx.update(outbox).set({ status: 'published', publishedAt: new Date(), lastError: null }).where(eq(outbox.id, job.outboxId));
      return true;
    });
  }

  async fail(job: MasteryProjectionJob, errorCode: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [receipt] = await tx.select().from(masteryGraphReceipts).where(and(eq(masteryGraphReceipts.eventId, job.payload.event.id), eq(masteryGraphReceipts.leaseOwner, job.leaseOwner))).for('update');
      if (!receipt) return;
      const terminal = receipt.attempts >= this.maxAttempts;
      // Retain a lease during backoff, then recover the pending job in claim().
      const leaseUntil = terminal ? null : new Date(Date.now() + Math.min(300000, 1000 * 2 ** receipt.attempts));
      await tx.update(masteryGraphReceipts).set({ status: terminal ? 'failed' : 'retry', leaseUntil, lastError: errorCode, updatedAt: new Date() }).where(eq(masteryGraphReceipts.eventId, receipt.eventId));
      await tx.update(outbox).set({ status: terminal ? 'failed' : 'processing', lastError: errorCode }).where(eq(outbox.id, job.outboxId));
    });
  }

  async rebuild(afterEventId: string | null, limit: number) {
    const rows = await this.page(afterEventId, limit);
    for (const event of rows) {
      await this.db.transaction(async (tx) => {
        const payload = masteryGraphPayload(toEvent(event));
        await tx.insert(masteryGraphReceipts).values({ eventId: event.id, schoolId: event.schoolId, payloadHash: payload.payloadHash })
          .onConflictDoUpdate({ target: masteryGraphReceipts.eventId, set: { status: 'pending', attempts: 0, leaseUntil: null, leaseOwner: null, updatedAt: new Date() } });
        await tx.insert(outbox).values({ id: `mastery-assessed:${event.id}`, topic: 'mastery.assessed', payload: { eventId: event.id }, status: 'pending' })
          .onConflictDoUpdate({ target: outbox.id, set: { status: 'pending', attempts: 0, lastError: null, publishedAt: null } });
      });
    }
    return { count: rows.length, nextCursor: rows.length === limit ? rows.at(-1)!.id : null };
  }

  async reconcile(afterEventId: string | null, limit: number, inspect: MasteryGraphPort['inspect']) {
    const rows = await this.page(afterEventId, limit);
    let repaired = 0;
    for (const row of rows) {
      const payload = masteryGraphPayload(toEvent(row));
      const graph = await inspect(payload.projectionKey);
      if (!graph || graph.payloadHash !== payload.payloadHash) {
        await this.db.insert(outbox).values({ id: `mastery-assessed:${row.id}`, topic: 'mastery.assessed', payload: { eventId: row.id }, status: 'pending' })
          .onConflictDoUpdate({ target: outbox.id, set: { status: 'pending', attempts: 0, lastError: null } });
        repaired += 1;
      }
    }
    return { checked: rows.length, repaired, nextCursor: rows.length === limit ? rows.at(-1)!.id : null };
  }

  private async page(afterEventId: string | null, limit: number): Promise<EventRow[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('MASTERY_INPUT_INVALID');
    return this.db.select().from(masteryEvents).where(afterEventId ? gt(masteryEvents.id, afterEventId) : undefined).orderBy(asc(masteryEvents.id)).limit(limit);
  }
}

export function toEvent(row: EventRow): MasteryAssessmentEvent {
  return {
    id: row.id, schoolId: row.schoolId, studentId: row.studentUserId, knowledgePointId: row.knowledgePointId, courseVersion: row.courseVersion,
    objectiveId: row.objectiveId, planId: row.planId, projectId: row.projectId,
    eventType: row.eventType as MasteryAssessmentEvent['eventType'], knowledgeType: row.knowledgeType as MasteryAssessmentEvent['knowledgeType'],
    score: row.scoreBasisPoints === null ? null : row.scoreBasisPoints / 10000,
    confidence: row.confidenceBasisPoints === null ? null : row.confidenceBasisPoints / 10000,
    qualitativeMastered: row.qualitativeMastered, validFrom: row.validFrom.toISOString(), recordedAt: row.recordedAt.toISOString(),
    sequence: row.sequence, evidenceRefs: row.evidenceRefs,
    sourceType: row.sourceType as MasteryAssessmentEvent['sourceType'], sourceEventId: row.sourceEventId,
    causationId: row.causationId, correlationId: row.correlationId, supersedesEventId: row.supersedesEventId,
    assessmentVersion: row.assessmentVersion, idempotencyKey: row.idempotencyKey,
  };
}
