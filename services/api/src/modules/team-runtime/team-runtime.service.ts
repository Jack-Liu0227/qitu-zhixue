import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  agentConfigs,
  agentMailboxes,
  agentRoutes,
  agentTeamEvents,
  agentTeamMessages,
  agentTeamRuns,
  agentTeamTasks,
  type Database,
  withTransaction,
} from '@qitu/database';
import type { CurrentUser } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { OutboxWriter } from '../../common/outbox/outbox.service';

export type TeamRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TeamTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const EXECUTABLE_TEAM_MESSAGE_TYPES = ['task.request', 'projection.request'] as const;

export function isExecutableTeamMessageType(messageType: string): boolean {
  return (EXECUTABLE_TEAM_MESSAGE_TYPES as readonly string[]).includes(messageType);
}

export interface StartTeamRunInput {
  leaderAgentId?: string;
  studentUserId?: string | null;
  projectId?: string | null;
  tutorSessionId?: string | null;
  trigger?: string;
  context?: Record<string, unknown>;
  idempotencyKey: string;
}

export interface DelegateTaskInput {
  senderAgentId: string;
  recipientAgentId: string;
  taskType: string;
  input?: Record<string, unknown>;
  parentTaskId?: string | null;
  idempotencyKey: string;
  maxAttempts?: number;
}

export type AgentRouteTrigger = 'delegate' | 'event' | 'schedule';

export interface AgentRouteInput {
  fromAgentId: string;
  toAgentId: string;
  trigger: AgentRouteTrigger;
  taskType: string;
  enabled?: boolean;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
}

export interface AgentRouteUpdateInput {
  fromAgentId?: string;
  toAgentId?: string;
  trigger?: AgentRouteTrigger;
  taskType?: string;
  enabled?: boolean;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
}

export interface TeamRunGraph {
  run: Record<string, unknown>;
  tasks: readonly Record<string, unknown>[];
  messages: readonly Record<string, unknown>[];
  events: readonly Record<string, unknown>[];
}

type TeacherProjectionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled' | 'unknown' | 'idle';
type TeacherNodeStatus = Exclude<TeacherProjectionStatus, 'idle'>;

export interface TeacherAgentRunProjection {
  runId: string | null;
  status: TeacherProjectionStatus;
  nodes: readonly {
    id: string;
    agentId: string;
    label: string;
    status: TeacherNodeStatus;
    summary?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    durationMs?: number | null;
  }[];
  activity: readonly {
    id: string;
    timestamp: string;
    actorId: string;
    actorLabel: string;
    type: string;
    status?: TeacherNodeStatus;
    summary: string;
    detail?: string | null;
  }[];
  generatedAt: string | null;
}

interface AgentRow {
  id: string;
  displayName: string;
  role: string | null;
  roleDefinition: string;
  parentAgentId: string | null;
  enabled: boolean;
  modelProviderId: string | null;
  modelId: string | null;
  capabilities: unknown;
}

/**
 * Server-owned Team Runtime. This is intentionally a persistence and routing
 * layer; model invocation and domain writes remain behind their own services.
 */
@Injectable()
export class TeamRuntimeService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async startRun(actor: CurrentUser, input: StartTeamRunInput) {
    const db = this.requireDb();
    const leaderAgentId = input.leaderAgentId?.trim() || 'qitu-learning-partner';
    const studentUserId = input.studentUserId ?? (actor.role === 'student' ? actor.id : null);
    this.assertStudentScope(actor, studentUserId);
    const leader = await this.getAgent(leaderAgentId);
    if (!leader || !leader.enabled) throw new BadRequestException('AI 导师或 Team Leader 不可用');
    const key = normalizeKey(input.idempotencyKey, 'team-run');

    const existing = await db.select().from(agentTeamRuns).where(eq(agentTeamRuns.idempotencyKey, key)).limit(1);
    if (existing[0]) {
      this.assertRunAccess(existing[0], actor);
      return toRunView(existing[0]);
    }

    const id = randomUUID();
    const now = new Date();
    await withTransaction(db, async (tx) => {
      const inserted = await tx.insert(agentTeamRuns).values({
        id,
        leaderAgentId,
        studentUserId,
        projectId: input.projectId ?? null,
        tutorSessionId: input.tutorSessionId ?? null,
        trigger: input.trigger?.trim() || 'tutor.turn',
        status: 'queued',
        context: input.context ?? {},
        idempotencyKey: key,
        createdBy: actor.id,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing({ target: agentTeamRuns.idempotencyKey }).returning({ id: agentTeamRuns.id });
      if (inserted.length === 0) return;
      await tx.insert(agentMailboxes).values({ agentId: leaderAgentId, updatedAt: now }).onConflictDoNothing({ target: agentMailboxes.agentId });
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'agent.team_run.create',
        targetType: 'agent_team_run',
        targetId: id,
        idempotencyKey: key,
        detail: { leaderAgentId, studentUserId, trigger: input.trigger ?? 'tutor.turn' },
      }, tx);
    });
    const [created] = await db.select().from(agentTeamRuns).where(eq(agentTeamRuns.idempotencyKey, key)).limit(1);
    if (!created) throw new ServiceUnavailableException('Team Run 创建未返回记录');
    return toRunView(created);
  }

  /**
   * Delegate is the only supported Agent-to-Agent call. The allow-list route
   * is checked server-side; parentAgentId is not treated as authorization.
   */
  async delegate(actor: CurrentUser, runId: string, input: DelegateTaskInput) {
    const db = this.requireDb();
    const run = await this.getRunRow(runId);
    this.assertRunAccess(run, actor);
    const route = await db.select().from(agentRoutes).where(and(
      eq(agentRoutes.fromAgentId, input.senderAgentId),
      eq(agentRoutes.toAgentId, input.recipientAgentId),
      eq(agentRoutes.trigger, 'delegate'),
      eq(agentRoutes.taskType, input.taskType),
      eq(agentRoutes.enabled, true),
    )).limit(1);
    if (!route[0]) throw new BadRequestException('Agent 路由未授权');
    const [sender, recipient] = await Promise.all([
      this.getAgent(input.senderAgentId),
      this.getAgent(input.recipientAgentId),
    ]);
    if (!sender?.enabled || !recipient?.enabled) throw new BadRequestException('Agent 不存在或已停用');
    if (run.leaderAgentId !== input.senderAgentId && !(await this.taskBelongsToAgent(runId, input.parentTaskId ?? null, input.senderAgentId))) {
      throw new BadRequestException('发送 Agent 不属于当前 Team Run');
    }
    const taskKey = normalizeKey(input.idempotencyKey, 'team-task');
    const messageKey = `${taskKey}:request`;
    const taskId = randomUUID();
    const now = new Date();
    await withTransaction(db, async (tx) => {
      const insertedTasks = await tx.insert(agentTeamTasks).values({
        id: taskId,
        runId,
        parentTaskId: input.parentTaskId ?? null,
        agentId: input.recipientAgentId,
        taskType: input.taskType,
        status: 'queued',
        input: input.input ?? {},
        idempotencyKey: taskKey,
        maxAttempts: clampAttempts(input.maxAttempts),
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing({ target: agentTeamTasks.idempotencyKey }).returning({ id: agentTeamTasks.id });
      const [task] = await tx.select({ id: agentTeamTasks.id }).from(agentTeamTasks).where(eq(agentTeamTasks.idempotencyKey, taskKey)).limit(1);
      if (!task) throw new ServiceUnavailableException('Team Task 创建失败');
      const insertedMessages = await tx.insert(agentTeamMessages).values({
        id: randomUUID(),
        runId,
        taskId: task.id,
        mailboxAgentId: input.recipientAgentId,
        senderAgentId: input.senderAgentId,
        recipientAgentId: input.recipientAgentId,
        messageType: 'task.request',
        payload: input.input ?? {},
        status: 'queued',
        correlationId: task.id,
        idempotencyKey: messageKey,
        createdAt: now,
      }).onConflictDoNothing({ target: agentTeamMessages.idempotencyKey }).returning({ id: agentTeamMessages.id });
      if (insertedMessages.length > 0) await tx.insert(agentMailboxes).values({ agentId: input.recipientAgentId, pendingCount: 1, updatedAt: now })
        .onConflictDoUpdate({ target: agentMailboxes.agentId, set: { pendingCount: sql`${agentMailboxes.pendingCount} + 1`, updatedAt: now } });
      if (insertedTasks.length > 0) await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'agent.team_task.delegate',
        targetType: 'agent_team_task',
        targetId: task.id,
        idempotencyKey: taskKey,
        detail: { runId, senderAgentId: input.senderAgentId, recipientAgentId: input.recipientAgentId, taskType: input.taskType },
      }, tx);
    });
    const [task] = await db.select().from(agentTeamTasks).where(eq(agentTeamTasks.idempotencyKey, taskKey)).limit(1);
    if (!task) throw new ServiceUnavailableException('Team Task 创建未返回记录');
    return toTaskView(task);
  }

  /**
   * Optional internal delegation used by the Tutor Team Leader. A configured
   * route whose recipient is disabled is a normal rollout state, so it is
   * reported as `null`; authorization, persistence and idempotency still use
   * the same delegate path when the route is available.
   */
  async delegateIfAvailable(actor: CurrentUser, runId: string, input: DelegateTaskInput): Promise<Record<string, unknown> | null> {
    const db = this.requireDb();
    const [route] = await db.select({ id: agentRoutes.id }).from(agentRoutes).where(and(
      eq(agentRoutes.fromAgentId, input.senderAgentId),
      eq(agentRoutes.toAgentId, input.recipientAgentId),
      eq(agentRoutes.trigger, 'delegate'),
      eq(agentRoutes.taskType, input.taskType),
      eq(agentRoutes.enabled, true),
    )).limit(1);
    if (!route) return null;
    const recipient = await this.getAgent(input.recipientAgentId);
    if (!recipient?.enabled) return null;
    return this.delegate(actor, runId, input);
  }

  async recordEvent(input: {
    runId?: string | null;
    taskId?: string | null;
    topic: string;
    payload?: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<string> {
    const db = this.requireDb();
    const key = normalizeKey(input.idempotencyKey, 'team-event');
    const existing = await db.select({ id: agentTeamEvents.id }).from(agentTeamEvents).where(eq(agentTeamEvents.idempotencyKey, key)).limit(1);
    if (existing[0]) return existing[0].id;
    const id = randomUUID();
    const now = new Date();
    await withTransaction(db, async (tx) => {
      await tx.insert(agentTeamEvents).values({
        id,
        runId: input.runId ?? null,
        taskId: input.taskId ?? null,
        topic: input.topic,
        sequence: 0,
        payload: input.payload ?? {},
        idempotencyKey: key,
        occurredAt: now,
        createdAt: now,
      }).onConflictDoNothing({ target: agentTeamEvents.idempotencyKey });
      await this.outbox.write({
        id: `agent-team-event:${id}`,
        topic: 'agent.team.event',
        payload: { eventId: id, runId: input.runId ?? null, taskId: input.taskId ?? null, topic: input.topic, payload: input.payload ?? {} },
      }, tx);
    });
    return id;
  }

  async getStaticGraph() {
    const db = this.requireDb();
    const [agents, routes] = await Promise.all([
      db.select().from(agentConfigs).orderBy(asc(agentConfigs.displayName)),
      db.select().from(agentRoutes).where(eq(agentRoutes.enabled, true)).orderBy(asc(agentRoutes.fromAgentId)),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      nodes: agents.map((agent) => toAgentView(agent)),
      edges: routes.map((route) => ({
        id: route.id,
        source: route.fromAgentId,
        target: route.toAgentId,
        trigger: route.trigger,
        taskType: route.taskType,
        enabled: route.enabled,
      })),
    };
  }

  async listRoutes() {
    const db = this.requireDb();
    const routes = await db.select().from(agentRoutes).orderBy(asc(agentRoutes.fromAgentId), asc(agentRoutes.toAgentId));
    return routes.map(toRouteView);
  }

  async createRoute(actor: CurrentUser, input: AgentRouteInput, idempotencyKey?: string) {
    const db = this.requireDb();
    await this.assertRouteAgents(input.fromAgentId, input.toAgentId);
    const id = randomUUID();
    const now = new Date();
    await withTransaction(db, async (tx) => {
      await tx.insert(agentRoutes).values({
        id,
        fromAgentId: input.fromAgentId,
        toAgentId: input.toAgentId,
        trigger: input.trigger,
        taskType: input.taskType,
        enabled: input.enabled ?? true,
        inputSchema: input.inputSchema ?? null,
        outputSchema: input.outputSchema ?? null,
        updatedBy: actor.id,
        createdAt: now,
        updatedAt: now,
      });
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'admin.agent_route.create',
        targetType: 'agent_route',
        targetId: id,
        idempotencyKey,
        detail: { fromAgentId: input.fromAgentId, toAgentId: input.toAgentId, trigger: input.trigger, taskType: input.taskType },
      }, tx);
    });
    const [created] = await db.select().from(agentRoutes).where(eq(agentRoutes.id, id)).limit(1);
    if (!created) throw new ServiceUnavailableException('Agent 路由创建未返回记录');
    return toRouteView(created);
  }

  async updateRoute(actor: CurrentUser, routeId: string, input: AgentRouteUpdateInput, idempotencyKey?: string) {
    const db = this.requireDb();
    const [existing] = await db.select().from(agentRoutes).where(eq(agentRoutes.id, routeId)).limit(1);
    if (!existing) throw new NotFoundException('Agent 路由不存在');
    const fromAgentId = input.fromAgentId ?? existing.fromAgentId;
    const toAgentId = input.toAgentId ?? existing.toAgentId;
    await this.assertRouteAgents(fromAgentId, toAgentId);
    const now = new Date();
    await withTransaction(db, async (tx) => {
      await tx.update(agentRoutes).set({
        fromAgentId,
        toAgentId,
        ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
        ...(input.taskType !== undefined ? { taskType: input.taskType } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.inputSchema !== undefined ? { inputSchema: input.inputSchema } : {}),
        ...(input.outputSchema !== undefined ? { outputSchema: input.outputSchema } : {}),
        updatedBy: actor.id,
        updatedAt: now,
      }).where(eq(agentRoutes.id, routeId));
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'admin.agent_route.update',
        targetType: 'agent_route',
        targetId: routeId,
        idempotencyKey,
        detail: { changedFields: Object.keys(input), fromAgentId, toAgentId, trigger: input.trigger, taskType: input.taskType },
      }, tx);
    });
    const [updated] = await db.select().from(agentRoutes).where(eq(agentRoutes.id, routeId)).limit(1);
    if (!updated) throw new ServiceUnavailableException('Agent 路由更新未返回记录');
    return toRouteView(updated);
  }

  async getRunGraph(actor: CurrentUser, runId: string): Promise<TeamRunGraph> {
    const db = this.requireDb();
    const run = await this.getRunRow(runId);
    this.assertRunAccess(run, actor);
    const [tasks, messages, events] = await Promise.all([
      db.select().from(agentTeamTasks).where(eq(agentTeamTasks.runId, runId)).orderBy(asc(agentTeamTasks.createdAt)),
      db.select().from(agentTeamMessages).where(eq(agentTeamMessages.runId, runId)).orderBy(asc(agentTeamMessages.createdAt)),
      db.select().from(agentTeamEvents).where(eq(agentTeamEvents.runId, runId)).orderBy(asc(agentTeamEvents.createdAt)),
    ]);
    return {
      run: toRunView(run),
      tasks: tasks.map(toTaskView),
      messages: messages.map(toMessageView),
      events: events.map(toEventView),
    };
  }

  /** Read-only projection used by the teacher workspace after its assignment check. */
  async getLatestRunProjection(studentUserId: string): Promise<TeacherAgentRunProjection> {
    if (!this.db) return emptyTeacherAgentRunProjection();
    const [run] = await this.db
      .select()
      .from(agentTeamRuns)
      .where(eq(agentTeamRuns.studentUserId, studentUserId))
      .orderBy(desc(agentTeamRuns.createdAt))
      .limit(1);
    if (!run) return emptyTeacherAgentRunProjection();

    const [tasks, events] = await Promise.all([
      this.db
        .select()
        .from(agentTeamTasks)
        .where(eq(agentTeamTasks.runId, run.id))
        .orderBy(asc(agentTeamTasks.createdAt)),
      this.db
        .select()
        .from(agentTeamEvents)
        .where(eq(agentTeamEvents.runId, run.id))
        .orderBy(asc(agentTeamEvents.occurredAt)),
    ]);
    const agentIds = [...new Set([run.leaderAgentId, ...tasks.map((task) => task.agentId)])];
    const agents = agentIds.length === 0
      ? []
      : await this.db
        .select({ id: agentConfigs.id, displayName: agentConfigs.displayName })
        .from(agentConfigs)
        .where(inArray(agentConfigs.id, agentIds));
    const labels = new Map(agents.map((agent) => [agent.id, agent.displayName]));
    const nodes = tasks.length > 0
      ? tasks.map((task) => toTeacherRunNode(task, labels.get(task.agentId) ?? task.agentId))
      : [{
          id: `run:${run.id}`,
          agentId: run.leaderAgentId,
          label: labels.get(run.leaderAgentId) ?? run.leaderAgentId,
          status: toTeacherStatus(run.status),
          summary: null,
          startedAt: run.startedAt?.toISOString() ?? null,
          finishedAt: run.completedAt?.toISOString() ?? null,
          durationMs: durationMs(run.startedAt, run.completedAt),
        }];
    const activity = [
      ...tasks.map((task) => ({
        id: `task:${task.id}`,
        timestamp: (task.completedAt ?? task.startedAt ?? task.createdAt).toISOString(),
        actorId: task.agentId,
        actorLabel: labels.get(task.agentId) ?? task.agentId,
        type: task.taskType,
        status: toTeacherStatus(task.status),
        summary: task.errorCode ? `${task.status}: ${task.errorCode}` : `任务 ${task.status}`,
        detail: task.output ? summarizePayload(task.output) : null,
      })),
      ...events.map((event) => ({
        id: `event:${event.id}`,
        timestamp: event.occurredAt.toISOString(),
        actorId: run.leaderAgentId,
        actorLabel: labels.get(run.leaderAgentId) ?? run.leaderAgentId,
        type: event.topic,
        summary: event.topic,
        detail: summarizePayload(event.payload),
      })),
    ].sort((left, right) => left.timestamp.localeCompare(right.timestamp));

    return {
      runId: run.id,
      status: toTeacherStatus(run.status),
      nodes,
      activity,
      generatedAt: new Date().toISOString(),
    };
  }

  async claimMailbox(agentId: string, workerId: string, leaseMs = 60_000) {
    const db = this.requireDb();
    const now = new Date();
    const expires = new Date(now.getTime() + Math.max(1_000, leaseMs));
    return db.transaction(async (tx) => {
      const [message] = await tx.select().from(agentTeamMessages).where(and(
        eq(agentTeamMessages.recipientAgentId, agentId),
        inArray(agentTeamMessages.messageType, [...EXECUTABLE_TEAM_MESSAGE_TYPES]),
        or(
          eq(agentTeamMessages.status, 'queued'),
          and(eq(agentTeamMessages.status, 'processing'), sql`${agentTeamMessages.leaseExpiresAt} < ${now}`),
        ),
        sql`${agentTeamMessages.availableAt} <= ${now}`,
        or(sql`${agentTeamMessages.leaseExpiresAt} IS NULL`, sql`${agentTeamMessages.leaseExpiresAt} < ${now}`),
      )).orderBy(asc(agentTeamMessages.createdAt)).limit(1).for('update', { skipLocked: true });
      if (!message) return null;
      await tx.update(agentTeamMessages).set({ status: 'processing', attempts: message.attempts + 1, leaseOwner: workerId, leaseExpiresAt: expires }).where(eq(agentTeamMessages.id, message.id));
      if (message.status === 'queued') await tx.update(agentMailboxes).set({ pendingCount: sql`GREATEST(${agentMailboxes.pendingCount} - 1, 0)`, leaseOwner: workerId, leaseExpiresAt: expires, updatedAt: now }).where(eq(agentMailboxes.agentId, agentId));
      else await tx.update(agentMailboxes).set({ leaseOwner: workerId, leaseExpiresAt: expires, updatedAt: now }).where(eq(agentMailboxes.agentId, agentId));
      return { ...message, status: 'processing', attempts: message.attempts + 1, leaseOwner: workerId, leaseExpiresAt: expires };
    });
  }

  async finishTask(taskId: string, output: Record<string, unknown>, success = true) {
    const db = this.requireDb();
    return db.transaction(async (tx) => {
      const [task] = await tx.select().from(agentTeamTasks).where(eq(agentTeamTasks.id, taskId)).limit(1);
      if (!task) throw new NotFoundException('Team Task 不存在');
      const now = new Date();
      const status = success ? 'succeeded' : 'failed';
      const errorCode = success ? null : String(output.errorCode ?? 'AGENT_TASK_FAILED');
      const [requestMessage] = await tx.select().from(agentTeamMessages).where(and(
        eq(agentTeamMessages.taskId, taskId),
        inArray(agentTeamMessages.messageType, [...EXECUTABLE_TEAM_MESSAGE_TYPES]),
      )).orderBy(desc(agentTeamMessages.createdAt)).limit(1);

      await tx.update(agentTeamTasks).set({
        status,
        output,
        errorCode,
        completedAt: now,
        updatedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
      }).where(eq(agentTeamTasks.id, taskId));
      if (requestMessage) {
        await tx.update(agentTeamMessages).set({
          status: 'delivered',
          deliveredAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
        }).where(eq(agentTeamMessages.id, requestMessage.id));
        const messageType = requestMessage.messageType === 'projection.request' ? 'projection.result' : 'delegate.result';
        await tx.insert(agentTeamMessages).values({
          id: randomUUID(),
          runId: requestMessage.runId,
          taskId,
          mailboxAgentId: requestMessage.senderAgentId,
          senderAgentId: requestMessage.recipientAgentId,
          recipientAgentId: requestMessage.senderAgentId,
          messageType,
          payload: {
            contractVersion: 'qitu.team-runtime.v1',
            messageType,
            runId: requestMessage.runId,
            taskId,
            senderAgentId: requestMessage.recipientAgentId,
            recipientAgentId: requestMessage.senderAgentId,
            taskKind: task.taskType,
            status,
            output,
            errorCode,
            correlationId: requestMessage.correlationId ?? taskId,
            causationId: requestMessage.id,
          },
          status: 'delivered',
          correlationId: requestMessage.correlationId ?? taskId,
          causationId: requestMessage.id,
          idempotencyKey: `agent-team-result:${requestMessage.id}:${status}`,
          deliveredAt: now,
          createdAt: now,
        }).onConflictDoNothing({ target: agentTeamMessages.idempotencyKey });
      }
      await this.updateRunStatus(tx, task.runId, now);
      const [updated] = await tx.select().from(agentTeamTasks).where(eq(agentTeamTasks.id, taskId)).limit(1);
      if (!updated) throw new ServiceUnavailableException('Team Task 更新未返回记录');
      return toTaskView(updated);
    });
  }

  private async updateRunStatus(tx: Parameters<Parameters<Database['transaction']>[0]>[0], runId: string, now: Date): Promise<void> {
    const tasks = await tx.select({ status: agentTeamTasks.status }).from(agentTeamTasks)
      .where(eq(agentTeamTasks.runId, runId));
    if (tasks.length === 0) return;
    const status = tasks.some((task) => task.status === 'failed' || task.status === 'cancelled')
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

  private requireDb(): Database {
    if (!this.db) throw new ServiceUnavailableException('Team Runtime 存储不可用');
    return this.db;
  }

  private async getAgent(id: string): Promise<AgentRow | null> {
    const db = this.requireDb();
    const [agent] = await db.select().from(agentConfigs).where(eq(agentConfigs.id, id)).limit(1);
    return agent ? agent as AgentRow : null;
  }

  private async assertRouteAgents(fromAgentId: string, toAgentId: string): Promise<void> {
    if (fromAgentId === toAgentId) throw new BadRequestException('Agent 路由不能指向自身');
    const db = this.requireDb();
    const rows = await db.select({ id: agentConfigs.id }).from(agentConfigs).where(inArray(agentConfigs.id, [fromAgentId, toAgentId]));
    const ids = new Set(rows.map((row) => row.id));
    if (!ids.has(fromAgentId) || !ids.has(toAgentId)) throw new BadRequestException('Agent 路由端点不存在');
  }

  private async getRunRow(id: string) {
    const db = this.requireDb();
    const [run] = await db.select().from(agentTeamRuns).where(eq(agentTeamRuns.id, id)).limit(1);
    if (!run) throw new NotFoundException('Team Run 不存在');
    return run;
  }

  private async taskBelongsToAgent(runId: string, taskId: string | null, agentId: string): Promise<boolean> {
    if (!taskId) return false;
    const db = this.requireDb();
    const [row] = await db.select({ id: agentTeamTasks.id }).from(agentTeamTasks).where(and(eq(agentTeamTasks.id, taskId), eq(agentTeamTasks.runId, runId), eq(agentTeamTasks.agentId, agentId))).limit(1);
    return Boolean(row);
  }

  private assertRunAccess(run: { studentUserId: string | null }, actor: CurrentUser): void {
    if (actor.role === 'admin') return;
    if (actor.role !== 'student' || run.studentUserId !== actor.id) throw new BadRequestException('无权访问该 Team Run');
  }

  private assertStudentScope(actor: CurrentUser, studentId: string | null): void {
    if (actor.role !== 'admin' && actor.role !== 'student') throw new BadRequestException('TEAM_RUN_SCOPE');
    if (actor.role === 'student' && studentId !== actor.id) throw new BadRequestException('不能为其他学生创建 Team Run');
  }
}

function normalizeKey(key: string, prefix: string): string {
  const normalized = key.trim();
  if (normalized.length < 1 || normalized.length > 160) throw new BadRequestException(`${prefix} 的幂等键无效`);
  return normalized;
}

function clampAttempts(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 3;
  return Math.min(10, Math.max(1, Math.trunc(value)));
}

function toRunView(row: typeof agentTeamRuns.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    leaderAgentId: row.leaderAgentId,
    studentUserId: row.studentUserId,
    projectId: row.projectId,
    tutorSessionId: row.tutorSessionId,
    trigger: row.trigger,
    status: row.status,
    context: row.context,
    createdBy: row.createdBy,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTaskView(row: typeof agentTeamTasks.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    runId: row.runId,
    parentTaskId: row.parentTaskId,
    agentId: row.agentId,
    taskType: row.taskType,
    status: row.status,
    input: row.input,
    output: row.output,
    errorCode: row.errorCode,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toMessageView(row: typeof agentTeamMessages.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    runId: row.runId,
    taskId: row.taskId,
    mailboxAgentId: row.mailboxAgentId,
    senderAgentId: row.senderAgentId,
    recipientAgentId: row.recipientAgentId,
    messageType: row.messageType,
    payload: row.payload,
    status: row.status,
    correlationId: row.correlationId,
    causationId: row.causationId,
    attempts: row.attempts,
    availableAt: row.availableAt.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toEventView(row: typeof agentTeamEvents.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    runId: row.runId,
    taskId: row.taskId,
    topic: row.topic,
    sequence: row.sequence,
    payload: row.payload,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toRouteView(row: typeof agentRoutes.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    fromAgentId: row.fromAgentId,
    toAgentId: row.toAgentId,
    trigger: row.trigger,
    taskType: row.taskType,
    enabled: row.enabled,
    inputSchema: row.inputSchema,
    outputSchema: row.outputSchema,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAgentView(row: typeof agentConfigs.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    label: row.displayName,
    role: row.role,
    roleDefinition: row.roleDefinition,
    parentAgentId: row.parentAgentId,
    enabled: row.enabled,
    modelProviderId: row.modelProviderId,
    modelId: row.modelId,
    capabilities: row.capabilities,
    configVersion: row.configVersion,
  };
}

function emptyTeacherAgentRunProjection(): TeacherAgentRunProjection {
  return { runId: null, status: 'idle', nodes: [], activity: [], generatedAt: null };
}

function toTeacherStatus(value: string): TeacherNodeStatus {
  if (value === 'completed') return 'succeeded';
  if (value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed' || value === 'blocked' || value === 'cancelled') {
    return value;
  }
  return 'unknown';
}

function durationMs(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  return Math.max(0, end.getTime() - start.getTime());
}

function summarizePayload(payload: unknown): string | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === 'string') return payload.slice(0, 500);
  try {
    return JSON.stringify(payload).slice(0, 500);
  } catch {
    return null;
  }
}

function toTeacherRunNode(
  row: typeof agentTeamTasks.$inferSelect,
  label: string,
): TeacherAgentRunProjection['nodes'][number] {
  return {
    id: row.id,
    agentId: row.agentId,
    label,
    status: toTeacherStatus(row.status),
    summary: row.errorCode ? `${row.status}: ${row.errorCode}` : `任务 ${row.status}`,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.completedAt?.toISOString() ?? null,
    durationMs: durationMs(row.startedAt, row.completedAt),
  };
}
