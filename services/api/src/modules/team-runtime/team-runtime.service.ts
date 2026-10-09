import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
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
import type { CurrentUser, PblPhase } from '@qitu/contracts';
import {
  PBL_ASSISTANT_BY_PHASE,
  PBL_AUTONOMOUS_ADVANCE_ALLOWED,
  PBL_GATE_BY_PHASE,
  PBL_GATE_ERROR_CODES,
  PBL_PHASE_ORDER,
  PBL_TEAM_ERROR_CODES,
  THUNDER_FIGHTER_PBL_SPEC,
  isPblPhase,
  nextPblPhase,
  pblGatesRequiredToEnter,
  pblPhaseIndex,
} from '@qitu/ai-client';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { OutboxWriter } from '../../common/outbox/outbox.service';

export type TeamRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TeamTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/* ==========================================================================
 * PBL 阶段门禁 —— 服务端强制层
 *
 * 阶段顺序与门禁条件的唯一真源是 `@qitu/ai-client` 的 `pbl-team.ts`
 * （`THUNDER_FIGHTER_TEAM_CONFIG` / `THUNDER_FIGHTER_PBL_SPEC`）。本节只从
 * 该真源派生判定，不在 prompt 或客户端里重复声明；所有拒绝都以 HTTP 409 +
 * 稳定错误码返回。门禁达成证据只能由服务端通过 `recordGateSatisfied`
 * 写入 `team.gate.satisfied` 事件，客户端没有任何直写路径。
 * ========================================================================== */

/** 服务端写入的门禁达成事件主题（唯一合法证据来源）。 */
export const PBL_GATE_SATISFIED_TOPIC = 'team.gate.satisfied';
/** 门禁拒绝事件主题（可观测 + 流式 `team.gate_blocked` 帧来源）。 */
export const PBL_GATE_BLOCKED_TOPIC = 'team.gate.blocked';
/** 阶段推进事件主题（流式 `team.phase_advanced` 帧来源）。 */
export const PBL_PHASE_ADVANCED_TOPIC = 'team.phase_advanced';
/** 团队工具调用事件主题（流式 `team.tool_invoked` 帧来源）。 */
export const TEAM_TOOL_INVOKED_TOPIC = 'team.tool.invoked';
/** 模型思考事件主题（流式 `team.thinking` 帧来源；只携带阶段标签，不携带原文）。 */
export const TEAM_MODEL_THINKING_TOPIC = 'team.model.thinking';

/** 学生会话流上可区分的团队帧类型（新增/改名必须同步 protocol 测试断言）。 */
export const TEAM_FRAME_NAMES = {
  phase_advanced: 'team.phase_advanced',
  gate_blocked: 'team.gate_blocked',
  member_delegated: 'team.member_delegated',
  tool_invoked: 'team.tool_invoked',
  thinking: 'team.thinking',
} as const;

export type TeamStreamKind = keyof typeof TEAM_FRAME_NAMES;

export interface TeamStreamFrame {
  kind: TeamStreamKind;
  frameId: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

const TEAM_TOPIC_FRAME_KIND: Record<string, TeamStreamKind> = {
  [PBL_PHASE_ADVANCED_TOPIC]: 'phase_advanced',
  [PBL_GATE_BLOCKED_TOPIC]: 'gate_blocked',
  [TEAM_TOOL_INVOKED_TOPIC]: 'tool_invoked',
  [TEAM_MODEL_THINKING_TOPIC]: 'thinking',
};

const KNOWN_PBL_GATES: ReadonlySet<string> = new Set(Object.values(PBL_GATE_BY_PHASE));
const GATE_TO_PHASE: Record<string, PblPhase> = Object.fromEntries(
  (Object.entries(PBL_GATE_BY_PHASE) as [PblPhase, string][]).map(([phase, gate]) => [gate, phase]),
);

/**
 * 未成年人数据最小化：帧载荷白名单裁剪。
 * 任何疑似原文对话的字段一律剥离；字符串截断到 120 字符。
 */
const RAW_TEXT_KEYS = new Set([
  'content',
  'text',
  'utterance',
  'raw',
  'transcript',
  'messages',
  'prompt',
  'response',
  'conversationSummary',
  'intent',
  'reply',
  'question',
  'answer',
]);
const MAX_FRAME_STRING_LENGTH = 120;

export function teamFrameName(kind: TeamStreamKind): string {
  return TEAM_FRAME_NAMES[kind];
}

/** 稳定的短幂等键（事件表幂等列上限 160 字符）：哈希拼接，不碰撞、不含原文。 */
function shortEventKey(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40);
  return normalizeKey(`${prefix}:${digest}`, 'team-event');
}

export function sanitizeTeamFramePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (RAW_TEXT_KEYS.has(key)) continue;
    if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
      out[key] = typeof value === 'string' && value.length > MAX_FRAME_STRING_LENGTH
        ? value.slice(0, MAX_FRAME_STRING_LENGTH)
        : value;
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      out[key] = (value as string[]).slice(0, 10);
    }
  }
  return out;
}

/** 组装一帧团队事件的载荷（帧名 + 脱敏字段），供 SSE 层直接使用。 */
export function buildTeamFrameData(kind: TeamStreamKind, data: Record<string, unknown>): Record<string, unknown> {
  return { frame: TEAM_FRAME_NAMES[kind], ...sanitizeTeamFramePayload(data) };
}

export type PblGateDecision =
  | { allowed: true }
  | { allowed: false; status: 409; errorCode: string; requiredGate: string; blockedPhase: PblPhase; message: string };

function gateBlock(gate: string): PblGateDecision & { allowed: false } {
  const phase = GATE_TO_PHASE[gate] ?? 'exploration';
  return {
    allowed: false,
    status: 409,
    errorCode: PBL_GATE_ERROR_CODES[phase as PblPhase],
    requiredGate: gate,
    blockedPhase: phase,
    message: `PBL 门禁未达成：需要先满足「${gate}」才能进入后续阶段`,
  };
}

/**
 * 进入 `targetPhase` 需要其之前所有阶段的门禁均已达成（累积判定）。
 * 例：进入 guided_practice 需要 `student_confirmed_intent` 且 `TheoryMastered`。
 * 返回第一个未达成的门禁对应的稳定错误码。
 */
export function evaluateGateEntry(targetPhase: PblPhase, satisfiedGates: ReadonlySet<string>): PblGateDecision {
  for (const gate of pblGatesRequiredToEnter(targetPhase)) {
    if (!satisfiedGates.has(gate)) return gateBlock(gate);
  }
  return { allowed: true };
}

export interface PhaseAdvanceRequest {
  currentPhase: PblPhase;
  targetPhase: PblPhase;
  /** 只允许 'manual'（人工/服务端触发）；'autonomous' 在冻结规格里被禁止。 */
  trigger: string;
  satisfiedGates: ReadonlySet<string>;
}

export type PhaseAdvanceDecision =
  | { allowed: true; phase: PblPhase }
  | { allowed: false; status: 409; errorCode: string; requiredGate: string | null; message: string };

/**
 * 纯函数：判断一次阶段推进是否被允许。顺序、自动推进与门禁全部由冻结规格
 * 派生；服务层把 `allowed:false` 原样映射为 HTTP 409 ConflictException。
 */
export function decidePhaseAdvance(input: PhaseAdvanceRequest): PhaseAdvanceDecision {
  if (input.trigger !== 'manual' && !PBL_AUTONOMOUS_ADVANCE_ALLOWED) {
    return {
      allowed: false,
      status: 409,
      errorCode: PBL_TEAM_ERROR_CODES.AUTONOMOUS_ADVANCE_FORBIDDEN,
      requiredGate: null,
      message: '冻结规格禁止自动推进越过门禁（allowAutonomousAdvance=false）',
    };
  }
  const expected = nextPblPhase(input.currentPhase);
  if (expected === null || input.targetPhase !== expected) {
    return {
      allowed: false,
      status: 409,
      errorCode: PBL_TEAM_ERROR_CODES.PHASE_ORDER_INVALID,
      requiredGate: null,
      message: `阶段只能按冻结顺序推进：${input.currentPhase} → ${expected ?? '（无后续阶段）'}`,
    };
  }
  const gate = evaluateGateEntry(input.targetPhase, input.satisfiedGates);
  if (!gate.allowed) {
    return { allowed: false, status: 409, errorCode: gate.errorCode, requiredGate: gate.requiredGate, message: gate.message };
  }
  return { allowed: true, phase: input.targetPhase };
}

export interface DelegatedPhaseEntryRequest {
  runPhase: PblPhase;
  pblPhase: PblPhase;
  satisfiedGates: ReadonlySet<string>;
}

/**
 * 纯函数：委派任务携带 `pblPhase` 时的服务端判定。门禁优先（未达成 → 对应
 * 409 门禁码），其次阶段一致性（不允许向未来阶段委派）。这样「未达成
 * TheoryMastered 时任何进入 guided_practice 的委派调用」都会被拒绝。
 */
export function decideDelegatedPhaseEntry(input: DelegatedPhaseEntryRequest): PhaseAdvanceDecision {
  const gate = evaluateGateEntry(input.pblPhase, input.satisfiedGates);
  if (!gate.allowed) {
    return { allowed: false, status: 409, errorCode: gate.errorCode, requiredGate: gate.requiredGate, message: gate.message };
  }
  if (pblPhaseIndex(input.pblPhase) !== pblPhaseIndex(input.runPhase)) {
    return {
      allowed: false,
      status: 409,
      errorCode: PBL_TEAM_ERROR_CODES.PHASE_MISMATCH,
      requiredGate: null,
      message: `委派阶段与当前项目阶段不一致：run=${input.runPhase}, request=${input.pblPhase}`,
    };
  }
  return { allowed: true, phase: input.pblPhase };
}

/**
 * 纯函数：正式项目创建守卫。学生意图未经服务端确认时，禁止创建正式项目
 * （AGENTS.md 硬约束）。由探索阶段的 `student_confirmed_intent` 门禁驱动。
 */
export function decideFormalProjectCreation(satisfiedGates: ReadonlySet<string>): PhaseAdvanceDecision {
  const gate = evaluateGateEntry('concept_mastery', satisfiedGates);
  if (!gate.allowed) {
    return { allowed: false, status: 409, errorCode: gate.errorCode, requiredGate: gate.requiredGate, message: '学生意图未经服务端确认，不得创建正式项目' };
  }
  return { allowed: true, phase: 'concept_mastery' };
}

export interface ActiveTeamRunRow {
  id: string;
  leaderAgentId: string;
  studentUserId: string | null;
  projectId: string | null;
  tutorSessionId: string | null;
  status: string;
}

export type MentorUniquenessDecision =
  | { kind: 'allow' }
  | { kind: 'replay'; runId: string }
  | { kind: 'conflict'; errorCode: string; status: 409; message: string };

/**
 * 纯函数：一个学生同一时间只能有一个当前班主任（leader agent）。活跃 run
 * （queued/running）上：同 leader 同会话同项目 → 幂等重放既有 run；不同
 * leader → 409 拒绝，绝不允许出现两个当前班主任。
 */
export function decideMentorUniqueness(
  activeRuns: readonly ActiveTeamRunRow[],
  requested: { leaderAgentId: string; tutorSessionId: string | null; projectId: string | null },
): MentorUniquenessDecision {
  for (const run of activeRuns) {
    if (run.leaderAgentId !== requested.leaderAgentId) {
      return {
        kind: 'conflict',
        status: 409,
        errorCode: PBL_TEAM_ERROR_CODES.MENTOR_UNIQUENESS_CONFLICT,
        message: `该学生已有当前班主任（agent ${run.leaderAgentId}，run ${run.id}），不能同时再指定另一个`,
      };
    }
  }
  const replay = activeRuns.find(
    (run) => run.leaderAgentId === requested.leaderAgentId
      && run.tutorSessionId === requested.tutorSessionId
      && run.projectId === requested.projectId,
  );
  if (replay !== undefined) return { kind: 'replay', runId: replay.id };
  return { kind: 'allow' };
}

/** run.context.phase 的服务端读取；缺省或非法值回退到冻结顺序的第一阶段。 */
export function readRunPhaseContext(context: Record<string, unknown> | null | undefined): PblPhase {
  const phase = context?.phase;
  return isPblPhase(phase) ? phase : PBL_PHASE_ORDER[0] as PblPhase;
}

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
  /** 可选：委派目标所属的 PBL 阶段；服务端按冻结门禁强制校验。 */
  pblPhase?: PblPhase;
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

    // 硬约束：一个学生同一时间只能有一个当前班主任。幂等键未命中时再查
    // 活跃 run：同 leader 同会话同项目 → 幂等重放；不同 leader → 409。
    if (studentUserId !== null) {
      const activeRuns = await db
        .select()
        .from(agentTeamRuns)
        .where(and(
          eq(agentTeamRuns.studentUserId, studentUserId),
          inArray(agentTeamRuns.status, ['queued', 'running']),
        ))
        .orderBy(asc(agentTeamRuns.createdAt));
      const decision = decideMentorUniqueness(
        activeRuns.map((run) => ({
          id: run.id,
          leaderAgentId: run.leaderAgentId,
          studentUserId: run.studentUserId,
          projectId: run.projectId,
          tutorSessionId: run.tutorSessionId,
          status: run.status,
        })),
        { leaderAgentId, tutorSessionId: input.tutorSessionId ?? null, projectId: input.projectId ?? null },
      );
      if (decision.kind === 'conflict') throw new ConflictException({ code: decision.errorCode, message: decision.message });
      if (decision.kind === 'replay') {
        const replayed = activeRuns.find((run) => run.id === decision.runId);
        if (replayed) {
          this.assertRunAccess(replayed, actor);
          return toRunView(replayed);
        }
      }
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
    // 服务端门禁：携带 pblPhase 的委派先过冻结门禁（例如未达成
    // TheoryMastered 时任何进入 guided_practice 的委派都会被 409 拒绝）。
    if (input.pblPhase !== undefined) {
      if (!isPblPhase(input.pblPhase)) throw new BadRequestException({ code: 'PBL_PHASE_INVALID', message: 'pblPhase 不在冻结阶段枚举内' });
      const satisfied = await this.loadSatisfiedGates(db, runId);
      const decision = decideDelegatedPhaseEntry({ runPhase: readRunPhaseContext(run.context), pblPhase: input.pblPhase, satisfiedGates: satisfied });
      if (!decision.allowed) {
        await this.recordEvent({
          runId,
          topic: PBL_GATE_BLOCKED_TOPIC,
          payload: { phase: input.pblPhase, requiredGate: decision.requiredGate, errorCode: decision.errorCode, context: 'delegate' },
          idempotencyKey: shortEventKey('gate-blocked:delegate', runId, input.pblPhase, input.idempotencyKey),
        });
        throw new ConflictException({ code: decision.errorCode, message: decision.message });
      }
    }
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

  /**
   * 服务端记录门禁达成证据（只允许由服务端域逻辑或管理员端点写入，
   * 学生/客户端没有任何直写路径）。证据以 `team.gate.satisfied` 事件落库，
   * 后续所有阶段判定从事件重放，重启/多实例语义一致。
   */
  async recordGateSatisfied(
    actor: CurrentUser,
    runId: string,
    input: { gate: string; evidenceRef?: string; source?: string },
    idempotencyKey: string,
  ): Promise<Record<string, unknown>> {
    const db = this.requireDb();
    const run = await this.getRunRow(runId);
    if (actor.role !== 'admin') throw new ConflictException({ code: 'TEAM_GATE_WRITE_FORBIDDEN', message: '门禁达成证据只能由服务端/管理员写入' });
    const gate = input.gate?.trim();
    if (!gate || !KNOWN_PBL_GATES.has(gate)) {
      throw new BadRequestException({ code: 'PBL_GATE_UNKNOWN', message: '门禁条件不在冻结规格枚举内', allowed: Array.from(KNOWN_PBL_GATES) });
    }
    const key = normalizeKey(idempotencyKey, 'team-gate');
    const phase = GATE_TO_PHASE[gate] as PblPhase;
    const eventId = await this.recordEvent({
      runId,
      taskId: null,
      topic: PBL_GATE_SATISFIED_TOPIC,
      payload: { gate, phase, evidenceRef: input.evidenceRef ?? `audit:${key}`, source: input.source ?? 'server' },
      idempotencyKey: key,
    });
    await this.audit.write({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'agent.team_gate.satisfied',
      targetType: 'agent_team_run',
      targetId: runId,
      idempotencyKey: key,
      detail: { gate, phase, evidenceRef: input.evidenceRef ?? null, studentUserId: run.studentUserId },
    });
    return { eventId, runId, gate, phase };
  }

  /** 读回当前阶段与服务端门禁状态（客户端只能读，不能写）。 */
  async getPhaseStatus(actor: CurrentUser, runId: string): Promise<Record<string, unknown>> {
    const db = this.requireDb();
    const run = await this.getRunRow(runId);
    this.assertRunAccess(run, actor);
    const phase = readRunPhaseContext(run.context);
    const satisfied = await this.loadSatisfiedGates(db, runId);
    const target = nextPblPhase(phase);
    const gateDecision = target === null ? null : evaluateGateEntry(target, satisfied);
    return {
      runId,
      specProjectId: THUNDER_FIGHTER_PBL_SPEC.projectId,
      phase,
      phaseOrder: PBL_PHASE_ORDER,
      nextPhase: target,
      currentGate: PBL_GATE_BY_PHASE[phase],
      requiredGateForNext: gateDecision && !gateDecision.allowed ? gateDecision.requiredGate : null,
      nextGateErrorCode: gateDecision && !gateDecision.allowed ? gateDecision.errorCode : null,
      satisfiedGates: Array.from(satisfied).sort(),
      allowAutonomousAdvance: PBL_AUTONOMOUS_ADVANCE_ALLOWED,
      theoryMasteredGate: THUNDER_FIGHTER_PBL_SPEC.theoryMasteredGate,
    };
  }

  /**
   * 阶段推进（服务端强制门禁）。拒绝时返回 409 + 稳定错误码并落
   * `team.gate.blocked` 事件；成功时只允许推进到冻结顺序的下一阶段。
   */
  async advancePhase(
    actor: CurrentUser,
    runId: string,
    input: { targetPhase: string; trigger?: string; idempotencyKey: string },
  ): Promise<Record<string, unknown>> {
    const db = this.requireDb();
    const run = await this.getRunRow(runId);
    this.assertRunAccess(run, actor);
    if (!isPblPhase(input.targetPhase)) {
      throw new BadRequestException({ code: 'PBL_PHASE_INVALID', message: 'targetPhase 不在冻结阶段枚举内' });
    }
    const key = normalizeKey(input.idempotencyKey, 'team-phase-advance');
    const currentPhase = readRunPhaseContext(run.context);
    const satisfied = await this.loadSatisfiedGates(db, runId);
    const decision = decidePhaseAdvance({
      currentPhase,
      targetPhase: input.targetPhase,
      trigger: input.trigger ?? 'manual',
      satisfiedGates: satisfied,
    });
    if (!decision.allowed) {
      await this.recordEvent({
        runId,
        topic: PBL_GATE_BLOCKED_TOPIC,
        payload: {
          previousPhase: currentPhase,
          attemptedPhase: input.targetPhase,
          requiredGate: decision.requiredGate,
          errorCode: decision.errorCode,
          trigger: input.trigger ?? 'manual',
        },
        idempotencyKey: shortEventKey('gate-blocked:advance', runId, key),
      });
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'agent.team_run.phase_blocked',
        targetType: 'agent_team_run',
        targetId: runId,
        idempotencyKey: shortEventKey('gate-blocked:advance', runId, key),
        detail: { previousPhase: currentPhase, attemptedPhase: input.targetPhase, errorCode: decision.errorCode },
      });
      throw new ConflictException({ code: decision.errorCode, message: decision.message });
    }
    const now = new Date();
    await db
      .update(agentTeamRuns)
      .set({
        context: { ...(run.context ?? {}), phase: decision.phase, phaseUpdatedAt: now.toISOString(), phaseUpdatedBy: actor.id },
        updatedAt: now,
      })
      .where(eq(agentTeamRuns.id, runId));
    await this.recordEvent({
      runId,
      topic: PBL_PHASE_ADVANCED_TOPIC,
      payload: {
        previousPhase: currentPhase,
        phase: decision.phase,
        passedGate: PBL_GATE_BY_PHASE[currentPhase],
        ownerAssistantId: this.thunderFighterAssistantForPhase(decision.phase),
      },
      idempotencyKey: shortEventKey('phase-advanced', runId, key),
    });
    await this.audit.write({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'agent.team_run.phase_advance',
      targetType: 'agent_team_run',
      targetId: runId,
      idempotencyKey: key,
      detail: { previousPhase: currentPhase, phase: decision.phase },
    });
    const [updated] = await db.select().from(agentTeamRuns).where(eq(agentTeamRuns.id, runId)).limit(1);
    if (!updated) throw new ServiceUnavailableException('Team Run 阶段更新未返回记录');
    return { run: toRunView(updated), phase: decision.phase, previousPhase: currentPhase };
  }

  /**
   * 把学生会话最近的团队事件/委派任务转换成可区分的流式帧。
   * 载荷全部经过 `sanitizeTeamFramePayload` 脱敏，不含未成年人原文。
   */
  async listSessionStreamFrames(
    actor: CurrentUser,
    tutorSessionId: string,
    options: { since?: Date } = {},
  ): Promise<TeamStreamFrame[]> {
    const db = this.requireDb();
    const [run] = await db
      .select()
      .from(agentTeamRuns)
      .where(and(eq(agentTeamRuns.tutorSessionId, tutorSessionId), sql`${agentTeamRuns.tutorSessionId} IS NOT NULL`))
      .orderBy(desc(agentTeamRuns.createdAt))
      .limit(1);
    if (!run) return [];
    this.assertRunAccess(run, actor);
    const since = options.since ?? null;
    const [events, tasks] = await Promise.all([
      db
        .select()
        .from(agentTeamEvents)
        .where(and(
          eq(agentTeamEvents.runId, run.id),
          inArray(agentTeamEvents.topic, Object.keys(TEAM_TOPIC_FRAME_KIND)),
          ...(since ? [gt(agentTeamEvents.occurredAt, since)] : []),
        ))
        .orderBy(asc(agentTeamEvents.createdAt)),
      db
        .select()
        .from(agentTeamTasks)
        .where(and(
          eq(agentTeamTasks.runId, run.id),
          sql`${agentTeamTasks.agentId} <> ${run.leaderAgentId}`,
          ...(since ? [gt(agentTeamTasks.createdAt, since)] : []),
        ))
        .orderBy(asc(agentTeamTasks.createdAt)),
    ]);
    const frames: TeamStreamFrame[] = [];
    for (const event of events) {
      const kind = TEAM_TOPIC_FRAME_KIND[event.topic];
      if (kind === undefined) continue;
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      frames.push({
        kind,
        frameId: event.id,
        occurredAt: event.occurredAt.toISOString(),
        data: buildTeamFrameData(kind, {
          runId: event.runId,
          taskId: event.taskId,
          ...payload,
        }),
      });
    }
    for (const task of tasks) {
      frames.push({
        kind: 'member_delegated',
        frameId: task.id,
        occurredAt: task.createdAt.toISOString(),
        data: buildTeamFrameData('member_delegated', {
          runId: task.runId,
          taskId: task.id,
          recipientAgentId: task.agentId,
          taskType: task.taskType,
          status: task.status,
          pblPhase: typeof task.input === 'object' && task.input !== null && isPblPhase((task.input as Record<string, unknown>).pblPhase)
            ? ((task.input as Record<string, unknown>).pblPhase as string)
            : null,
        }),
      });
    }
    frames.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    return frames.slice(0, 50);
  }

  /** 从 `team.gate.satisfied` 事件重放已达成门禁集合（服务端唯一证据源）。 */
  private async loadSatisfiedGates(db: Database, runId: string): Promise<Set<string>> {
    const rows = await db
      .select({ payload: agentTeamEvents.payload })
      .from(agentTeamEvents)
      .where(and(eq(agentTeamEvents.runId, runId), eq(agentTeamEvents.topic, PBL_GATE_SATISFIED_TOPIC)));
    const satisfied = new Set<string>();
    for (const row of rows) {
      const gate = (row.payload as Record<string, unknown> | null | undefined)?.gate;
      if (typeof gate === 'string' && KNOWN_PBL_GATES.has(gate)) satisfied.add(gate);
    }
    return satisfied;
  }

  private thunderFighterAssistantForPhase(phase: PblPhase): string {
    return PBL_ASSISTANT_BY_PHASE[phase] ?? PBL_ASSISTANT_BY_PHASE.exploration;
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
