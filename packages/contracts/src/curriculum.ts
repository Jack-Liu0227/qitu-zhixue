import type { PblPhase } from './team-runtime.js';
import type { PblCurriculumProfile, PblTemplateSession, ProjectTemplateSpec } from './pbl-learning.js';

export type SessionType = PblTemplateSession['sessionType'];
export type PlanSessionCount = 4 | 8 | 16;
export const SESSION_COUNT_OPTIONS: readonly PlanSessionCount[] = [4, 8, 16];

/** Compatibility names derive from the only template contract. */
export type SessionBlockSpec = PblTemplateSession['blocks'];
export type InteractiveSpec = NonNullable<PblTemplateSession['interactiveSpec']>;
export type TemplateSessionSpec = PblTemplateSession;
export type ProjectTemplateTheme = Pick<ProjectTemplateSpec,
  'title' | 'targetDomain' | 'ageRange' | 'prerequisites' | 'safetyRequirements' | 'finalDeliverableType' | 'rubricId'
> & NonNullable<ProjectTemplateSpec['theme']>;
/** @deprecated Use ProjectTemplateSpec, including its curriculum profiles. */
export type RefactoredProjectTemplateSpec = ProjectTemplateSpec;

export interface ImaKnowledgeIntegration {
  serverId: 'ima-knowledge';
  knowledgeBaseIds: string[];
  allowedTools: readonly string[];
}

export interface RolePhaseMap {
  exploration: string;
  concept_mastery: string;
  guided_practice: string;
  deliverable_review: string;
}

export interface TeamMemberAgent {
  agentId: string;
  role: string;
  assignedPhase: PblPhase;
  promptTemplate?: string;
  modelProviderId?: string | null;
  modelId?: string | null;
}

export interface DeepTeamBinding {
  bindingId: string;
  templateVersionId: string;
  teamVersionId: string;
  roleMap: RolePhaseMap;
  imaMcpGrant: ImaKnowledgeIntegration;
  bindingHash: string;
}

/** Display labels only: no global numeric session-to-role routing. */
export const SESSION_PHASE_ROLE_MAPPING = {
  exploration: { role: 'lead_tutor', roleLabel: '主导导师 Agent', mission: 'Inspire Curiosity & Plan Framing' },
  concept_mastery: { role: 'concept_coach', roleLabel: '概念教练 Agent', mission: 'Socratic Ladder & Misconception Remediation' },
  guided_practice: { role: 'lab_guide', roleLabel: '实验向导 Agent', mission: 'Generative Canvas Control & CER Analysis' },
  deliverable_review: { role: 'review_assessor', roleLabel: '评审导师 Agent', mission: 'Rubric Evaluation & Growth Archiving' },
} satisfies Record<PblPhase, { role: string; roleLabel: string; mission: string }>;

/** Resolve actual frozen session content; this helper grants no authority. */
export function getPhaseAndRoleForSession(sessionIndex: number, profile: PblCurriculumProfile): {
  phase: PblPhase;
  role: string;
  roleLabel: string;
  mission: string;
  isGateSession: boolean;
  gateCondition?: string;
} {
  if (!Number.isSafeInteger(sessionIndex) || sessionIndex < 1) throw new RangeError('Invalid session index');
  const session = profile.sessions.find((candidate) => candidate.sessionIndex === sessionIndex);
  if (session === undefined) throw new RangeError('Session is not present in frozen profile');
  const metadata = SESSION_PHASE_ROLE_MAPPING[session.phase];
  return {
    phase: session.phase,
    ...metadata,
    isGateSession: session.checkpoint !== undefined,
    ...(session.checkpoint === undefined ? {} : { gateCondition: session.checkpoint.requiredGate }),
  };
}
