/**
 * Server-owned coordination contracts for the future project-learning Agent SDK.
 *
 * Agents may propose bounded outputs, but only domain services can commit project
 * state, mastery, growth, profile, audit, or memory changes. Knowledge, template,
 * and database access is expressed as read ports so an agent never receives a
 * database handle or unrestricted query capability.
 */

export type TutorAgentCapability = 'explore' | 'plan' | 'teach' | 'review' | 'reflect' | 'summarize';
export type TutorAgentOutputKind = 'reply' | 'plan' | 'growth_projection' | 'learner_profile_projection' | 'teacher_follow_up';

export interface TutorAgentScope {
  studentId: string;
  partnerId: string;
  projectId: string | null;
  sessionId: string | null;
  actorRole: 'student' | 'teacher' | 'admin' | 'parent' | 'support';
}

export interface TutorAgentContext {
  scope: TutorAgentScope;
  capability: TutorAgentCapability;
  query: string;
  projectStage: string | null;
  goal: string | null;
  evidenceRefs: readonly string[];
}

export interface TutorKnowledgeReadPort {
  search(input: {
    scope: TutorAgentScope;
    query: string;
    limit: number;
  }): Promise<readonly {
    id: string;
    version: string;
    title: string;
    summary: string;
    evidence: string;
    sourceRef: string | null;
  }[]>;
}

export interface TutorTemplateReadPort {
  listPublished(input: {
    scope: TutorAgentScope;
    capability: TutorAgentCapability;
  }): Promise<readonly {
    id: string;
    versionId: string;
    title: string;
    summary: string;
    stageIds: readonly string[];
  }[]>;
}

export interface TutorDatabaseReadPort {
  readProjection(input: {
    scope: TutorAgentScope;
    projection: 'project_context' | 'mastery_snapshot' | 'learner_profile' | 'growth_timeline';
  }): Promise<unknown>;
}

export interface TutorAgentOutput<TPayload = unknown> {
  id: string;
  kind: TutorAgentOutputKind;
  agentId: string;
  agentVersion: string;
  generatedAt: string;
  sourceRefs: readonly string[];
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

export interface TutorAgentSdk {
  run<TPayload = unknown>(input: {
    context: TutorAgentContext;
    capability: TutorAgentCapability;
  }): Promise<TutorAgentOutput<TPayload>>;
}
