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
/*  Qitu Reference: Multi-Agent PBL Learning Contracts                        */
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
 * PBL (Project-Based Learning) Phases inspired by Qitu pedagogical rules.
 */
export type PblPhase =
  | 'exploration'          // 兴趣启发与意图确认 (Intent confirmation)
  | 'concept_mastery'     // 核心概念与规律探索 (Theory & Knowledge, Qitu classroom)
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
  /** 门禁条件 id（写侧受 `assertGateConditionId` 运行时校验）。 */
  gateCondition: string;
  /** 该阶段产出的交付物类型；guided_practice 的门禁由它推导。 */
  deliverableType?: string;
  /** 证据档案：把交付物归到可运行代码 / 实验报告两类之一。 */
  evidenceProfile?: EvidenceProfile;
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
  iconAssetId?: string | null;
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
  assistantDelete: 'admin.ai-runtime.assistant.delete',
  teamCreate: 'admin.ai-runtime.team.create',
  teamUpdate: 'admin.ai-runtime.team.update',
  teamDelete: 'admin.ai-runtime.team.delete',
} as const;

/* -------------------------------------------------------------------------- */
/*  PBL 门禁条件注册表（唯一真源）                                             */
/*                                                                            */
/*  这里同时是「门禁 id 命名空间」和「谁可以写这个门禁」的唯一声明处。           */
/*  之前有**三处**重复的四值联合：本文件、                                   */
/*  `admin-ai-config.validation.ts` 的 GATE_CONDITIONS、以及                  */
/*  `pbl-learning.ts` 里 PblTemplatePhase.gateCondition 的内联联合。          */
/*  三份都收敛到本文件的 GATE_CONDITION_CORE + GATE_CONDITION_REGISTRY。        */
/* -------------------------------------------------------------------------- */

/**
 * 冻结的四个核心门禁字面量（`as const` 元组）。
 * 这是**唯一**一份四值清单；其余任何地方的清单都必须由它派生。
 * 顺序与 PBL 阶段顺序一致：exploration → concept_mastery → guided_practice → deliverable_review。
 */
export const GATE_CONDITION_CORE = [
  'student_confirmed_intent',
  'TheoryMastered',
  'code_playable_run_verified',
  'review_completed_and_archived',
] as const;

/** 冻结核心门禁的联合类型（四个字面量）。 */
export type GateConditionCore = (typeof GATE_CONDITION_CORE)[number];

/**
 * 可被注册的门禁 id。
 *
 * 刻意**放宽**为 `(string & {})`：新模板必须能注册自己的门禁 id，而不需要
 * 改这里硬编码的联合。
 *
 * 代价（必须成对处理）：放宽之后 TypeScript 不再对这个联合做穷尽检查，
 * 任何 `switch`/`Record` 都会静默漏掉新成员。因此**所有写侧**必须走本文件
 * 的 `assertGateConditionId` / `isGateConditionId` 运行时校验，禁止把未校验
 * 的字符串直接落库。校验入口与类型放宽在同一次改动内落地。
 */
export type GateConditionId = GateConditionCore | (string & {});

/**
 * @deprecated 用 `GateConditionId`。保留别名只为不改动既有 import 点。
 */
export type PblGateCondition = GateConditionId;

/**
 * 证据类型（门禁要求提交哪一类证据）。
 * 与 `pbl-learning.ts` 的 `PblEvidenceType` 取值对齐，但此处用宽字符串以免
 * `team-runtime.ts` 反向依赖 `pbl-learning.ts`（后者已 import 本文件）。
 */
export type GateEvidenceType = string;

/**
 * 证据档案：把「交付物」翻译成「这个阶段需要哪种证据、因此该由哪个门禁收口」。
 * 用于让 guided_practice 的门禁**由交付物推导**，而不是由阶段名硬编码。
 */
export type EvidenceProfile = 'runnable_code' | 'experiment_report';

/**
 * 门禁注册条目：门禁 id 的权威定义。
 *
 * 把「写这个门禁需要什么证据」「谁允许写」「谁负责生产」放在门禁 id 旁边，
 * 替代此前按阶段名 `switch` 的写法。
 */
export interface GateConditionRegistration {
  /** 门禁条件 id。 */
  gateId: GateConditionId;
  /** 达成该门禁所需的证据类型。 */
  requiredEvidenceType: GateEvidenceType;
  /** 允许写入门禁达成的写入方身份（与 PBL_GATE_SOURCE_WHITELIST 同源）。 */
  allowedSources: readonly string[];
  /** 负责产出该门禁证据的服务端生产者（确定性运行器或内部通道，非客户端）。 */
  producerId: string;
}

/**
 * 门禁注册表（冻结核心 + 新增的报告/实验类门禁）。
 *
 * `experiment_report_validated` 是为「动手学动能定理」这类**报告/实验类交付物**
 * 新增的门禁：该模板 guided_practice 阶段的，交付物是
 * `simulation_experiment_report`，阶段内根本没有可运行代码，
 * 沿用 `code_playable_run_verified` 会让服务端对一个报告类作品返回
 * 「代码未通过运行验证」。新 id 是**附加**的，四个核心 id 逐字不变。
 */
export const GATE_CONDITION_REGISTRY: Readonly<Record<string, GateConditionRegistration>> = Object.freeze({
  student_confirmed_intent: {
    gateId: 'student_confirmed_intent',
    requiredEvidenceType: 'intent_confirmation',
    allowedSources: ['projects.confirm-intent', 'mentor_review', 'server_backfill'],
    producerId: 'projects.confirm-intent',
  },
  TheoryMastered: {
    gateId: 'TheoryMastered',
    requiredEvidenceType: 'mastery_attempt',
    allowedSources: ['learning-plan.theory-mastered', 'mentor_review', 'server_backfill'],
    producerId: 'learning-plan.theory-mastered',
  },
  code_playable_run_verified: {
    gateId: 'code_playable_run_verified',
    requiredEvidenceType: 'code_run_log',
    allowedSources: ['mentor_review', 'runner', 'server_backfill'],
    producerId: 'runner',
  },
  experiment_report_validated: {
    gateId: 'experiment_report_validated',
    requiredEvidenceType: 'document',
    allowedSources: ['works.publish-approved', 'mentor_review', 'server_backfill'],
    producerId: 'works.document-structure-validator',
  },
  review_completed_and_archived: {
    gateId: 'review_completed_and_archived',
    requiredEvidenceType: 'growth_archive',
    allowedSources: ['works.publish-approved', 'mentor_review', 'server_backfill'],
    producerId: 'works.publish-approved',
  },
});

/** 门禁 id 的最大长度（与各写入 DTO 的 60 字符裁剪上限一致）。 */
export const GATE_CONDITION_ID_MAX_LENGTH = 60;

/**
 * 门禁 id 的词法：字母开头，仅字母/数字/下划线/点/连字符。
 *
 * 首字符必须允许**大写**：冻结核心门禁里的 `TheoryMastered` 是驼峰，
 * 只认小写会让 contracts 自己声明的核心门禁通不过 contracts 自己的写侧校验。
 * 其余三个核心门禁恰好是小写，所以这个缺陷只在 `TheoryMastered` 上暴露。
 */
const GATE_CONDITION_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/**
 * 运行时门禁 id 校验（**写侧唯一入口**）。
 *
 * 因为 `GateConditionId` 放宽成了 `string & {}`，编译器不再兜底，
 * 非法门禁字符串必须在这里被拦下，绝不能落库。
 * 只校验**词法**，不校验「是否已注册」：新模板注册新门禁 id 必须先能过校验。
 */
export function isGateConditionId(value: unknown): value is GateConditionId {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= GATE_CONDITION_ID_MAX_LENGTH
    && GATE_CONDITION_ID_PATTERN.test(value);
}

/** 词法校验失败时抛出，消息里带上被拒绝的字面量。 */
export function assertGateConditionId(value: unknown): asserts value is GateConditionId {
  if (!isGateConditionId(value)) {
    throw new Error(`PBL gateCondition 非法（须匹配 ${String(GATE_CONDITION_ID_PATTERN)}，长度 ≤ ${GATE_CONDITION_ID_MAX_LENGTH}）：${typeof value === 'string' ? value : typeof value}`);
  }
}

/** 是否已注册（核心四个或显式注册过的扩展门禁）。 */
export function isRegisteredGateCondition(value: unknown): value is GateConditionId {
  return isGateConditionId(value) && Object.prototype.hasOwnProperty.call(GATE_CONDITION_REGISTRY, value as string);
}

/** 已注册门禁的允许写入方；未注册门禁返回空清单（= 任何写入方都不允许）。 */
export function gateAllowedSources(gate: GateConditionId): readonly string[] {
  return GATE_CONDITION_REGISTRY[gate as string]?.allowedSources ?? [];
}

/** 门禁注册条目的只读列表（按注册表声明顺序）。 */
export function listGateConditionRegistrations(): readonly GateConditionRegistration[] {
  return Object.freeze(Object.values(GATE_CONDITION_REGISTRY));
}

/**
 * guided_practice 门禁推导：**由交付物/证据档案决定**，不看阶段名。
 *
 * 修复的真实不一致：`kinetic_energy` 的 guided_practice 提交的是
 * `simulation_experiment_report`（报告类交付物），阶段内没有任何可运行代码，
 * 却被硬编码成 `code_playable_run_verified`。
 */
export function derivePracticeGateFromDeliverable(
  deliverableType: string | null | undefined,
  evidenceProfile?: EvidenceProfile | null,
): GateConditionId | null {
  if (evidenceProfile === 'runnable_code') return 'code_playable_run_verified';
  if (evidenceProfile === 'experiment_report') return 'experiment_report_validated';
  if (!deliverableType) return null;
  const normalized = deliverableType.trim().toLowerCase();
  if (normalized === 'runnable_python_game' || normalized === 'runnable_code') return 'code_playable_run_verified';
  if (normalized === 'simulation_experiment_report' || normalized === 'experiment_report') return 'experiment_report_validated';
  return null;
}

/**
 * 阶段 → 门禁的统一推导（**校验器与 platform-registry 规范化必须调用同一个函数**）。
 *
 * 返回 `null` 表示该阶段无法从交付物推导（调用方回落到阶段缺省表）。
 * 校验器若在规范化时用另一套推导，就会出现「spec 通过校验、落库却换了一个门禁」，
 * 所以两边只允许共用本函数。
 *
 * 硬规则保持不变：`concept_mastery` 恒为 `TheoryMastered`。
 */
export function deriveGateConditionForPhase(
  phase: string,
  deliverableType?: string | null,
  evidenceProfile?: EvidenceProfile | null,
): GateConditionId | null {
  if (phase === 'exploration') return 'student_confirmed_intent';
  if (phase === 'concept_mastery') return 'TheoryMastered';
  if (phase === 'guided_practice') return derivePracticeGateFromDeliverable(deliverableType, evidenceProfile);
  if (phase === 'deliverable_review') return 'review_completed_and_archived';
  return null;
}

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
   * 缺省时服务端按**交付物推导**门禁（`deriveGateConditionForPhase`）：
   * exploration→`student_confirmed_intent`、concept_mastery→`TheoryMastered`、
   * guided_practice→交付物为可运行代码时 `code_playable_run_verified`、
   * 为报告/实验类（`simulation_experiment_report`）时 `experiment_report_validated`、
   * deliverable_review→`review_completed_and_archived`。
   * `concept_mastery` 阶段的门禁**必须**是 `TheoryMastered`，服务端强校验。
   *
   * 类型放宽为 `GateConditionId` 后，服务端仍必须经 `isGateConditionId`
   * 运行时词法校验后才可落库。
   */
  gateCondition?: GateConditionId;
  /** 该阶段产出的交付物类型；guided_practice 的门禁由此推导。 */
  deliverableType?: string;
  /**
   * 证据档案（可选）：把交付物明确归到「可运行代码」或「实验/报告」一类，
   * 免得服务端只能靠交付物名字符串去猜。省略时按 `deliverableType` 推断。
   */
  evidenceProfile?: EvidenceProfile;
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

/** `DELETE /api/v1/admin/ai-runtime/assistants/:id` */
export interface AdminAssistantDeleteResponse {
  data: {
    success: true;
    deletedAssistantId: string;
  };
}

/** `DELETE /api/v1/admin/ai-runtime/teams/:id` */
export interface AdminTeamDeleteResponse {
  data: {
    success: true;
    deletedTeamId: string;
  };
}

