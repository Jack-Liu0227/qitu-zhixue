/**
 * Versioned, server-owned contract for project-learning agents.
 *
 * This file is deliberately transport- and database-agnostic. The browser may
 * consume projections derived from these types, but it must never construct a
 * trusted scope or commit one of the domain commands represented here.
 */

export const TUTOR_AGENT_RUNTIME_VERSION = 'qitu.agent-runtime.v1' as const;

export type TutorAgentCapability =
  | 'explore'
  | 'plan'
  | 'teach'
  | 'review'
  | 'reflect'
  | 'summarize';

/** Server-resolved model purpose; never contains a provider URL or credential. */
export interface TutorAgentModelPurpose {
  usageId: string;
  available: boolean;
  input: readonly ('text' | 'image' | 'audio')[];
  output: readonly ('text' | 'image' | 'audio')[];
  modelId: string | null;
}

export type TutorAgentOutputKind =
  | 'reply'
  | 'plan'
  | 'growth_projection'
  | 'learner_profile_projection'
  | 'teacher_follow_up';

export type TutorAgentActorRole = 'student' | 'teacher' | 'admin' | 'parent' | 'support';

/** The scope is issued by the API after authorization, never trusted from a client. */
export interface TutorAgentScope {
  actorId: string;
  studentId: string;
  partnerId: string;
  projectId: string | null;
  sessionId: string | null;
  schoolId: string | null;
  actorRole: TutorAgentActorRole;
}

export interface TutorAgentMcpDescriptor {
  serverId: string;
  label: string;
  transport: 'stdio' | 'sse' | 'streamable_http' | 'unknown';
  toolIds: readonly string[];
}

export interface TutorAgentContext<TData = Record<string, never>> {
  contextId: string;
  runtimeVersion: typeof TUTOR_AGENT_RUNTIME_VERSION;
  builtAt: string;
  scope: TutorAgentScope;
  capability: TutorAgentCapability;
  /** Server-loaded global policy version/hash, never selected by the browser. */
  policyVersion: string;
  /** Agent-local bounded agents.md / role instructions. */
  agentDefinition: string;
  /** Explicitly selected Skill ids and bounded definitions. */
  skills: readonly { id: string; version: string | null; content: string }[];
  /** Effective server-owned Tool descriptors after binding authorization. */
  tools: readonly TutorAgentToolDescriptor[];
  /** Effective MCP metadata after binding authorization; no credentials. */
  mcpServers: readonly TutorAgentMcpDescriptor[];
  /** Server-resolved usage identity; never supplied by the browser. */
  modelUsage: string;
  query: string;
  projectStage: string | null;
  goal: string | null;
  evidenceRefs: readonly string[];
  /** Optional bounded, already-authorized domain projection for the agent adapter. */
  data: TData;
}

export interface TutorAgentContextInput {
  requestId: string;
  capability: TutorAgentCapability;
  query: string;
  projectStage: string | null;
  goal: string | null;
  /** Populated by the server runtime; callers must not use it to select a provider. */
  modelUsage?: string;
  evidenceRefs?: readonly string[];
}

export interface TutorAgentRuntimeRunInput extends TutorAgentContextInput {
  idempotencyKey: string;
}

export interface TutorKnowledgeEvidence {
  id: string;
  version: string;
  title: string;
  summary: string;
  evidence: string;
  sourceRef: string | null;
}

export interface TutorKnowledgeReadPort {
  search(input: {
    scope: TutorAgentScope;
    query: string;
    limit: number;
  }): Promise<readonly TutorKnowledgeEvidence[]>;
}

export interface TutorTemplateEvidence {
  id: string;
  versionId: string;
  title: string;
  summary: string;
  stageIds: readonly string[];
}

export interface TutorTemplateReadPort {
  listPublished(input: {
    scope: TutorAgentScope;
    capability: TutorAgentCapability;
  }): Promise<readonly TutorTemplateEvidence[]>;
}

export interface TutorProjectContextProjection {
  projectId: string;
  title: string;
  stage: string;
  progressPercent: number;
}

export interface TutorMasterySnapshotProjection {
  studentId: string;
  freshness: 'fresh' | 'stale' | 'unavailable';
  sourceSequence: number;
  masteredCount: number;
  totalCount: number;
}

export interface TutorLearnerProfileProjection {
  studentId: string;
  version: number;
  interests: readonly string[];
  strengths: readonly string[];
  preferences: readonly string[];
  nextQuestions: readonly string[];
  evidenceRefs: readonly string[];
  summary: string;
}

export interface TutorGrowthTimelineProjection {
  studentId: string;
  from: string;
  to: string;
  signalCount: number;
  milestones: readonly string[];
  studentSummary: string;
}

export interface TutorDatabaseProjectionMap {
  project_context: TutorProjectContextProjection | null;
  mastery_snapshot: TutorMasterySnapshotProjection;
  learner_profile: TutorLearnerProfileProjection | null;
  growth_timeline: TutorGrowthTimelineProjection;
}

export type TutorDatabaseProjectionName = keyof TutorDatabaseProjectionMap;

export interface TutorDatabaseReadPort {
  readProjection<K extends TutorDatabaseProjectionName>(input: {
    scope: TutorAgentScope;
    projection: K;
  }): Promise<TutorDatabaseProjectionMap[K]>;
}

export interface TutorAgentReadPorts {
  knowledge: TutorKnowledgeReadPort;
  templates: TutorTemplateReadPort;
  database: TutorDatabaseReadPort;
}

/** Read ports after the authorized scope has been bound by the runtime. */
export interface TutorAgentBoundReadPorts {
  knowledge: {
    search(input: { query: string; limit: number }): Promise<readonly TutorKnowledgeEvidence[]>;
  };
  templates: {
    listPublished(input: { capability: TutorAgentCapability }): Promise<readonly TutorTemplateEvidence[]>;
  };
  database: {
    readProjection<K extends TutorDatabaseProjectionName>(input: {
      projection: K;
    }): Promise<TutorDatabaseProjectionMap[K]>;
  };
}

export interface TutorAgentToolDescriptor {
  id: string;
  version: string;
  capabilities: readonly TutorAgentCapability[];
  riskLevel: 'low' | 'medium' | 'high';
  execution: 'server_owned';
  requiresTheoryMastered: boolean;
}

export interface TutorAgentToolCall {
  callId: string;
  toolId: string;
  toolVersion: string;
  status: 'requested' | 'completed' | 'rejected' | 'failed';
  sourceRefs: readonly string[];
}

export interface TutorAgentToolRegistry {
  list(input: { capability: TutorAgentCapability }): readonly TutorAgentToolDescriptor[];
}


export interface TutorAgentRunRequest<TData = Record<string, never>> {
  requestId: string;
  idempotencyKey: string;
  capability: TutorAgentCapability;
  context: TutorAgentContext<TData>;
}

export interface TutorAgentPayload {
  text?: string;
  blocks?: readonly { kind: string; text?: string }[];
  projection?: TutorAgentOutputKind;
  /** Internal SDK payload; not a browser response by itself. */
  data?: unknown;
}

export interface TutorAgentOutput<TPayload extends TutorAgentPayload = TutorAgentPayload> {
  id: string;
  runId: string;
  requestId: string;
  kind: TutorAgentOutputKind;
  agentId: string;
  agentVersion: string;
  runtimeVersion: typeof TUTOR_AGENT_RUNTIME_VERSION;
  generatedAt: string;
  sourceRefs: readonly string[];
  toolCalls: readonly TutorAgentToolCall[];
  payload: TPayload;
}

export interface TutorGrowthProjection {
  studentId: string;
  period: { from: string; to: string };
  strengths: readonly string[];
  evidenceCount: number;
  nextQuestions: readonly string[];
  studentSummary: string;
  parentSummary: string | null;
  teacherSummary: string | null;
  confidence: 'low' | 'medium' | 'high';
}
