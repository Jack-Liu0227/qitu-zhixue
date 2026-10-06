import { and, asc, eq, or, sql } from 'drizzle-orm';
import {
  agentMailboxes,
  agentConfigs,
  agentRoutes,
  agentProjectionCandidates,
  agentTeamEvents,
  agentTeamMessages,
  agentTeamRuns,
  agentTeamTasks,
  outbox,
  type Database,
} from '@qitu/database';
import { randomUUID } from 'node:crypto';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface TeamMailboxJob {
  message: typeof agentTeamMessages.$inferSelect;
  task: typeof agentTeamTasks.$inferSelect | null;
  leaseOwner: string;
}

/**
 * Durable mailbox lease source. Agent execution is deliberately supplied by
 * the caller: this layer only claims, acknowledges and retries server-owned
 * task state. It never treats an unconfigured model as a successful result.
 */
export class PostgresTeamMailboxSource {
  constructor(
    private readonly db: Database,
    private readonly maxAttempts = 3,
    private readonly leaseMs = 60_000,
  ) {}

  async claim(agentId?: string): Promise<TeamMailboxJob | null> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const available = and(
        eq(agentTeamMessages.status, 'queued'),
        sql`${agentTeamMessages.availableAt} <= ${now}`,
      );
      const expired = and(
        eq(agentTeamMessages.status, 'processing'),
        or(
          sql`${agentTeamMessages.leaseExpiresAt} IS NULL`,
          sql`${agentTeamMessages.leaseExpiresAt} < ${now}`,
        ),
      );
      const agentFilter = agentId
        ? eq(agentTeamMessages.recipientAgentId, agentId)
        : sql`${agentTeamMessages.recipientAgentId} IN (SELECT agent_id FROM agent_mailboxes WHERE enabled = true)`;
      const [message] = await tx.select().from(agentTeamMessages).where(and(
        agentFilter,
        // Result messages are durable communication for the leader. They are
        // not executable jobs and must never be claimed by this worker.
        sql`${agentTeamMessages.messageType} IN ('task.request', 'projection.request')`,
        or(available, expired),
        or(sql`${agentTeamMessages.leaseExpiresAt} IS NULL`, sql`${agentTeamMessages.leaseExpiresAt} < ${now}`),
      )).orderBy(asc(agentTeamMessages.createdAt)).limit(1).for('update', { skipLocked: true });
      if (!message) return null;

      const leaseOwner = randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + this.leaseMs);
      await tx.update(agentTeamMessages).set({
        status: 'processing',
        attempts: message.attempts + 1,
        leaseOwner,
        leaseExpiresAt,
      }).where(eq(agentTeamMessages.id, message.id));
      if (message.status === 'queued') {
        await tx.update(agentMailboxes).set({
          pendingCount: sql`GREATEST(${agentMailboxes.pendingCount} - 1, 0)`,
          leaseOwner,
          leaseExpiresAt,
          updatedAt: now,
        }).where(eq(agentMailboxes.agentId, message.recipientAgentId));
      } else {
        await tx.update(agentMailboxes).set({ leaseOwner, leaseExpiresAt, updatedAt: now })
          .where(eq(agentMailboxes.agentId, message.recipientAgentId));
      }
      let [task] = await tx.select().from(agentTeamTasks).where(eq(agentTeamTasks.id, message.taskId ?? '')).limit(1);
      if (task) {
        await tx.update(agentTeamTasks).set({
          status: 'running',
          attempts: Math.max(task.attempts, message.attempts + 1),
          startedAt: task.startedAt ?? now,
          leaseOwner,
          leaseExpiresAt,
          updatedAt: now,
        }).where(eq(agentTeamTasks.id, task.id));
        task = {
          ...task,
          status: 'running',
          attempts: Math.max(task.attempts, message.attempts + 1),
          startedAt: task.startedAt ?? now,
          leaseOwner,
          leaseExpiresAt,
          updatedAt: now,
        };
        await tx.update(agentTeamRuns).set({
          status: 'running',
          startedAt: sql`COALESCE(${agentTeamRuns.startedAt}, ${now})`,
          updatedAt: now,
        }).where(eq(agentTeamRuns.id, task.runId));
      }
      return {
        message: {
          ...message,
          status: 'processing',
          attempts: message.attempts + 1,
          leaseOwner,
          leaseExpiresAt,
        },
        task: task ?? null,
        leaseOwner,
      };
    });
  }

  async complete(job: TeamMailboxJob, output: Record<string, unknown>): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const taskId = job.task?.id ?? null;
      const delivered = await tx.update(agentTeamMessages).set({
        status: 'delivered',
        deliveredAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
      }).where(and(eq(agentTeamMessages.id, job.message.id), eq(agentTeamMessages.leaseOwner, job.leaseOwner))).returning({ id: agentTeamMessages.id });
      if (delivered.length === 0) return false;
      if (taskId) {
        await tx.update(agentTeamTasks).set({
          status: 'succeeded',
          output,
          errorCode: null,
          completedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        }).where(and(eq(agentTeamTasks.id, taskId), eq(agentTeamTasks.leaseOwner, job.leaseOwner)));
        const [candidate] = await tx.select({ id: agentProjectionCandidates.id, payload: agentProjectionCandidates.payload })
          .from(agentProjectionCandidates)
          .where(eq(agentProjectionCandidates.taskId, taskId))
          .limit(1);
        if (candidate) {
          await tx.update(agentProjectionCandidates).set({
            payload: { ...(candidate.payload ?? {}), result: output },
            status: 'proposed',
          }).where(eq(agentProjectionCandidates.id, candidate.id));
        }
        // Keep the child-to-leader result in the same mailbox protocol. It is
        // already delivered by this worker and must never be claimed as a new
        // model invocation.
        const resultMessageType = job.message.messageType === 'projection.request' ? 'projection.result' : 'delegate.result';
        await tx.insert(agentTeamMessages).values({
          id: randomUUID(),
          runId: job.message.runId,
          taskId,
          mailboxAgentId: job.message.senderAgentId,
          senderAgentId: job.message.recipientAgentId,
          recipientAgentId: job.message.senderAgentId,
          messageType: resultMessageType,
          payload: {
            contractVersion: 'qitu.team-runtime.v1',
            messageType: resultMessageType,
            runId: job.message.runId,
            taskId,
            taskType: job.task?.taskType ?? null,
            senderAgentId: job.message.recipientAgentId,
            recipientAgentId: job.message.senderAgentId,
            status: 'succeeded',
            output,
            correlationId: job.message.correlationId ?? taskId,
            causationId: job.message.id,
          },
          status: 'delivered',
          correlationId: job.message.correlationId ?? taskId,
          causationId: job.message.id,
          idempotencyKey: `agent-team-result:${job.message.id}`,
          deliveredAt: now,
          createdAt: now,
        }).onConflictDoNothing({ target: agentTeamMessages.idempotencyKey });
        await this.enqueueInterestRecommendation(tx, job, output, now);
        await this.updateRunStatus(tx, job.task?.runId ?? job.message.runId, now);
      }
      await this.clearMailboxLease(tx, job.message.recipientAgentId, job.leaseOwner, now);
      await this.writeCompletionEvent(tx, job, 'succeeded', now, undefined, output);
      return true;
    });
  }

  async retry(job: TeamMailboxJob, error: unknown): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const attempts = Math.max(job.message.attempts, job.task?.attempts ?? 0);
      const terminal = attempts >= this.maxAttempts || (job.task?.maxAttempts !== undefined && attempts >= job.task.maxAttempts);
      const errorCode = toErrorCode(error);
      const nextAvailable = new Date(now.getTime() + Math.min(60_000, Math.max(1_000, attempts * 2_000)));
      const status = terminal ? 'failed' : 'queued';
      const messageStatus = terminal ? 'delivered' : 'queued';
      const updated = await tx.update(agentTeamMessages).set({
        status: messageStatus,
        deliveredAt: terminal ? now : null,
        availableAt: nextAvailable,
        leaseOwner: null,
        leaseExpiresAt: null,
      }).where(and(eq(agentTeamMessages.id, job.message.id), eq(agentTeamMessages.leaseOwner, job.leaseOwner))).returning({ id: agentTeamMessages.id });
      if (updated.length === 0) return false;
      if (job.task) {
        await tx.update(agentTeamTasks).set({
          status,
          errorCode,
          completedAt: terminal ? now : null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        }).where(and(eq(agentTeamTasks.id, job.task.id), eq(agentTeamTasks.leaseOwner, job.leaseOwner)));
        if (terminal) {
          const resultMessageType = job.message.messageType === 'projection.request' ? 'projection.result' : 'delegate.result';
          await tx.insert(agentTeamMessages).values({
            id: randomUUID(),
            runId: job.message.runId,
            taskId: job.task.id,
            mailboxAgentId: job.message.senderAgentId,
            senderAgentId: job.message.recipientAgentId,
            recipientAgentId: job.message.senderAgentId,
            messageType: resultMessageType,
            payload: {
              contractVersion: 'qitu.team-runtime.v1',
              messageType: resultMessageType,
              runId: job.message.runId,
              taskId: job.task.id,
              taskType: job.task.taskType,
              senderAgentId: job.message.recipientAgentId,
              recipientAgentId: job.message.senderAgentId,
              status: 'failed',
              output: null,
              errorCode,
              correlationId: job.message.correlationId ?? job.task.id,
              causationId: job.message.id,
            },
            status: 'delivered',
            correlationId: job.message.correlationId ?? job.task.id,
            causationId: job.message.id,
            idempotencyKey: `agent-team-result:${job.message.id}:${errorCode}`,
            deliveredAt: now,
            createdAt: now,
          }).onConflictDoNothing({ target: agentTeamMessages.idempotencyKey });
        }
        if (terminal) await this.updateRunStatus(tx, job.task.runId, now);
      }
      if (!terminal) {
        await tx.update(agentMailboxes).set({ pendingCount: sql`${agentMailboxes.pendingCount} + 1`, updatedAt: now })
          .where(eq(agentMailboxes.agentId, job.message.recipientAgentId));
      }
      await this.clearMailboxLease(tx, job.message.recipientAgentId, job.leaseOwner, now);
      await this.writeCompletionEvent(tx, job, status, now, errorCode, null);
      return true;
    });
  }

  /**
   * Interest confirmation is the only server-owned trigger for project
   * recommendation. The worker checks the explicit child route and target
   * Agent state before inserting the follow-up task; a model result cannot
   * create a project or bypass the route allow-list.
   */
  private async enqueueInterestRecommendation(
    tx: Transaction,
    job: TeamMailboxJob,
    output: Record<string, unknown>,
    now: Date,
  ): Promise<void> {
    if (job.task?.taskType !== 'interest.confirm' && job.task?.taskType !== 'interest.confirmation') return;
    if (output.confirmed !== true) return;

    const [route] = await tx.select({ toAgentId: agentRoutes.toAgentId })
      .from(agentRoutes)
      .where(and(
        eq(agentRoutes.fromAgentId, job.message.recipientAgentId),
        eq(agentRoutes.toAgentId, 'project-recommender'),
        eq(agentRoutes.trigger, 'delegate'),
        eq(agentRoutes.taskType, 'project.recommend'),
        eq(agentRoutes.enabled, true),
      ))
      .limit(1);
    const recipientAgentId = route?.toAgentId;
    if (!recipientAgentId) return;
    const [recipient] = await tx.select({ enabled: agentConfigs.enabled })
      .from(agentConfigs)
      .where(eq(agentConfigs.id, recipientAgentId))
      .limit(1);
    if (!recipient?.enabled) return;

    const input = {
      studentId: asString(job.task.input.studentId),
      interests: boundedStringArray(output.interests, 8, 120),
      learnerProfile: null,
      availableTemplateIds: [],
    } satisfies Record<string, unknown>;
    if (!input.studentId) return;

    const taskKey = `team-followup:project-recommend:${job.task.id}`;
    const taskId = randomUUID();
    await tx.insert(agentTeamTasks).values({
      id: taskId,
      runId: job.task.runId,
      parentTaskId: job.task.id,
      agentId: recipientAgentId,
      taskType: 'project.recommend',
      status: 'queued',
      input,
      idempotencyKey: taskKey,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing({ target: agentTeamTasks.idempotencyKey });
    const [task] = await tx.select({ id: agentTeamTasks.id })
      .from(agentTeamTasks)
      .where(eq(agentTeamTasks.idempotencyKey, taskKey))
      .limit(1);
    if (!task) return;

    const inserted = await tx.insert(agentTeamMessages).values({
      id: randomUUID(),
      runId: job.task.runId,
      taskId: task.id,
      mailboxAgentId: recipientAgentId,
      senderAgentId: job.message.recipientAgentId,
      recipientAgentId,
      messageType: 'task.request',
      payload: input,
      status: 'queued',
      correlationId: task.id,
      causationId: job.message.id,
      idempotencyKey: `${taskKey}:request`,
      createdAt: now,
    }).onConflictDoNothing({ target: agentTeamMessages.idempotencyKey }).returning({ id: agentTeamMessages.id });
    if (inserted.length > 0) {
      await tx.insert(agentMailboxes).values({ agentId: recipientAgentId, pendingCount: 1, updatedAt: now })
        .onConflictDoUpdate({
          target: agentMailboxes.agentId,
          set: { pendingCount: sql`${agentMailboxes.pendingCount} + 1`, updatedAt: now },
        });
    }
  }

  private async clearMailboxLease(tx: Transaction, agentId: string, leaseOwner: string, now: Date): Promise<void> {
    await tx.update(agentMailboxes).set({ leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
      .where(and(eq(agentMailboxes.agentId, agentId), eq(agentMailboxes.leaseOwner, leaseOwner)));
  }

  private async updateRunStatus(tx: Transaction, runId: string, now: Date): Promise<void> {
    const tasks = await tx.select({ status: agentTeamTasks.status }).from(agentTeamTasks)
      .where(eq(agentTeamTasks.runId, runId));
    if (tasks.length === 0) return;
    const status = tasks.some((task) => task.status === 'failed' || task.status === 'cancelled' || task.status === 'timed_out')
      ? 'failed'
      : tasks.every((task) => task.status === 'succeeded')
        ? 'completed'
        : 'running';
    await tx.update(agentTeamRuns).set({
      status,
      completedAt: status === 'completed' || status === 'failed' ? now : null,
      updatedAt: now,
    }).where(eq(agentTeamRuns.id, runId));
  }

  private async writeCompletionEvent(
    tx: Transaction,
    job: TeamMailboxJob,
    status: string,
    occurredAt: Date,
    errorCode?: string,
    output: Record<string, unknown> | null = null,
  ): Promise<void> {
    const taskId = job.task?.id ?? null;
    const eventIdempotencyKey = `agent-team-task:${job.message.id}:${status}`;
    const eventId = randomUUID();
    const payload = {
      taskId,
      messageId: job.message.id,
      agentId: job.message.recipientAgentId,
      status,
      output,
      ...(errorCode ? { errorCode } : {}),
    };
    await tx.insert(agentTeamEvents).values({
      id: eventId,
      runId: job.message.runId,
      taskId,
      topic: `agent.team.task.${status}`,
      sequence: 0,
      payload,
      idempotencyKey: eventIdempotencyKey,
      occurredAt,
      createdAt: occurredAt,
    }).onConflictDoNothing({ target: agentTeamEvents.idempotencyKey });
    await tx.insert(outbox).values({
      id: `agent-team-event:${eventIdempotencyKey}`,
      topic: 'agent.team.event',
      payload: { eventId, runId: job.message.runId, taskId, topic: `agent.team.task.${status}`, payload },
      status: 'pending',
      attempts: 0,
    }).onConflictDoNothing({ target: outbox.id });
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function boundedStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, maxLength))
    .slice(0, maxItems);
}

function toErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return /^[A-Z][A-Z0-9_]{2,80}$/u.test(value) ? value : 'TEAM_AGENT_EXECUTION_FAILED';
}
