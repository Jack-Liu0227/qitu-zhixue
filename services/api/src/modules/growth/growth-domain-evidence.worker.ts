import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import {
  agentTeamEvents, artifacts, auditLogs, growthDomainEventId, masteryRecords, outbox, projectEvidence,
  readGrowthDomainObservation, type Database,
} from '@qitu/database';
import type { GrowthDomainKind } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { GrowthService } from './growth.service';

/** Reconciles existing owner facts; model output can never create a timeline fact. */
@Injectable()
export class GrowthDomainEvidenceWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GrowthDomainEvidenceWorker.name);
  private readonly cursors = new Map<GrowthDomainKind, string>();
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;

  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null, private readonly growth: GrowthService,
    private readonly audit: AuditWriter) {}

  onModuleInit() {
    if (this.db && process.env.QITU_GROWTH_DOMAIN_WORKER !== 'false') {
      this.timer = setInterval(() => { void this.tick().catch(() => this.logger.warn('GROWTH_DOMAIN_RECONCILE_RETRY')); }, 5_000);
      this.timer.unref();
    }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick(limit = 20): Promise<{ checked: number; emitted: number; deferred: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('GROWTH_DOMAIN_BATCH_INVALID');
    const counts = { checked: 0, emitted: 0, deferred: 0 };
    const deferredCodes = new Map<string, number>();
    if (!this.db || this.busy) return counts;
    this.busy = true;
    try {
      for (const kind of ['project_transition', 'published_artifact', 'reflection', 'mastered_objective'] as const) {
        const rows = await this.page(kind, limit);
        // Cursors advance even when an individual source is blocked, so it cannot starve later facts.
        for (const row of rows) {
          counts.checked++;
          try { if (await this.reconcile({ kind, sourceId: row.id })) counts.emitted++; }
          catch (error) {
            counts.deferred++;
            const code = error instanceof Error && /^PROJECTION_[A-Z_]+$/u.test(error.message)
              ? error.message : 'GROWTH_DOMAIN_RECONCILE_FAILED';
            deferredCodes.set(code, (deferredCodes.get(code) ?? 0) + 1);
          }
          this.cursors.set(kind, row.id);
        }
        if (rows.length < limit) this.cursors.delete(kind);
      }
      if (counts.deferred) this.logger.warn({ event: 'growth.domain.deferred', count: counts.deferred,
        codes: Object.fromEntries(deferredCodes) });
      return counts;
    } finally { this.busy = false; }
  }

  async reconcile(source: { kind: GrowthDomainKind; sourceId: string }): Promise<boolean> {
    if (!this.db) throw new Error('GROWTH_DOMAIN_DATABASE_REQUIRED');
    const db = this.db;
    const observation = await readGrowthDomainObservation(db, source);
    const eventId = growthDomainEventId(observation);
    const auditKey = `growth-domain:${eventId}`;
    const [events, queued, audited] = await Promise.all([
      db.select({ id: agentTeamEvents.id }).from(agentTeamEvents).where(eq(agentTeamEvents.id, eventId)).limit(1),
      db.select({ id: outbox.id }).from(outbox).where(eq(outbox.id, `agent-team-event:${eventId}`)).limit(1),
      db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.idempotencyKey, auditKey)).limit(1),
    ]);
    if (events.length && queued.length && audited.length) return false;
    // A crash after this durable owner write is repaired by the next scan's idempotent replay.
    await this.growth.record({
      studentId: observation.studentId, schoolId: observation.schoolId, projectId: observation.projectId,
      projectTitle: observation.projectTitle, type: observation.type, occurredAt: observation.occurredAt,
      title: observation.title, summaryStudent: observation.factualSummary, summaryParent: observation.factualSummary,
      stage: observation.stage, artifactRef: observation.artifactRef, objectiveTitles: observation.objectiveTitles,
      evidenceIds: observation.evidenceRefs, idempotencyKey: eventId, source: 'server', visibility: 'student_private',
    });
    return db.transaction(async (tx) => {
      // Re-read under the transaction before publishing a source that may have been revoked meanwhile.
      const current = await readGrowthDomainObservation(tx, source);
      if (current.sourceHash !== observation.sourceHash) throw new Error('PROJECTION_DOMAIN_SOURCE_CHANGED');
      const payload = { studentUserId: observation.studentId, projectId: observation.projectId,
        sourceAgentId: observation.sourceAgentId, domainKind: source.kind, domainSourceId: source.sourceId,
        domainSourceHash: observation.sourceHash, evidenceRefs: observation.evidenceRefs };
      const inserted = await tx.insert(agentTeamEvents).values({ id: eventId, runId: null, taskId: null,
        topic: observation.topic, sequence: 0, payload, idempotencyKey: eventId,
        occurredAt: new Date(observation.occurredAt) }).onConflictDoNothing({ target: agentTeamEvents.idempotencyKey }).returning({ id: agentTeamEvents.id });
      await tx.select({ id: agentTeamEvents.id }).from(agentTeamEvents).where(eq(agentTeamEvents.id, eventId)).for('update');
      const [existingAudit] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.idempotencyKey, auditKey)).limit(1);
      if (!existingAudit) await this.audit.write({ action: 'growth.domain.observed', targetType: 'agent_team_event', targetId: eventId,
        idempotencyKey: auditKey, detail: { sourceKind: source.kind, sourceId: source.sourceId, sourceHash: observation.sourceHash } }, tx);
      await tx.insert(outbox).values({ id: `agent-team-event:${eventId}`, topic: 'agent.team.event',
        payload: { eventId, runId: null, taskId: null, topic: observation.topic, payload }, status: 'pending' })
        .onConflictDoNothing({ target: outbox.id });
      return inserted.length > 0;
    });
  }

  private async page(kind: GrowthDomainKind, limit: number): Promise<{ id: string }[]> {
    const db = this.db;
    if (!db) return [];
    const cursor = this.cursors.get(kind);
    if (kind === 'project_transition') return db.select({ id: outbox.id }).from(outbox)
      .where(and(inArray(outbox.topic, ['project.advanced', 'project.completed']), cursor ? gt(outbox.id, cursor) : undefined))
      .orderBy(asc(outbox.id)).limit(limit);
    if (kind === 'published_artifact') return db.select({ id: artifacts.id }).from(artifacts)
      .where(and(eq(artifacts.status, 'published'), cursor ? gt(artifacts.id, cursor) : undefined))
      .orderBy(asc(artifacts.id)).limit(limit);
    if (kind === 'reflection') return db.select({ id: projectEvidence.id }).from(projectEvidence)
      .where(and(eq(projectEvidence.sourceKind, 'reflection'), cursor ? gt(projectEvidence.id, cursor) : undefined))
      .orderBy(asc(projectEvidence.id)).limit(limit);
    const mastered = await db.select({ sourceEventId: masteryRecords.sourceEventId }).from(masteryRecords)
      .where(and(eq(masteryRecords.status, 'mastered'), gt(masteryRecords.sourceEventId, cursor ?? '')))
      .orderBy(asc(masteryRecords.sourceEventId)).limit(limit);
    // Assessed attempts that are still learning or superseded are not failed growth facts.
    // The owner revalidates each current source, including revocation, before publishing.
    return mastered.flatMap(row => row.sourceEventId ? [{ id: row.sourceEventId }] : []);
  }
}
