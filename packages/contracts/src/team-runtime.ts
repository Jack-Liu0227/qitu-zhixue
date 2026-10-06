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
