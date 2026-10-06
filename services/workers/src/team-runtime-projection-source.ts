import { and, asc, eq, or, sql } from 'drizzle-orm';
import {
  agentConfigs,
  agentMailboxes,
  agentProjectionCandidates,
  agentRoutes,
  agentTeamRuns,
  agentTeamTasks,
  agentTeamMessages,
  outbox,
  type Database,
} from '@qitu/database';
import { randomUUID } from 'node:crypto';

export interface TeamEventPayload {
  eventId: string;
  runId?: string | null;
  taskId?: string | null;
  topic: string;
  payload: Record<string, unknown>;
}

export interface TeamProjectionJob {
  outboxId: string;
  event: TeamEventPayload;
  attempts: number;
  leaseOwner: string;
}

const PROJECTION_TARGETS: Readonly<Record<string, { agentId: string; taskType: string; projectionType: string }>> = {
  'tutor.turn.completed': { agentId: 'learner-profile', taskType: 'profile.project', projectionType: 'learner_profile' },
  'project.stage.completed': { agentId: 'growth-analyst', taskType: 'growth.project', projectionType: 'growth_trajectory' },
  'artifact.published': { agentId: 'growth-analyst', taskType: 'growth.project', projectionType: 'growth_trajectory' },
  'reflection.created': { agentId: 'growth-analyst', taskType: 'growth.project', projectionType: 'growth_trajectory' },
  'mastery.assessed': { agentId: 'growth-analyst', taskType: 'growth.project', projectionType: 'growth_trajectory' },
};

/**
 * Consumes agent.team.event outbox rows and creates candidate projections.
 * It never writes growth_records or tutor_learner_profiles; those domain
 * services decide whether a candidate is accepted and perform the official
 * audited write.
 */
export class PostgresTeamProjectionSource {
  constructor(private readonly db: Database, private readonly maxAttempts = 5, private readonly leaseMs = 60_000) {}

  async claim(): Promise<TeamProjectionJob | null> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      await tx.update(outbox).set({ status: 'pending', leaseOwner: null, leaseUntil: null }).where(and(
        eq(outbox.topic, 'agent.team.event'),
        eq(outbox.status, 'processing'),
        sql`${outbox.leaseUntil} IS NOT NULL AND ${outbox.leaseUntil} < ${now}`,
      ));
      const [row] = await tx.select().from(outbox).where(and(
        eq(outbox.topic, 'agent.team.event'),
        eq(outbox.status, 'pending'),
      )).orderBy(asc(outbox.createdAt)).limit(1).for('update', { skipLocked: true });
      if (!row) return null;
      const payload = parsePayload(row.payload);
      if (!payload) {
        await tx.update(outbox).set({ status: 'failed', attempts: row.attempts + 1, lastError: 'TEAM_EVENT_PAYLOAD_INVALID' }).where(eq(outbox.id, row.id));
        return null;
      }
      const leaseOwner = randomUUID();
      await tx.update(outbox).set({ status: 'processing', attempts: row.attempts + 1, leaseOwner, leaseUntil: new Date(now.getTime() + this.leaseMs) }).where(eq(outbox.id, row.id));
      return { outboxId: row.id, event: payload, attempts: row.attempts + 1, leaseOwner };
    });
  }

  async project(job: TeamProjectionJob): Promise<number> {
    const target = PROJECTION_TARGETS[job.event.topic];
    if (!target) return 0;
    const payload = job.event.payload;
    const studentUserId = asString(payload.studentUserId);
    const projectId = asString(payload.projectId);
    const sourceAgentId = await this.resolveSourceAgent(job.event.runId);
    if (!sourceAgentId) return 0;
    const [agent, route] = await Promise.all([
      this.db.select({ id: agentConfigs.id, enabled: agentConfigs.enabled }).from(agentConfigs).where(eq(agentConfigs.id, target.agentId)).limit(1),
      this.db.select({ id: agentRoutes.id }).from(agentRoutes).where(and(
        eq(agentRoutes.fromAgentId, sourceAgentId),
        eq(agentRoutes.toAgentId, target.agentId),
        eq(agentRoutes.trigger, 'event'),
        eq(agentRoutes.taskType, target.taskType),
        eq(agentRoutes.enabled, true),
      )).limit(1),
    ]);
    if (!agent[0]?.enabled || !route[0]) return 0;
    const runId = job.event.runId ?? await this.ensureRun(job.event, sourceAgentId, studentUserId, projectId);
    const taskKey = `team-projection-task:${job.event.eventId}:${target.projectionType}`;
    const taskId = randomUUID();
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.insert(agentTeamTasks).values({
        id: taskId,
        runId,
        agentId: target.agentId,
        taskType: target.taskType,
        status: 'queued',
        input: { eventId: job.event.eventId, topic: job.event.topic, payload, projectionType: target.projectionType },
        idempotencyKey: taskKey,
        maxAttempts: 3,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing({ target: agentTeamTasks.idempotencyKey });
      const [task] = await tx.select({ id: agentTeamTasks.id }).from(agentTeamTasks).where(eq(agentTeamTasks.idempotencyKey, taskKey)).limit(1);
      if (!task) return;
      const insertedMessages = await tx.insert(agentTeamMessages).values({
        id: randomUUID(),
        runId,
        taskId: task.id,
        mailboxAgentId: target.agentId,
        senderAgentId: sourceAgentId,
        recipientAgentId: target.agentId,
        messageType: 'projection.request',
        payload: { eventId: job.event.eventId, topic: job.event.topic, payload, projectionType: target.projectionType },
        status: 'queued',
        correlationId: task.id,
        idempotencyKey: `${taskKey}:message`,
        createdAt: now,
      }).onConflictDoNothing({ target: agentTeamMessages.idempotencyKey }).returning({ id: agentTeamMessages.id });
      if (insertedMessages.length > 0) await tx.insert(agentMailboxes).values({ agentId: target.agentId, pendingCount: 1, updatedAt: now }).onConflictDoUpdate({
        target: agentMailboxes.agentId,
        set: { pendingCount: sql`${agentMailboxes.pendingCount} + 1`, updatedAt: now },
      });
      await tx.insert(agentProjectionCandidates).values({
        id: randomUUID(),
        runId,
        taskId: task.id,
        agentId: target.agentId,
        projectionType: target.projectionType,
        studentUserId,
        projectId,
        payload: { sourceEventId: job.event.eventId, sourceTopic: job.event.topic, evidence: payload },
        status: 'proposed',
        idempotencyKey: `team-projection-candidate:${job.event.eventId}:${target.projectionType}`,
        createdAt: now,
      }).onConflictDoNothing({ target: agentProjectionCandidates.idempotencyKey });
    });
    return 1;
  }

  async complete(job: TeamProjectionJob): Promise<void> {
    await this.db.update(outbox).set({ status: 'published', publishedAt: new Date(), lastError: null, leaseOwner: null, leaseUntil: null }).where(and(eq(outbox.id, job.outboxId), eq(outbox.leaseOwner, job.leaseOwner)));
  }

  async retry(job: TeamProjectionJob, error: unknown): Promise<void> {
    const terminal = job.attempts >= this.maxAttempts;
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/u.test(error.message) ? error.message : 'TEAM_PROJECTION_FAILED';
    await this.db.update(outbox).set({ status: terminal ? 'failed' : 'pending', lastError: code, leaseOwner: null, leaseUntil: null }).where(and(eq(outbox.id, job.outboxId), eq(outbox.leaseOwner, job.leaseOwner)));
  }

  private async resolveSourceAgent(runId: string | null | undefined): Promise<string | null> {
    if (runId) {
      const [run] = await this.db.select({ leaderAgentId: agentTeamRuns.leaderAgentId }).from(agentTeamRuns).where(eq(agentTeamRuns.id, runId)).limit(1);
      if (run) return run.leaderAgentId;
    }
    const [leader] = await this.db.select({ id: agentConfigs.id }).from(agentConfigs).where(eq(agentConfigs.id, 'qitu-learning-partner')).limit(1);
    return leader?.id ?? null;
  }

  private async ensureRun(event: TeamEventPayload, leaderAgentId: string, studentUserId: string | null, projectId: string | null): Promise<string> {
    const key = `team-projection-run:${event.eventId}`;
    const existing = await this.db.select({ id: agentTeamRuns.id }).from(agentTeamRuns).where(eq(agentTeamRuns.idempotencyKey, key)).limit(1);
    if (existing[0]) return existing[0].id;
    const id = randomUUID();
    await this.db.insert(agentTeamRuns).values({ id, leaderAgentId, studentUserId, projectId, trigger: `event:${event.topic}`, status: 'queued', context: { sourceEventId: event.eventId }, idempotencyKey: key, createdBy: null }).onConflictDoNothing({ target: agentTeamRuns.idempotencyKey });
    const [run] = await this.db.select({ id: agentTeamRuns.id }).from(agentTeamRuns).where(eq(agentTeamRuns.idempotencyKey, key)).limit(1);
    if (!run) throw new Error('TEAM_RUN_CREATE_FAILED');
    return run.id;
  }
}

function parsePayload(value: unknown): TeamEventPayload | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.eventId !== 'string' || typeof row.topic !== 'string' || !row.payload || typeof row.payload !== 'object') return null;
  return {
    eventId: row.eventId,
    runId: typeof row.runId === 'string' ? row.runId : null,
    taskId: typeof row.taskId === 'string' ? row.taskId : null,
    topic: row.topic,
    payload: row.payload as Record<string, unknown>,
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
