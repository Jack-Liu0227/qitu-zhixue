import type { EvidenceProfile, GateConditionId, PblPhase } from './team-runtime.js';

/** Versioned contracts for the planned project-based learning workflow. */
export const PBL_LEARNING_CONTRACT_VERSION = 'qitu.pbl-learning.v1' as const;

export type PblDurationWeeks = 4 | 8;
export type PblPlanStatus = 'draft' | 'active' | 'completed' | 'archived';
export type PblTemplateStatus = 'draft' | 'published' | 'archived';

/**
 * A schedule is deliberately explicit because `weeks` alone cannot tell us
 * whether a learner has one 120-minute lesson or two 60-minute lessons.
 */
export interface PblSchedule {
  durationWeeks: PblDurationWeeks;
  weeklyMinutes: 120;
  sessionsPerWeek: 1 | 2;
  sessionMinutes: 60 | 120;
}

export interface PblAgeRange {
  min: number;
  max: number;
}

export type PblObjectiveKind = 'concept' | 'procedure' | 'design' | 'reflection';

export interface PblTemplateObjective {
  id: string;
  title: string;
  description: string;
  kind: PblObjectiveKind;
  prerequisiteIds: readonly string[];
}

export interface PblTemplatePhase {
  phase: PblPhase;
  title: string;
  objectiveIds: readonly string[];
  /**
   * 该阶段收口所需达成的门禁 id。
   *
   * 原先是内联的四值联合——与 `team-runtime.ts` 的 `PblGateCondition`、
   * `admin-ai-config.validation.ts` 的 `GATE_CONDITIONS` 三处重复。现已收敛到
   * `team-runtime.ts` 的 `GATE_CONDITION_CORE` / `GATE_CONDITION_REGISTRY`，
   * 类型放宽为 `GateConditionId` 以便新模板注册自己的门禁 id。
   */
  gateCondition: GateConditionId;
  /**
   * 该阶段产出的交付物类型；guided_practice 的门禁由此推导
   * （见 `derivePracticeGateFromDeliverable`）。
   */
  deliverableType: string | null;
  /**
   * 证据档案：把交付物归到「可运行代码」还是「实验/报告」这一类，
   * 让门禁推导不必靠字符串匹配交付物名。省略时按 `deliverableType` 推断。
   */
  evidenceProfile?: EvidenceProfile | null;
  assignedAssistantId: string | null;
}

export interface PblTemplateSchedule extends PblSchedule {
  moduleCount: number;
}

export interface ProjectTemplateSpec {
  contractVersion: typeof PBL_LEARNING_CONTRACT_VERSION;
  id: string;
  version: string;
  status: PblTemplateStatus;
  title: string;
  description: string;
  targetDomain: string;
  ageRange: PblAgeRange;
  prerequisites: readonly string[];
  materials: readonly string[];
  safetyRequirements: readonly string[];
  objectives: readonly PblTemplateObjective[];
  phases: readonly PblTemplatePhase[];
  schedules: readonly PblTemplateSchedule[];
  finalDeliverableType: string;
  rubricId: string;
  teamId: string;
}

export type LessonActivity = 'review' | 'theory' | 'check' | 'practice' | 'reflect';

export interface PblLessonBlock {
  id: string;
  activity: LessonActivity;
  title: string;
  minutes: number;
  objectiveIds: readonly string[];
  required: boolean;
}

export interface PblLessonPlan {
  id: string;
  planId: string;
  week: number;
  session: number;
  title: string;
  phase: PblPhase;
  blocks: readonly PblLessonBlock[];
  requiredEvidenceIds: readonly string[];
}

export type PblEvidenceType =
  | 'code'
  | 'run_log'
  | 'image'
  | 'video'
  | 'document'
  | 'oral_explanation'
  | 'reflection';

export type PblEvidenceVisibility = 'student' | 'teacher' | 'guardian' | 'private';

export interface EvidenceRequirement {
  id: string;
  objectiveId: string;
  title: string;
  description: string;
  types: readonly PblEvidenceType[];
  required: boolean;
  visibility: PblEvidenceVisibility;
  validation: 'reference_only' | 'server_check' | 'teacher_check';
}

export type RubricLevel = 0 | 1 | 2 | 3 | 4;

export interface RubricCriterion {
  id: string;
  title: string;
  description: string;
  evidenceRequirementIds: readonly string[];
  levels: Readonly<Record<RubricLevel, string>>;
  weight: number;
}

export interface PblRubric {
  id: string;
  version: string;
  title: string;
  criteria: readonly RubricCriterion[];
  passingScore: number;
}

export type ProjectReviewCandidateStatus =
  | 'pending'
  | 'needs_evidence'
  | 'ready_for_teacher'
  | 'accepted'
  | 'returned'
  | 'rejected';

export interface ProjectReviewCriterionResult {
  criterionId: string;
  level: RubricLevel;
  rationale: string;
  evidenceRefs: readonly string[];
}

export interface ProjectReviewCandidate {
  id: string;
  projectId: string;
  artifactVersionId: string;
  rubricId: string;
  rubricVersion: string;
  status: ProjectReviewCandidateStatus;
  score: number | null;
  criteria: readonly ProjectReviewCriterionResult[];
  missingEvidenceIds: readonly string[];
  source: 'ai' | 'teacher';
  modelId: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PblScheduleValidationResult {
  valid: boolean;
  errors: readonly string[];
}

/** Pure contract validation shared by generators and API boundaries. */
export function validatePblSchedule(schedule: PblSchedule): PblScheduleValidationResult {
  const errors: string[] = [];
  if (schedule.weeklyMinutes !== 120) errors.push('weeklyMinutes must be 120');
  if (schedule.sessionsPerWeek * schedule.sessionMinutes !== schedule.weeklyMinutes) {
    errors.push('sessionsPerWeek * sessionMinutes must equal weeklyMinutes');
  }
  if (schedule.durationWeeks !== 4 && schedule.durationWeeks !== 8) {
    errors.push('durationWeeks must be 4 or 8');
  }
  return { valid: errors.length === 0, errors };
}

