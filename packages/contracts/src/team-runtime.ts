import type { ModelApi, ModelModality } from './models.js';
import type {
  TutorAgentCapability,
  TutorAgentScope,
  TutorAgentToolDescriptor,
} from './agent-runtime.js';

/**
 * Versioned contract for the server-side Team Runtime.
 *
 * The runtime is intentionally independent from HTTP and persistence. API and
 * worker modules can use these types for PostgreSQL rows, queue envelopes and
 * browser-safe projections without exposing prompts or credentials.
 */
export const TEAM_RUNTIME_VERSION = 'qitu.team-runtime.v1' as const;

export type TeamAgentId = string;
export type TeamRunId = string;
export type TeamTaskId = string;
export type TeamMessageId = string;
export type TeamEventId = string;

export type AgentCapability =
  | TutorAgentCapability
  | 'orchestrate'
  | 'interest'
  | 'recommend'
  | 'profile'
  | 'growth'
  | 'delegate'
  | (string & {});

export type AgentConstraintEnforcement = 'prompt' | 'server' | 'domain';
export type AgentConstraintSeverity = 'must' | 'must_not' | 'should';

export interface AgentConstraint {
  id: string;
  text: string;
  severity: AgentConstraintSeverity;
  enforcement: AgentConstraintEnforcement;
}

export type AgentDataAccess = 'read' | 'candidate_write' | 'domain_command';
export type AgentDataSensitivity = 'public' | 'student_private' | 'staff_only' | 'restricted';

/** A bounded projection or domain command exposed to an Agent. */
export interface AgentDataScope {
  resource: string;
  access: AgentDataAccess;
  sensitivity: AgentDataSensitivity;
  fields?: readonly string[];
}

export interface AgentGlobalPolicyRef {
  /** The single repository/server AGENTS.md policy. */
  id: string;
  version: string;
  contentHash: string | null;
}

export interface AgentModelSelection {
  providerId: string | null;
  modelId: string | null;
  /** Resolved display-only values; never contain credentials or provider URLs. */
  providerLabel?: string | null;
  modelLabel?: string | null;
}

export type AgentRouteKind = 'delegate' | 'event' | 'schedule';
export type AgentRouteDirection = 'inbound' | 'outbound';

export interface AgentRouteBinding {
  id: string;
  kind: AgentRouteKind;
  direction: AgentRouteDirection;
  messageType: string;
  /** Agent ids are server-resolved; `*` is not a valid recipient. */
  agentId: TeamAgentId;
  eventType?: string;
  enabled: boolean;
  condition?: string | null;
}

/** JSON Schema subset used for typed delegation. It is data, not executable code. */
export type AgentJsonSchema = {
  type?: string;
  title?: string;
  description?: string;
  required?: readonly string[];
  properties?: Readonly<Record<string, AgentJsonSchema>>;
  items?: AgentJsonSchema;
  enum?: readonly unknown[];
  additionalProperties?: boolean | AgentJsonSchema;
  [key: string]: unknown;
};

/**
 * Administrator-owned Agent definition. `mission` describes why the Agent
 * exists; constraints, scopes and routes describe what it may do. There is no
 * per-child AGENTS.md requirement: all Agents inherit `globalPolicy`.
 */
export interface AgentConfig {
  id: TeamAgentId;
  version: string;
  label: string;
  enabled: boolean;
  parentAgentId: TeamAgentId | null;
  isLeader: boolean;
  mission: string;
  /** Compatibility alias for existing `roleDefinition` records. */
  roleDefinition?: string;
  constraints: readonly AgentConstraint[];
  capabilities: readonly AgentCapability[];
  dataScopes: readonly AgentDataScope[];
  skillIds: readonly string[];
  toolIds: readonly string[];
  routes: readonly AgentRouteBinding[];
  inputSchema: AgentJsonSchema;
  outputSchema: AgentJsonSchema;
  model: AgentModelSelection;
  globalPolicy: AgentGlobalPolicyRef;
  /** Compatibility-only; local child AGENTS.md is not required. */
  agentDefinition?: string;
}

export interface AgentContract extends AgentConfig {
  contractVersion: typeof TEAM_RUNTIME_VERSION;
  modelAvailable: boolean;
  effectiveTools: readonly TutorAgentToolDescriptor[];
  resolvedAt: string;
}

export type TeamRunStatus =
  | 'created'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'succeeded'
  /** Compatibility alias used by the current persistence/API projection. */
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type TeamTaskStatus =
  | 'created'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'retry_waiting'
  | 'cancelled'
  | 'timed_out';

export type TeamMessageStatus =
  | 'queued'
  | 'delivered'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'dead_letter';

export type TeamTaskKind =
  /** Canonical route names used by the current server seed/migration. */
  | 'interest.confirm'
  | 'project.recommend'
  | 'profile.project'
  | 'growth.project'
  /** Descriptive aliases retained for SDK callers. */
  | 'interest.confirmation'
  | 'project.recommendation'
  | 'pbl.plan'
  | 'pbl.advance'
  | 'project.review'
  | 'profile.generate'
  | 'growth.record';

export interface TeamRun {
  contractVersion: typeof TEAM_RUNTIME_VERSION;
  id: TeamRunId;
  leaderAgentId: TeamAgentId;
  scope: TutorAgentScope;
  status: TeamRunStatus;
  idempotencyKey: string;
  rootTaskId: TeamTaskId | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  failureCode: string | null;
}

export interface TeamTask<TInput = unknown, TOutput = unknown> {
  contractVersion: typeof TEAM_RUNTIME_VERSION;
  id: TeamTaskId;
  runId: TeamRunId;
  parentTaskId: TeamTaskId | null;
  kind: TeamTaskKind | string;
  requesterAgentId: TeamAgentId;
  assigneeAgentId: TeamAgentId;
  status: TeamTaskStatus;
  input: TInput;
  output: TOutput | null;
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  failureCode: string | null;
}

export type TeamMessageType =
  /** Durable work requests consumed by the server mailbox worker. */
  | 'task.request'
  | 'projection.request'
  | 'delegate.request'
  | 'delegate.result'
  | 'projection.result'
  | 'agent.event'
  | 'leader.reply'
  | 'system.error';

export interface TeamMessage<TPayload = unknown> {
  contractVersion: typeof TEAM_RUNTIME_VERSION;
  id: TeamMessageId;
  runId: TeamRunId;
  taskId: TeamTaskId | null;
  senderAgentId: TeamAgentId;
  recipientAgentId: TeamAgentId;
  messageType: TeamMessageType;
  payload: TPayload;
  schemaVersion: string;
  correlationId: string;
  causationId: string | null;
  idempotencyKey: string;
  status: TeamMessageStatus;
  attempts: number;
  createdAt: string;
  deliveredAt: string | null;
  completedAt: string | null;
  failureCode: string | null;
}

export type TeamEventType =
  | 'team.run.created'
  | 'team.task.created'
  | 'team.task.started'
  | 'team.task.completed'
  | 'team.task.failed'
  | 'team.message.sent'
  | 'team.message.received'
  | 'team.message.failed'
  | 'tutor.turn.completed'
  | 'interest.confirmed'
  | 'project.recommended'
  | 'project.stage.completed'
  | 'artifact.published'
  | 'reflection.created'
  | 'profile.projection.created'
  | 'growth.projection.created'
  | (string & {});

export interface TeamEvent<TPayload = unknown> {
  contractVersion: typeof TEAM_RUNTIME_VERSION;
  id: TeamEventId;
  runId: TeamRunId | null;
  taskId: TeamTaskId | null;
  type: TeamEventType;
  sequence: number;
  actorAgentId: TeamAgentId | null;
  payload: TPayload;
  occurredAt: string;
  idempotencyKey: string;
}

/** Browser/API projection emitted by the current TeamRuntime controller. */
export interface TeamRunApiProjection {
  id: TeamRunId;
  leaderAgentId: TeamAgentId;
  studentUserId: string | null;
  projectId: string | null;
  tutorSessionId: string | null;
  trigger: string;
  status: TeamRunStatus;
  context: Record<string, unknown>;
  createdBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamTaskApiProjection {
  id: TeamTaskId;
  runId: TeamRunId;
  parentTaskId: TeamTaskId | null;
  agentId: TeamAgentId;
  taskType: TeamTaskKind | string;
  status: TeamTaskStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorCode: string | null;
  attempts: number;
  maxAttempts: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface TeamMessageApiProjection {
  id: TeamMessageId;
  runId: TeamRunId;
  taskId: TeamTaskId | null;
  mailboxAgentId: TeamAgentId;
  senderAgentId: TeamAgentId;
  recipientAgentId: TeamAgentId;
  messageType: string;
  payload: Record<string, unknown>;
  status: TeamMessageStatus;
  correlationId: string | null;
  causationId: string | null;
  attempts: number;
  availableAt: string;
  deliveredAt: string | null;
  createdAt: string;
}

export interface TeamEventApiProjection {
  id: TeamEventId;
  runId: TeamRunId | null;
  taskId: TeamTaskId | null;
  topic: string;
  sequence: number;
  payload: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export interface TeamRunGraphProjection {
  run: TeamRunApiProjection;
  tasks: readonly TeamTaskApiProjection[];
  messages: readonly TeamMessageApiProjection[];
  events: readonly TeamEventApiProjection[];
}

export interface AgentGraphApiNode {
  id: TeamAgentId;
  label: string;
  role: string | null;
  roleDefinition: string;
  parentAgentId: TeamAgentId | null;
  enabled: boolean;
  modelProviderId: string | null;
  modelId: string | null;
  capabilities: readonly string[];
  configVersion: number;
}

export interface AgentGraphApiEdge {
  id: string;
  source: TeamAgentId;
  target: TeamAgentId;
  trigger: string;
  taskType: TeamTaskKind | string;
  enabled: boolean;
}

export interface StaticAgentGraphApiProjection {
  generatedAt: string;
  nodes: readonly AgentGraphApiNode[];
  edges: readonly AgentGraphApiEdge[];
}

export interface InterestConfirmationInput {
  studentId: string;
  sessionId: string | null;
  /**
   * Server-approved bounded marker only. Raw student or assistant turns must
   * never be persisted in Team Runtime payloads; evidenceRefs identify the
   * authorized server-side evidence boundary.
   */
  conversationSummary: string;
  turnCount?: number;
  projectStage?: string | null;
  pedagogicMove?: string | null;
  evidenceRefs: readonly string[];
}

export interface InterestConfirmationOutput {
  confirmed: boolean;
  confidence: 'low' | 'medium' | 'high';
  interests: readonly string[];
  followUpQuestions: readonly string[];
  evidenceRefs: readonly string[];
}

export interface ProjectRecommendationInput {
  studentId: string;
  interests: readonly string[];
  learnerProfile: unknown | null;
  availableTemplateIds: readonly string[];
}

export interface ProjectRecommendationOutput {
  recommendations: readonly {
    templateId: string;
    title: string;
    rationale: string;
    fit: 'low' | 'medium' | 'high';
  }[];
  questions: readonly string[];
}

export interface PblPlanInput {
  studentId: string;
  projectId: string | null;
  intent: string;
  currentStage: string | null;
  evidenceRefs: readonly string[];
}

export interface PblPlanOutput {
  goal: string;
  stages: readonly {
    id: string;
    title: string;
    objective: string;
    taskIds: readonly string[];
  }[];
  requiresStudentConfirmation: boolean;
}

export interface PblAdvanceInput {
  studentId: string;
  projectId: string;
  currentStage: string;
  evidenceRefs: readonly string[];
}

export interface PblAdvanceOutput {
  proposedStage: string;
  reason: string;
  evidenceRefs: readonly string[];
}

export interface ProjectReviewInput {
  studentId: string;
  projectId: string;
  artifactRefs: readonly string[];
  rubricId: string | null;
}

export interface ProjectReviewOutput {
  summary: string;
  strengths: readonly string[];
  nextSteps: readonly string[];
  evidenceRefs: readonly string[];
  confidence: 'low' | 'medium' | 'high';
}

export interface ProfileGenerateInput {
  studentId: string;
  evidenceRefs: readonly string[];
  existingVersion: number | null;
}

export interface ProfileGenerateOutput {
  version: number;
  interests: readonly string[];
  strengths: readonly string[];
  preferences: readonly string[];
  summary: string;
  evidenceRefs: readonly string[];
}

export interface GrowthRecordInput {
  studentId: string;
  period: { from: string; to: string };
  evidenceRefs: readonly string[];
  existingVersion: number | null;
}

export interface GrowthRecordOutput {
  version: number;
  milestones: readonly string[];
  strengths: readonly string[];
  nextQuestions: readonly string[];
  studentSummary: string;
  evidenceRefs: readonly string[];
  confidence: 'low' | 'medium' | 'high';
}

export interface AgentTaskInputMap {
  'interest.confirm': InterestConfirmationInput;
  'project.recommend': ProjectRecommendationInput;
  'profile.project': ProfileGenerateInput;
  'growth.project': GrowthRecordInput;
  'interest.confirmation': InterestConfirmationInput;
  'project.recommendation': ProjectRecommendationInput;
  'pbl.plan': PblPlanInput;
  'pbl.advance': PblAdvanceInput;
  'project.review': ProjectReviewInput;
  'profile.generate': ProfileGenerateInput;
  'growth.record': GrowthRecordInput;
}

export interface AgentTaskOutputMap {
  'interest.confirm': InterestConfirmationOutput;
  'project.recommend': ProjectRecommendationOutput;
  'profile.project': ProfileGenerateOutput;
  'growth.project': GrowthRecordOutput;
  'interest.confirmation': InterestConfirmationOutput;
  'project.recommendation': ProjectRecommendationOutput;
  'pbl.plan': PblPlanOutput;
  'pbl.advance': PblAdvanceOutput;
  'project.review': ProjectReviewOutput;
  'profile.generate': ProfileGenerateOutput;
  'growth.record': GrowthRecordOutput;
}

export type TypedAgentTaskKind = keyof AgentTaskInputMap;

export interface AgentDelegateRequest<K extends TypedAgentTaskKind = TypedAgentTaskKind> {
  contractVersion: typeof TEAM_RUNTIME_VERSION;
  messageType: 'delegate.request';
  runId: TeamRunId;
  taskId: TeamTaskId;
  senderAgentId: TeamAgentId;
  recipientAgentId: TeamAgentId;
  taskKind: K;
  input: AgentTaskInputMap[K];
  correlationId: string;
  causationId: string | null;
  idempotencyKey: string;
}

export interface AgentDelegateResult<K extends TypedAgentTaskKind = TypedAgentTaskKind> {
  contractVersion: typeof TEAM_RUNTIME_VERSION;
  messageType: 'delegate.result';
  runId: TeamRunId;
  taskId: TeamTaskId;
  senderAgentId: TeamAgentId;
  recipientAgentId: TeamAgentId;
  taskKind: K;
  status: 'succeeded' | 'failed';
  output: AgentTaskOutputMap[K] | null;
  errorCode: string | null;
  correlationId: string;
  causationId: string | null;
}

export type AgentGraphNodeStatus = 'enabled' | 'disabled' | 'unavailable' | 'error' | 'unknown';
export type AgentGraphEdgeKind = 'delegate' | 'event' | 'schedule';

export interface AgentGraphNode {
  agentId: TeamAgentId;
  label: string;
  parentAgentId: TeamAgentId | null;
  isLeader: boolean;
  enabled: boolean;
  status: AgentGraphNodeStatus;
  capabilities: readonly AgentCapability[];
  model: AgentModelSelection;
  lastRunAt: string | null;
}

export interface AgentGraphEdge {
  edgeId: string;
  fromAgentId: TeamAgentId;
  toAgentId: TeamAgentId;
  kind: AgentGraphEdgeKind;
  messageType: string;
  eventType: string | null;
  enabled: boolean;
  invocationCount: number | null;
  lastInvokedAt: string | null;
  lastErrorCode: string | null;
}

export interface StaticAgentGraph {
  contractVersion: typeof TEAM_RUNTIME_VERSION;
  generatedAt: string;
  leaderAgentId: TeamAgentId;
  nodes: readonly AgentGraphNode[];
  edges: readonly AgentGraphEdge[];
}

export type AgentExecutionStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'retry_waiting'
  | 'cancelled';

export interface DynamicAgentExecution {
  executionId: string;
  taskId: TeamTaskId;
  agentId: TeamAgentId;
  parentExecutionId: string | null;
  kind: TeamTaskKind | string;
  status: AgentExecutionStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  model: AgentModelSelection;
  inputSummary: string | null;
  outputSummary: string | null;
  errorCode: string | null;
}

export interface DynamicAgentExecutionEdge {
  messageId: TeamMessageId;
  fromExecutionId: string;
  toExecutionId: string;
  messageType: TeamMessageType;
  status: TeamMessageStatus;
  createdAt: string;
}

export interface DynamicAgentGraph {
  contractVersion: typeof TEAM_RUNTIME_VERSION;
  generatedAt: string;
  run: Pick<TeamRun, 'id' | 'leaderAgentId' | 'status' | 'createdAt' | 'startedAt' | 'finishedAt'>;
  executions: readonly DynamicAgentExecution[];
  edges: readonly DynamicAgentExecutionEdge[];
}

export interface AgentGraphSnapshot {
  static: StaticAgentGraph;
  dynamic?: DynamicAgentGraph;
}

/** Model capability metadata shared by provider import and voice selection. */
export interface AgentModelCapabilitySummary {
  input: readonly ModelModality[];
  output: readonly ModelModality[];
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsReasoning: boolean;
  supportsVoice: boolean;
  api: ModelApi;
}

/* ========================================================================== */
/*  AionUi Migration: Assistant & Team Domain Contracts                       */
/*  Multica Reference: Workspace Team & Agent Settings                        */
/*  OpenMAIC Reference: Multi-Agent PBL Learning Contracts                    */
/* ========================================================================== */

export type AssistantSource = 'builtin' | 'generated' | 'user';
export type AssistantAgentStatus = 'missing' | 'online' | 'offline' | 'unchecked';

export interface AssistantDefaultScalar {
  mode: string;
  value?: string;
}

export interface AssistantDefaultList {
  mode: string;
  value: readonly string[];
}

export interface AssistantDefaults {
  model: AssistantDefaultScalar;
  permission: AssistantDefaultScalar;
  thought_level: AssistantDefaultScalar;
  skills: AssistantDefaultList;
  mcps: AssistantDefaultList;
}

export interface AssistantRules {
  content: string;
  storage_mode: string;
}

/**
 * Assistant definition migrated from AionUi backend, integrated into Qitu SDK.
 */
export interface AdminAssistantConfig {
  id: string;
  source: AssistantSource;
  name: string;
  avatar?: string;
  description: string;
  role: string;
  enabled: boolean;
  sortOrder: number;
  modelProviderId: string | null;
  modelId: string | null;
  temperature?: number;
  instructions: string;
  enabledSkills: readonly string[];
  toolIds: readonly string[];
  mcpServerIds: readonly string[];
  defaults: AssistantDefaults;
  agentStatus: AssistantAgentStatus;
  agentStatusMessage?: string;
  teamSelectable: boolean;
  deletable: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Workspace sharing strategy for the team (AionUi & Multica) */
export type WorkspaceMode = 'shared' | 'isolated';

/** Session permission execution mode */
export type TeamSessionMode = 'auto' | 'plan' | 'supervised';

/** Teammate role within a collaborative team */
export type TeammateRole = 'leader' | 'teammate' | 'reviewer' | 'coach';

export type TeammateStatus = 'pending' | 'idle' | 'active' | 'completed' | 'failed' | 'dormant';

/**
 * Persisted assistant assignment within a Team.
 */
export interface AdminTeamMember {
  slotId: string;
  assistantId: string;
  assistantName: string;
  role: TeammateRole;
  roleLabel: string;
  avatar?: string;
  status: TeammateStatus;
  model?: string;
  color?: string;
  pblPhase?: PblPhase;
}

/**
 * PBL (Project-Based Learning) Phases inspired by OpenMAIC & Qitu pedagogical rules.
 */
export type PblPhase =
  | 'exploration'          // 兴趣启发与意图确认 (Intent confirmation)
  | 'concept_mastery'     // 核心概念与规律探索 (Theory & Knowledge, OpenMAIC classroom)
  | 'guided_practice'     // 任务拆解与分步构建 (Implementation, TheoryMastered gated)
  | 'deliverable_review';  // 成果评审与成长归档 (Review, Self-assessment, Archival)

/**
 * Phase specification in a PBL workflow.
 */
export interface PblPhaseSpec {
  phase: PblPhase;
  title: string;
  assignedAssistantId: string;
  assignedRoleLabel: string;
  learningObjectives: readonly string[];
  gateCondition: string;
  deliverableType?: string;
}

/**
 * PBL Team Workflow Specification.
 */
export interface PblTeamWorkflowSpec {
  projectId: string;
  projectName: string;
  targetDomain: string;
  phases: readonly PblPhaseSpec[];
  theoryMasteredGate: boolean;
  allowAutonomousAdvance: boolean;
}

/**
 * Team Configuration migrated from AionUi & structured referencing Multica.
 */
export interface AdminTeamConfig {
  id: string;
  name: string;
  description: string;
  workspaceMode: WorkspaceMode;
  sessionMode: TeamSessionMode;
  leaderAssistantId: string;
  members: readonly AdminTeamMember[];
  concurrencyLimit: number;
  pblSpec?: PblTeamWorkflowSpec;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ========================================================================== */
/*  Admin 助手 / 团队 CRUD —— 写入侧 DTO（T1 冻结契约）                        */
/*                                                                            */
/*  对应接口（响应信封统一 `{ data: ... }`）：                                  */
/*    GET   /api/v1/admin/ai-runtime/assistants                               */
/*    POST  /api/v1/admin/ai-runtime/assistants                               */
/*    PATCH /api/v1/admin/ai-runtime/assistants/:id                            */
/*    GET   /api/v1/admin/ai-runtime/teams                                     */
/*    POST  /api/v1/admin/ai-runtime/teams                                     */
/*    PATCH /api/v1/admin/ai-runtime/teams/:id                                 */
/*                                                                            */
/*  冻结规则：                                                                 */
/*  1. 写入 DTO 不含 `id` / `createdAt` / `updatedAt`：全部由服务端生成。       */
/*  2. 幂等键只走 HTTP 头 `Idempotency-Key`，**不放进 body**（与               */
/*     `services/api/src/modules/team-runtime/team-runtime.controller.ts` 一致）。*/
/*  3. 运行态与服务端派生字段不可由客户端写入：`source`、`deletable`、           */
/*     `agentStatus` / `agentStatusMessage`、成员的 `assistantName` / `avatar` /  */
/*     `status`。                                                               */
/*  4. PBL 门禁只可被**加强**、不可被削弱：写入形状的 `theoryMasteredGate` 恒为  */
/*     字面量 `true`，`allowAutonomousAdvance` 只允许 `false` 或省略。          */
/*  5. 这些类型是纯类型（除下方常量外无运行时产物），T2 服务端解析、T3 种子、     */
/*     T4 前端调用必须逐字照抄名称与字段。                                       */
/* ========================================================================== */

/** 写操作幂等头名称。 */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key' as const;

/**
 * 幂等作用域（服务端 `IdempotencyStore.execute(scope, key, hash, fn)` 使用）。
 * 更新类作用域必须拼上资源 id：`${ADMIN_AI_RUNTIME_IDEMPOTENCY_SCOPES.teamUpdate}:${id}`。
 */
export const ADMIN_AI_RUNTIME_IDEMPOTENCY_SCOPES = {
  assistantCreate: 'admin.ai-runtime.assistant.create',
  assistantUpdate: 'admin.ai-runtime.assistant.update',
  teamCreate: 'admin.ai-runtime.team.create',
  teamUpdate: 'admin.ai-runtime.team.update',
} as const;

/** PBL 阶段门禁条件（与 `@qitu/ai-client` 的雷霆战机种子逐字一致）。 */
export type PblGateCondition =
  | 'student_confirmed_intent'
  | 'TheoryMastered'
  | 'code_playable_run_verified'
  | 'review_completed_and_archived';

/**
 * 创建助手。**必填**：`name`、`description`、`role`、`instructions`。
 * 服务端补全：`id`（生成）、`source: 'user'`、`deletable: true`、
 * `agentStatus: 'unchecked'`、`createdAt` / `updatedAt`。
 */
export interface AdminAssistantCreateInput {
  /** 展示名；服务端裁剪空白后要求 1–40 字符。 */
  name: string;
  /** 一句话职责说明。 */
  description: string;
  /** 职责标签，例如 `Concept Coach / 概念教练`。 */
  role: string;
  /** 教师指令（提示词正文）。客户端不得写入项目状态或审计字段。 */
  instructions: string;
  avatar?: string;
  modelProviderId?: string | null;
  modelId?: string | null;
  /** 采样温度；服务端要求 0–2。 */
  temperature?: number;
  enabledSkills?: readonly string[];
  toolIds?: readonly string[];
  mcpServerIds?: readonly string[];
  /** 只允许覆盖已知默认项；缺省字段由服务端 `AssistantDefaults` 兜底。 */
  defaults?: Partial<AssistantDefaults>;
  /** 默认为 `true`；`false` 时不出现在团队可选助手列表。 */
  teamSelectable?: boolean;
  /** 默认追加到列表末尾。 */
  sortOrder?: number;
  /** 默认为 `true`。 */
  enabled?: boolean;
}

/**
 * 更新助手（PATCH）。**字段全部可选**，但至少需要 1 个字段，空补丁必须被服务端拒绝。
 * `id` / `source` / `deletable` / `agentStatus` 不可写；内置助手（`source: 'builtin'`）
 * 只允许改展示与模型相关字段，`instructions` 的改写需要服务端审计记录。
 */
export interface AdminAssistantUpdateInput {
  name?: string;
  description?: string;
  role?: string;
  instructions?: string;
  avatar?: string;
  modelProviderId?: string | null;
  modelId?: string | null;
  temperature?: number;
  enabledSkills?: readonly string[];
  toolIds?: readonly string[];
  mcpServerIds?: readonly string[];
  defaults?: Partial<AssistantDefaults>;
  teamSelectable?: boolean;
  sortOrder?: number;
  enabled?: boolean;
}

/**
 * 团队成员的写入形状。
 * `assistantName` / `avatar` 由服务端按 `assistantId` 解析后回填；
 * `status`（idle / active / …）属于运行态，**不在写侧暴露**。
 */
export interface AdminTeamMemberInput {
  /** 省略时由服务端生成稳定 slotId；PATCH 建议回填既有 slotId 以保持引用不变。 */
  slotId?: string;
  assistantId: string;
  role: TeammateRole;
  /** 缺省时取该助手配置的 `role`。 */
  roleLabel?: string;
  /** 缺省时取解析出的模型 id。 */
  model?: string;
  color?: string;
  pblPhase?: PblPhase;
}

/**
 * PBL 工作流写入形状。与 `PblTeamWorkflowSpec` 的差异是刻意的：
 * `theoryMasteredGate` 固定为字面量 `true`，客户端无法关闭「实践前必须
 * TheoryMastered」这条硬门禁；`allowAutonomousAdvance` 只接受 `false`。
 */
export interface AdminTeamPblSpecInput {
  projectId: string;
  projectName: string;
  targetDomain: string;
  phases: readonly AdminTeamPblPhaseInput[];
  /** 硬门禁：恒为 `true`。服务端必须拒绝任何将其写成 `false` 的载荷。 */
  theoryMasteredGate: true;
  /** 预留字段：当前管理端不允许开启自动推进。 */
  allowAutonomousAdvance?: false;
}

/** PBL 单阶段写入形状。 */
export interface AdminTeamPblPhaseInput {
  phase: PblPhase;
  title: string;
  assignedAssistantId: string;
  assignedRoleLabel?: string;
  learningObjectives?: readonly string[];
  /**
   * 缺省时服务端按阶段补默认门禁：
   * exploration→`student_confirmed_intent`、concept_mastery→`TheoryMastered`、
   * guided_practice→`code_playable_run_verified`、deliverable_review→`review_completed_and_archived`。
   * `concept_mastery` 阶段的门禁**必须**是 `TheoryMastered`，服务端强校验。
   */
  gateCondition?: PblGateCondition;
  deliverableType?: string;
}

/**
 * 创建团队。**必填**：`name`、`description`、`leaderAssistantId`、`members`。
 * 服务端补全：`id`、`createdAt` / `updatedAt`、成员的派生字段。
 * 服务端校验：`members.length >= 1`、`leaderAssistantId` 必须命中某个成员、
 * 每个 `assistantId` 必须存在且 `teamSelectable` 且 `enabled`、`concurrencyLimit` 在 1–8。
 */
export interface AdminTeamCreateInput {
  name: string;
  description: string;
  leaderAssistantId: string;
  members: readonly AdminTeamMemberInput[];
  /** 默认 `'shared'`。 */
  workspaceMode?: WorkspaceMode;
  /** 默认 `'supervised'`。 */
  sessionMode?: TeamSessionMode;
  /** 默认 `1`；服务端上限校验。 */
  concurrencyLimit?: number;
  pblSpec?: AdminTeamPblSpecInput;
  /** 默认 `true`。 */
  enabled?: boolean;
}

/**
 * 更新团队（PATCH）。**字段全部可选**，但至少需要 1 个字段。
 * `members` 为整体替换语义（不是增量 diff）；`id` / `createdAt` 不可写。
 */
export interface AdminTeamUpdateInput {
  name?: string;
  description?: string;
  leaderAssistantId?: string;
  members?: readonly AdminTeamMemberInput[];
  workspaceMode?: WorkspaceMode;
  sessionMode?: TeamSessionMode;
  concurrencyLimit?: number;
  pblSpec?: AdminTeamPblSpecInput;
  enabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  读取侧响应信封（与 apps/admin-console/lib/api/types.ts 的 DataEnvelope 对齐）*/
/* -------------------------------------------------------------------------- */

/** `GET /api/v1/admin/ai-runtime/assistants` */
export interface AdminAssistantListResponse {
  data: AdminAssistantConfig[];
}

/** `POST /api/v1/admin/ai-runtime/assistants`、`PATCH /api/v1/admin/ai-runtime/assistants/:id` */
export interface AdminAssistantResponse {
  data: AdminAssistantConfig;
}

/** `GET /api/v1/admin/ai-runtime/teams` */
export interface AdminTeamListResponse {
  data: AdminTeamConfig[];
}

/** `POST /api/v1/admin/ai-runtime/teams`、`PATCH /api/v1/admin/ai-runtime/teams/:id` */
export interface AdminTeamResponse {
  data: AdminTeamConfig;
}

