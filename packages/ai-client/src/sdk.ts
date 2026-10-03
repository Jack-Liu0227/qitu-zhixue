import type { ProjectStage, MasterySnapshot } from '@qitu/contracts';

export type TutorPartnerId = string;
export type TutorMemoryKind =
  | 'preference'
  | 'interest'
  | 'goal'
  | 'learning_pattern'
  | 'milestone';
export type TutorMemoryVisibility = 'student_private' | 'student_and_staff';
export type TutorTemplateScope = 'system' | 'student' | 'project';
export type TutorGrowthSignalKind =
  | 'interest_signal'
  | 'question_asked'
  | 'strategy_tried'
  | 'theory_mastered'
  | 'artifact_created'
  | 'reflection_created';

export interface TutorPartnerProfile {
  id: TutorPartnerId;
  displayName: string;
  soul: string;
  modelUsage: 'tutor.chat';
  promptVersion: string;
  capabilities: readonly ('explore' | 'plan' | 'teach' | 'review' | 'reflect')[];
}

export interface TutorMemory {
  id: string;
  studentId: string;
  partnerId: TutorPartnerId;
  kind: TutorMemoryKind;
  content: string;
  confidence: number;
  source: 'student' | 'tutor_turn' | 'project' | 'reflection' | 'staff';
  visibility: TutorMemoryVisibility;
  updatedAt: string;
}

export interface TutorTemplateDocument {
  id: string;
  version: string;
  title: string;
  summary: string;
  tags: readonly string[];
  stage: ProjectStage | 'exploration';
  content: string;
  scope: TutorTemplateScope;
  active: boolean;
}

export interface TutorTemplateSearchResult {
  document: TutorTemplateDocument;
  score: number;
  matchedTerms: readonly string[];
}

export interface TutorKnowledgeDocument {
  id: string;
  version: string;
  title: string;
  summary: string;
  tags: readonly string[];
  content: string;
  source: string;
  scope: TutorTemplateScope | 'school';
  active: boolean;
}

export interface TutorKnowledgeSearchResult {
  document: TutorKnowledgeDocument;
  score: number;
  matchedTerms: readonly string[];
}

export interface TutorLearnerProfile {
  studentId: string;
  priorKnowledge: string | null;
  targetLevel: string | null;
  timeBudgetMinutesPerWeek: number | null;
  preferences: readonly string[];
  interests: readonly string[];
  strengths: readonly string[];
  nextQuestions: readonly string[];
  version: number;
  updatedAt: string;
}

export interface TutorGrowthSignal {
  idempotencyKey: string;
  studentId: string;
  projectId: string | null;
  kind: TutorGrowthSignalKind;
  summary: string;
  evidenceRef: string | null;
  occurredAt: string;
}

export interface TutorContextInput {
  studentId: string;
  projectId: string | null;
  projectStage: ProjectStage | null;
  currentGoal: string | null;
  query: string;
  recentActivity: readonly string[];
  recentMessages?: readonly { role: 'user' | 'assistant'; content: string }[];
}

export interface TutorContextPacket {
  masterySnapshot?: MasterySnapshot;
  partner: TutorPartnerProfile;
  studentId: string;
  projectId: string | null;
  projectStage: ProjectStage | null;
  currentGoal: string | null;
  learnerProfile: Pick<
    TutorLearnerProfile,
    'priorKnowledge' | 'targetLevel' | 'timeBudgetMinutesPerWeek' | 'preferences' | 'interests' | 'strengths'
  > | null;
  memories: readonly Pick<TutorMemory, 'kind' | 'content' | 'confidence' | 'source'>[];
  templateEvidence: readonly Pick<TutorTemplateSearchResult, 'document' | 'score' | 'matchedTerms'>[];
  knowledgeEvidence: readonly Pick<TutorKnowledgeSearchResult, 'document' | 'score' | 'matchedTerms'>[];
  recentActivity: readonly string[];
  recentMessages?: readonly { role: 'user' | 'assistant'; content: string }[];
}

export interface TutorSdkPorts {
  loadLearnerProfile(studentId: string): Promise<TutorLearnerProfile | null>;
  listMemories(input: {
    studentId: string;
    partnerId: TutorPartnerId;
    limit: number;
  }): Promise<readonly TutorMemory[]>;
  searchTemplates(input: {
    studentId: string;
    projectId: string | null;
    query: string;
    limit: number;
  }): Promise<readonly TutorTemplateSearchResult[]>;
  searchKnowledge(input: {
    studentId: string;
    projectId: string | null;
    query: string;
    limit: number;
  }): Promise<readonly TutorKnowledgeSearchResult[]>;
  ensurePartner(partner: TutorPartnerProfile): Promise<void>;
  upsertTemplate(document: TutorTemplateDocument): Promise<void>;
  upsertKnowledge(document: TutorKnowledgeDocument): Promise<void>;
  upsertLearnerProfile(profile: TutorLearnerProfile): Promise<void>;
  appendGrowthSignal(signal: TutorGrowthSignal): Promise<boolean | void>;
  commitGrowthSignal?(signal: TutorGrowthSignal): Promise<void>;
  upsertMemory(memory: TutorMemory): Promise<void>;
}

export interface TutorSdk {
  readonly partner: TutorPartnerProfile;
  initialize(): Promise<void>;
  buildContext(input: TutorContextInput): Promise<TutorContextPacket>;
  recordMemory(memory: TutorMemory): Promise<void>;
  recordGrowthSignal(signal: TutorGrowthSignal): Promise<void>;
  upsertTemplate(document: TutorTemplateDocument): Promise<void>;
  upsertKnowledge(document: TutorKnowledgeDocument): Promise<void>;
}

export const QITU_LEARNING_PARTNER: TutorPartnerProfile = {
  id: 'qitu-learning-partner',
  displayName: '启途学习搭档',
  soul: '用一个问题打开好奇心，用一个小行动让学习变得可见。',
  modelUsage: 'tutor.chat',
  promptVersion: 'qitu.partner.v1',
  capabilities: ['explore', 'plan', 'teach', 'review', 'reflect'],
};

export function createTutorSdk(ports: TutorSdkPorts, partner = QITU_LEARNING_PARTNER): TutorSdk {
  return {
    partner,
    async buildContext(input) {
      const [learnerProfile, memories, templateEvidence, knowledgeEvidence] = await Promise.all([
        ports.loadLearnerProfile(input.studentId),
        ports.listMemories({ studentId: input.studentId, partnerId: partner.id, limit: 8 }),
        ports.searchTemplates({
          studentId: input.studentId,
          projectId: input.projectId,
          query: input.query,
          limit: 4,
        }),
        ports.searchKnowledge({
          studentId: input.studentId,
          projectId: input.projectId,
          query: input.query,
          limit: 4,
        }),
      ]);

      return {
        partner,
        studentId: input.studentId,
        projectId: input.projectId,
        projectStage: input.projectStage,
        currentGoal: input.currentGoal,
        learnerProfile: learnerProfile === null ? null : {
          priorKnowledge: learnerProfile.priorKnowledge,
          targetLevel: learnerProfile.targetLevel,
          timeBudgetMinutesPerWeek: learnerProfile.timeBudgetMinutesPerWeek,
          preferences: learnerProfile.preferences,
          interests: learnerProfile.interests,
          strengths: learnerProfile.strengths,
        },
        memories: memories.map(({ kind, content, confidence, source }) => ({
          kind,
          content,
          confidence,
          source,
        })),
        templateEvidence: templateEvidence.map(({ document, score, matchedTerms }) => ({
          document: {
            id: document.id,
            version: document.version,
            title: document.title,
            summary: document.summary,
            tags: document.tags,
            stage: document.stage,
            content: document.content,
            scope: document.scope,
            active: document.active,
          },
          score,
          matchedTerms,
        })),
        knowledgeEvidence: knowledgeEvidence.map(({ document, score, matchedTerms }) => ({
          document: {
            id: document.id,
            version: document.version,
            title: document.title,
            summary: document.summary,
            tags: document.tags,
            content: document.content,
            source: document.source,
            scope: document.scope,
            active: document.active,
          },
          score,
          matchedTerms,
        })),
        recentActivity: input.recentActivity.slice(-6),
        recentMessages: input.recentMessages?.slice(-6).map((message) => ({ ...message, content: message.content.slice(0, 360) })),
      };
    },
    async initialize() {
      await ports.ensurePartner(partner);
    },
    recordMemory: ports.upsertMemory,
    async recordGrowthSignal(signal) {
      if (ports.commitGrowthSignal !== undefined) return ports.commitGrowthSignal(signal);
      if (await ports.appendGrowthSignal(signal) === false) return;
      const profile = await ports.loadLearnerProfile(signal.studentId) ?? {
        studentId: signal.studentId,
        priorKnowledge: null,
        targetLevel: null,
        timeBudgetMinutesPerWeek: null,
        preferences: [],
        interests: [],
        strengths: [],
        nextQuestions: [],
        version: 0,
        updatedAt: signal.occurredAt,
      };
      const next = profileFromGrowthSignal(profile, signal);
      await ports.upsertLearnerProfile(next);
    },
    upsertTemplate: ports.upsertTemplate,
    upsertKnowledge: ports.upsertKnowledge,
  };
}

export function profileFromGrowthSignal(profile: TutorLearnerProfile, signal: TutorGrowthSignal): TutorLearnerProfile {
  const interests = signal.kind === 'interest_signal'
    ? unique([...profile.interests, signal.summary]).slice(-12)
    : profile.interests;
  const strengths = signal.kind === 'artifact_created' || signal.kind === 'theory_mastered'
    ? unique([...profile.strengths, signal.summary]).slice(-12)
    : profile.strengths;
  const nextQuestions = signal.kind === 'question_asked'
    ? unique([...profile.nextQuestions, signal.summary]).slice(-12)
    : profile.nextQuestions;
  return {
    ...profile,
    interests,
    strengths,
    nextQuestions,
    version: profile.version + 1,
    updatedAt: signal.occurredAt,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function createEmptyTutorSdkPorts(): TutorSdkPorts {
  return {
    loadLearnerProfile: async () => null,
    listMemories: async () => [],
    searchTemplates: async () => [],
    searchKnowledge: async () => [],
    ensurePartner: async () => undefined,
    upsertTemplate: async () => undefined,
    upsertKnowledge: async () => undefined,
    upsertLearnerProfile: async () => undefined,
    appendGrowthSignal: async () => undefined,
    upsertMemory: async () => undefined,
  };
}

export function clampMemoryConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function createMemory(input: Omit<TutorMemory, 'confidence'> & { confidence?: number }): TutorMemory {
  return {
    ...input,
    confidence: clampMemoryConfidence(input.confidence ?? 0.6),
  };
}
