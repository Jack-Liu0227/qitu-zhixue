import type { EvidenceProfile, GateConditionId, PblPhase } from './team-runtime.js';
import { isGateConditionId } from './team-runtime.js';
import type { KnowledgeType } from './learning-plan.js';

/** Versioned contracts for the planned project-based learning workflow. */
export const PBL_LEARNING_CONTRACT_VERSION = 'qitu.pbl-learning.v1' as const;

export type PblPlanStatus = 'draft' | 'active' | 'completed' | 'archived';
/**
 * 模板版本生命周期（服务端状态机，客户端只读）。
 *
 * 迁移（decisions D4）：
 *
 *   draft → piloting → published → archived
 *                ↘ archived
 *
 * - `draft → piloting`：治理端点 `POST /admin/project-templates/:id/versions/:versionId/pilot`，
 *   需显式 admin reason + 审计，不落验证 run。
 * - `piloting`：学生端模板列表可见，并由 `status === 'piloting'` 标识为试点；
 *   这是「新模板先小范围真实使用、再补证据」的正规链，避免 seed 直插。
 * - `piloting → published`：**仍走既有证据门（5 项校验，含已完成项目）**，
 *   试点不弱化任何验证条件。
 * - `piloting → archived`：允许随时下线试点。
 */
export type PblTemplateStatus = 'draft' | 'piloting' | 'published' | 'archived';

/** Canonical schedule for governed templates, organized by lesson. */
export interface PblLessonSchedule {
  lessonCount: number;
  lessonMinutes: 60 | 120;
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
  knowledgeType?: KnowledgeType | null;
  conceptId?: string | null;
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

/**
 * 平台级 PBL 治理策略阶段定义（Governance Policy Phase）
 * 集中定义阶段宏观治理、门禁约束、阶段导师分工与实验工具放行规则。
 */
export interface PblGovernancePolicyPhase {
  phase: PblPhase;
  title: string;
  requiredCheckpoint: GateConditionId;
  leadAssistantRole: string;
  allowedToolTypesBeforeGate?: readonly string[];
  allowedToolTypesAfterGate: readonly string[];
}

/**
 * 平台级 PBL 治理策略（Governance Policy）
 * 策略独立于具体课程/课时，可被 8 课时、16 课时、24 课时等多排期模板复用。
 */
export interface PblGovernancePolicy {
  id: string;
  name: string;
  version: string;
  description: string;
  phases: readonly PblGovernancePolicyPhase[];
}

/**
 * 平台标准 STEM 物理项目式探究治理策略（v1）
 * 强制 TheoryMastered 门禁前阻断仿真操作。
 */
export const STANDARD_STEM_PBL_POLICY: PblGovernancePolicy = {
  id: 'standard-stem-pbl:v1',
  name: 'STEM 物理项目式探究标准治理策略',
  version: 'v1',
  description: '涵盖 4 阶段宏观治理、TheoryMastered 理论门禁与实验仿真权限受控放行',
  phases: [
    {
      phase: 'exploration',
      title: '探索破冰',
      requiredCheckpoint: 'student_confirmed_intent',
      leadAssistantRole: 'Lead Advisor',
      allowedToolTypesBeforeGate: ['concept_probe', 'driving_question'],
      allowedToolTypesAfterGate: ['concept_probe', 'driving_question', 'cer_coach'],
    },
    {
      phase: 'concept_mastery',
      title: '概念奠基',
      requiredCheckpoint: 'TheoryMastered',
      leadAssistantRole: 'Concept Coach',
      allowedToolTypesBeforeGate: ['concept_probe', 'quiz_check', 'ray_tracing_preview'],
      allowedToolTypesAfterGate: ['concept_probe', 'quiz_check', 'ray_tracing_preview'],
    },
    {
      phase: 'guided_practice',
      title: '探究实践',
      requiredCheckpoint: 'experiment_report_validated',
      leadAssistantRole: 'Lab Guide',
      allowedToolTypesBeforeGate: ['safety_checklist', 'experiment_design'],
      allowedToolTypesAfterGate: ['single_slit_diffraction', 'fog_chamber_scattering', 'data_linear_fit'],
    },
    {
      phase: 'deliverable_review',
      title: '成果答辩与归档',
      requiredCheckpoint: 'review_completed_and_archived',
      leadAssistantRole: 'Reviewer',
      allowedToolTypesBeforeGate: ['defense_coach', 'peer_critique'],
      allowedToolTypesAfterGate: ['defense_coach', 'peer_critique', 'growth_archive'],
    },
  ],
};

export function matchesPolicyGate(actualGate: string, policyGate: string): boolean {
  if (actualGate === policyGate) return true;
  if (
    (actualGate === 'experiment_report_validated' && policyGate === 'practice_artifact_approved') ||
    (actualGate === 'practice_artifact_approved' && policyGate === 'experiment_report_validated')
  ) {
    return true;
  }
  return false;
}

export const GLOBAL_GOVERNANCE_POLICIES: readonly PblGovernancePolicy[] = [
  STANDARD_STEM_PBL_POLICY,
];

export function findGovernancePolicy(policyId: string): PblGovernancePolicy | undefined {
  return GLOBAL_GOVERNANCE_POLICIES.find((policy) => policy.id === policyId);
}

/**
 * 根据治理策略与课时列表，自动推导阶段配置（PblTemplatePhase[]）。
 * 消除模板手动维护冗余 phases 数组以及阶段与课时目标双重维护的心智负担。
 */
export function derivePhasesFromPolicyAndSessions(
  policy: PblGovernancePolicy,
  sessions: readonly PblTemplateSession[],
  options?: {
    deliverableTypes?: Partial<Record<PblPhase, string>>;
    assignedAssistants?: Partial<Record<PblPhase, string>>;
  },
): PblTemplatePhase[] {
  return policy.phases.map((policyPhase) => {
    // 自动聚合属于该阶段的所有课时的 objectiveIds
    const phaseSessions = sessions.filter((s) => s.phase === policyPhase.phase);
    const objectiveIdSet = new Set<string>();
    for (const session of phaseSessions) {
      for (const objId of session.objectiveIds) {
        objectiveIdSet.add(objId);
      }
    }

    const defaultDeliverable =
      policyPhase.phase === 'guided_practice'
        ? 'optics_experiment_report'
        : policyPhase.phase === 'deliverable_review'
          ? 'optics_project_showcase'
          : null;

    return {
      phase: policyPhase.phase,
      title: policyPhase.title,
      objectiveIds: Array.from(objectiveIdSet),
      gateCondition: policyPhase.requiredCheckpoint,
      deliverableType: options?.deliverableTypes?.[policyPhase.phase] ?? defaultDeliverable,
      evidenceProfile:
        policyPhase.phase === 'guided_practice'
          ? 'experiment_report'
          : null,
      assignedAssistantId: options?.assignedAssistants?.[policyPhase.phase] ?? null,
    };
  });
}

export type PblTemplateSchedule = PblLessonSchedule;

export interface ProjectTemplateSpec {
  /** Opt-in immutable teaching semantics. Omitted on historical templates. */
  lessonPolicy?: 'lesson-guided.v1';
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
  /** 绑定的全局治理策略 ID（例如 'standard-stem-pbl:v1'），实现教学课时与安全门禁策略解耦 */
  governancePolicyId?: string;
  /** All other theme metadata remains in the existing authoritative fields. */
  theme?: { drivingQuestion: string };
  curriculum?: { profiles: readonly PblCurriculumProfile[] };
}

export type PblTemplateSessionType = 'theory' | 'practice' | 'review';

interface LearningSessionCompletionRequirements {
  requiredEvidence: readonly {
    kind: 'session_response' | 'experiment_observation' | 'submitted_artifact' | 'approved_artifact';
    scope: 'session' | 'project';
    minimumCount: number;
  }[];
  requiredMasteryObjectiveIds: readonly string[];
}

export interface LessonQualityReviewSpec {
  version: 'lesson-quality.v1';
  reviewer: 'current_teacher';
  criteria: readonly { id: string; description: string }[];
}

export type LearningSessionCompletionSpec = LearningSessionCompletionRequirements & (
  | { version: 'learning-session-completion.v1' }
  | { version: 'learning-session-completion.v2'; qualityReview: LessonQualityReviewSpec }
);

export function hasLearningSessionCompletion(session: Pick<PblTemplateSession, 'completionSpec'>): boolean {
  return session.completionSpec?.version === 'learning-session-completion.v1'
    || session.completionSpec?.version === 'learning-session-completion.v2';
}

export interface PblTemplateSession {
  /** Explicit lesson lead, independent of the governance-phase coordinator. */
  leadAssistantId?: string;
  activityRequirements?: readonly {
    activity: LessonActivity;
    evidence: 'session_response' | 'experiment_observation' | 'submitted_artifact' | 'mastery';
  }[];
  teachingRequirements?: readonly ('dynamic_lesson' | 'project_knowledge')[];
  /** Explicit canonical skill requirements frozen with this session, never inferred from its title. */
  requiredSkillIds?: readonly string[];
  id: string;
  sessionIndex: number;
  title: string;
  phase: PblPhase;
  sessionType: PblTemplateSessionType;
  objectiveIds: readonly string[];
  durationMinutes: number;
  blocks: Readonly<Record<LessonActivity, number>>;
  learningGoal?: string;
  activityGuidance?: Readonly<Partial<Record<LessonActivity, string>>>;
  /** Requested evidence only; owner receipts determine acceptance. */
  evidenceRequirements?: readonly string[];
  completionSpec?: LearningSessionCompletionSpec;
  /** A checkpoint requests owner validation; it is never a completion fact. */
  checkpoint?: { requiredGate: GateConditionId };
  interactiveSpec?: {
    enabled: boolean;
    domainTopic: string;
    allowHypothesisPrediction: boolean;
  };
}

export interface PblCurriculumProfile {
  id: string;
  schedule: PblLessonSchedule;
  sessions: readonly PblTemplateSession[];
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
  /** One-based lesson order; calendar placement is not part of the template contract. */
  lessonIndex: number;
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

export interface PblLessonScheduleValidationResult {
  valid: boolean;
  errors: readonly string[];
}

/** Pure contract validation shared by generators and API boundaries. */
/** Validate the lesson schedule used by governed PBL templates. */
export function validatePblLessonSchedule(schedule: PblLessonSchedule): PblLessonScheduleValidationResult {
  const errors: string[] = [];
  if (!Number.isSafeInteger(schedule.lessonCount) || schedule.lessonCount < 1 || schedule.lessonCount > 128) {
    errors.push('lessonCount must be an integer between 1 and 128');
  }
  if (schedule.lessonMinutes !== 60 && schedule.lessonMinutes !== 120) {
    errors.push('lessonMinutes must be 60 or 120');
  }
  return { valid: errors.length === 0, errors };
}

export interface ProjectTemplateValidationIssue {
  path: string;
  message: string;
}

export interface ProjectTemplateValidationResult {
  valid: boolean;
  errors: readonly ProjectTemplateValidationIssue[];
}

export class ProjectTemplateSpecError extends Error {
  readonly code = 'PROJECT_TEMPLATE_SPEC_INVALID';
  constructor(readonly errors: readonly ProjectTemplateValidationIssue[]) {
    super(errors[0]?.message ?? 'Invalid project template');
    this.name = 'ProjectTemplateSpecError';
  }
}

const TEMPLATE_PHASES: readonly PblPhase[] = [
  'exploration', 'concept_mastery', 'guided_practice', 'deliverable_review',
];
const TEMPLATE_ACTIVITIES: readonly LessonActivity[] = ['review', 'theory', 'check', 'practice', 'reflect'];

function templateRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function templateText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function templateStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(templateText);
}

function templateInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function templateEnum(value: unknown, choices: readonly string[]): boolean {
  return typeof value === 'string' && choices.includes(value);
}

function templateKeys(
  value: object, keys: readonly string[], path: string,
  issue: (path: string, message: string) => void,
): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) issue(`${path}.${key}`, 'unknown contract field');
}

function templateSchedule(value: unknown): value is PblLessonSchedule {
  if (!templateRecord(value)) return false;
  return typeof value.lessonCount === 'number' && Number.isSafeInteger(value.lessonCount)
    && value.lessonCount >= 1 && value.lessonCount <= 128
    && (value.lessonMinutes === 60 || value.lessonMinutes === 120);
}

function sameSchedule(left: PblLessonSchedule, right: PblLessonSchedule): boolean {
  return left.lessonCount === right.lessonCount && left.lessonMinutes === right.lessonMinutes;
}

/** Validate untrusted JSON without changing or filling any teaching content. */
export function validateProjectTemplateSpec(input: unknown): ProjectTemplateValidationResult {
  const errors: ProjectTemplateValidationIssue[] = [];
  const issue = (path: string, message: string): void => { errors.push({ path, message }); };
  if (!templateRecord(input)) return { valid: false, errors: [{ path: 'pbl', message: 'pbl must be an object' }] };
  templateKeys(input, ['contractVersion', 'id', 'version', 'status', 'title', 'description', 'targetDomain', 'ageRange',
    'prerequisites', 'materials', 'safetyRequirements', 'objectives', 'phases', 'schedules', 'finalDeliverableType',
    'rubricId', 'teamId', 'governancePolicyId', 'theme', 'curriculum', 'lessonPolicy'], 'pbl', issue);
  if (input.lessonPolicy !== undefined && input.lessonPolicy !== 'lesson-guided.v1') issue('lessonPolicy', 'unsupported lesson policy');
  if (input.lessonPolicy && !input.curriculum) issue('curriculum', 'lesson-guided teaching requires a frozen curriculum');
  if (input.contractVersion !== PBL_LEARNING_CONTRACT_VERSION) issue('contractVersion', 'unsupported contractVersion');
  for (const key of ['id', 'version', 'title', 'description', 'targetDomain', 'finalDeliverableType', 'rubricId', 'teamId']) {
    if (!templateText(input[key])) issue(key, `${key} must be non-empty text`);
  }
  if (!templateEnum(input.status, ['draft', 'piloting', 'published', 'archived'])) issue('status', 'invalid template status');
  if (templateRecord(input.ageRange)) templateKeys(input.ageRange, ['min', 'max'], 'ageRange', issue);
  if (!templateRecord(input.ageRange) || !templateInteger(input.ageRange.min, 1, 120)
    || !templateInteger(input.ageRange.max, 1, 120) || input.ageRange.min > input.ageRange.max) {
    issue('ageRange', 'ageRange must contain ordered integer ages');
  }
  for (const key of ['prerequisites', 'materials', 'safetyRequirements']) {
    if (!templateStrings(input[key])) issue(key, `${key} must be a text array`);
  }
  const objectives = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(input.objectives) || input.objectives.length === 0) issue('objectives', 'objectives must not be empty');
  for (const [index, value] of (Array.isArray(input.objectives) ? input.objectives : []).entries()) {
    const path = `objectives[${index}]`;
    if (!templateRecord(value)) { issue(path, 'objective must be an object'); continue; }
    templateKeys(value, ['id', 'title', 'description', 'kind', 'prerequisiteIds', 'knowledgeType', 'conceptId'], path, issue);
    if (!templateText(value.id) || objectives.has(value.id)) issue(`${path}.id`, 'objective id must be unique non-empty text');
    else objectives.set(value.id, value);
    for (const key of ['title', 'description']) if (!templateText(value[key])) issue(`${path}.${key}`, `${key} must be non-empty text`);
    if (!templateEnum(value.kind, ['concept', 'procedure', 'design', 'reflection'])) issue(`${path}.kind`, 'invalid objective kind');
    if (!templateStrings(value.prerequisiteIds)) issue(`${path}.prerequisiteIds`, 'prerequisites must be a text array');
    if (value.knowledgeType !== undefined && value.knowledgeType !== null
      && !templateEnum(value.knowledgeType, ['memory', 'concept', 'procedure', 'design'])) issue(`${path}.knowledgeType`, 'invalid knowledge type');
    if (value.conceptId !== undefined && value.conceptId !== null && !templateText(value.conceptId)) issue(`${path}.conceptId`, 'invalid concept id');
  }
  for (const [id, objective] of objectives) {
    if (templateStrings(objective.prerequisiteIds)) for (const prerequisite of objective.prerequisiteIds) {
      if (!objectives.has(prerequisite) || prerequisite === id) issue(`objectives.${id}.prerequisiteIds`, 'prerequisite must reference a different template objective');
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) { issue(`objectives.${id}.prerequisiteIds`, 'objective prerequisite cycle'); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    const refs = objectives.get(id)?.prerequisiteIds;
    if (templateStrings(refs)) for (const ref of refs) if (objectives.has(ref)) visit(ref);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of objectives.keys()) visit(id);

  let activePolicy: PblGovernancePolicy | undefined;
  if (input.governancePolicyId !== undefined) {
    if (!templateText(input.governancePolicyId)) {
      issue('governancePolicyId', 'governancePolicyId must be non-empty text');
    } else {
      activePolicy = findGovernancePolicy(input.governancePolicyId);
      if (!activePolicy) {
        issue('governancePolicyId', `unknown governance policy ${input.governancePolicyId}`);
      } else {
        const profiles = (input.curriculum as Record<string, unknown> | undefined)?.profiles;
        const firstProfile = Array.isArray(profiles) ? profiles[0] : undefined;
        if (
          (!Array.isArray(input.phases) || input.phases.length === 0) &&
          templateRecord(firstProfile) &&
          Array.isArray(firstProfile.sessions)
        ) {
          // Auto-derive phases from policy and first profile's sessions
          (input as { phases: PblTemplatePhase[] }).phases = derivePhasesFromPolicyAndSessions(
            activePolicy,
            firstProfile.sessions as readonly PblTemplateSession[],
          );
        }
      }
    }
  }

  const phases = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(input.phases) || input.phases.length !== 4) issue('phases', 'all four template phases are required');
  for (const [index, value] of (Array.isArray(input.phases) ? input.phases : []).entries()) {
    const path = `phases[${index}]`;
    if (!templateRecord(value)) { issue(path, 'phase must be an object'); continue; }
    templateKeys(value, ['phase', 'title', 'objectiveIds', 'gateCondition', 'deliverableType', 'evidenceProfile', 'assignedAssistantId'], path, issue);
    if (value.phase !== TEMPLATE_PHASES[index] || phases.has(String(value.phase))) issue(`${path}.phase`, 'phases must be unique and ordered');
    if (typeof value.phase === 'string') phases.set(value.phase, value);
    if (!templateText(value.title)) issue(`${path}.title`, 'phase title is required');
    if (!templateStrings(value.objectiveIds) || value.objectiveIds.length === 0
      || new Set(value.objectiveIds).size !== value.objectiveIds.length) issue(`${path}.objectiveIds`, 'phase objectives must be non-empty and unique');
    else for (const id of value.objectiveIds) if (!objectives.has(id)) issue(`${path}.objectiveIds`, `unknown objective ${id}`);
    if (!isGateConditionId(value.gateCondition)) issue(`${path}.gateCondition`, 'invalid gate condition');
    if (value.phase === 'concept_mastery' && value.gateCondition !== 'TheoryMastered') issue(`${path}.gateCondition`, 'concept phase must require TheoryMastered');
    if (activePolicy) {
      const policyPhase = activePolicy.phases.find((p) => p.phase === value.phase);
      if (policyPhase && !matchesPolicyGate(String(value.gateCondition), policyPhase.requiredCheckpoint)) {
        issue(`${path}.gateCondition`, `gate condition must match governance policy checkpoint ${policyPhase.requiredCheckpoint}`);
      }
    }
    if (value.deliverableType !== null && !templateText(value.deliverableType)) issue(`${path}.deliverableType`, 'deliverableType must be text or null');
    if (value.assignedAssistantId !== null && !templateText(value.assignedAssistantId)) issue(`${path}.assignedAssistantId`, 'assignedAssistantId must be text or null');
    if (value.evidenceProfile !== undefined && value.evidenceProfile !== null
      && !templateEnum(value.evidenceProfile, ['runnable_code', 'experiment_report'])) issue(`${path}.evidenceProfile`, 'invalid evidence profile');
  }
  const schedules: PblTemplateSchedule[] = [];
  if (!Array.isArray(input.schedules) || input.schedules.length === 0) issue('schedules', 'schedules are required');
  for (const [index, value] of (Array.isArray(input.schedules) ? input.schedules : []).entries()) {
    const path = `schedules[${index}]`;
    if (!templateSchedule(value)) { issue(path, 'invalid schedule'); continue; }
    schedules.push(value as PblTemplateSchedule);
    templateKeys(value, ['lessonCount', 'lessonMinutes'], path, issue);
    if (!templateInteger(value.lessonCount, 1, 128)) issue(`${path}.lessonCount`, 'lessonCount must be a positive integer');
  }
  if (input.theme !== undefined && (!templateRecord(input.theme) || !templateText(input.theme.drivingQuestion))) issue('theme.drivingQuestion', 'driving question is required');
  if (templateRecord(input.theme)) templateKeys(input.theme, ['drivingQuestion'], 'theme', issue);
  if (input.curriculum !== undefined) {
    if (!templateRecord(input.curriculum) || !Array.isArray(input.curriculum.profiles) || input.curriculum.profiles.length === 0) {
      issue('curriculum.profiles', 'curriculum profiles must not be empty');
    } else {
      templateKeys(input.curriculum, ['profiles'], 'curriculum', issue);
      const profileIds = new Set<string>();
      for (const [index, profile] of input.curriculum.profiles.entries()) {
        validateTemplateProfile(profile, `curriculum.profiles[${index}]`, profileIds, schedules, objectives, phases, issue);
        if (input.lessonPolicy === 'lesson-guided.v1') validateGuidedProfile(profile, `curriculum.profiles[${index}]`, issue);
      }
      if (activePolicy) {
        for (const profile of input.curriculum.profiles) {
          if (templateRecord(profile) && Array.isArray((profile as Record<string, unknown>).sessions)) {
            for (const policyPhase of activePolicy.phases) {
              const hasCheckpoint = ((profile as { sessions: Record<string, unknown>[] }).sessions).some(
                (s) => {
                  const gate = (s?.checkpoint as Record<string, unknown> | undefined)?.requiredGate;
                  return typeof gate === 'string' && matchesPolicyGate(gate, policyPhase.requiredCheckpoint);
                },
              );
              if (!hasCheckpoint && policyPhase.requiredCheckpoint !== 'student_confirmed_intent') {
                issue('curriculum.profiles', `curriculum profile must include policy checkpoint ${policyPhase.requiredCheckpoint}`);
              }
            }
          }
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function validateActivityRequirements(session: Record<string, unknown>, path: string, issue: (path: string, message: string) => void): void {
  if (!Array.isArray(session.activityRequirements) || !templateRecord(session.blocks)) {
    issue(path, 'activity requirements must reference scheduled blocks'); return;
  }
  const seen = new Set<string>();
  for (const item of session.activityRequirements) {
    if (!templateRecord(item)) { issue(path, 'invalid activity requirement'); continue; }
    templateKeys(item, ['activity', 'evidence'], path, issue);
    if (!templateEnum(item.activity, TEMPLATE_ACTIVITIES) || seen.has(String(item.activity))
      || !templateInteger(session.blocks[String(item.activity)], 1, 120)
      || !templateEnum(item.evidence, ['session_response', 'experiment_observation', 'submitted_artifact', 'mastery'])
      || (item.evidence === 'mastery' && (item.activity !== 'check' || !templateRecord(session.completionSpec)
        || !Array.isArray(session.completionSpec.requiredMasteryObjectiveIds) || !session.completionSpec.requiredMasteryObjectiveIds.length))) {
      issue(path, 'invalid or duplicate activity evidence requirement');
    }
    seen.add(String(item.activity));
  }
  for (const activity of TEMPLATE_ACTIVITIES) if (Number(session.blocks[activity]) > 0 && !seen.has(activity)) {
    issue(path, `missing activity evidence requirement: ${activity}`);
  }
}

function validateGuidedProfile(profile: unknown, path: string, issue: (path: string, message: string) => void): void {
  if (!templateRecord(profile) || !Array.isArray(profile.sessions)) return;
  for (const session of profile.sessions) {
    if (!templateRecord(session)) continue;
    const at = `${path}.${session.id}`;
    if (!templateText(session.leadAssistantId) || !Array.isArray(session.requiredSkillIds) || !session.requiredSkillIds.length
      || !Array.isArray(session.teachingRequirements) || !session.teachingRequirements.includes('dynamic_lesson')
      || !templateRecord(session.completionSpec) || session.completionSpec.version !== 'learning-session-completion.v2') {
      issue(at, 'guided lessons require a lead, canonical skills, dynamic teaching and quality-reviewed completion');
    }
    if (session.activityRequirements === undefined) issue(at, 'guided lessons require activity evidence rules');
    if (templateRecord(session.blocks)) for (const activity of TEMPLATE_ACTIVITIES) {
      if (Number(session.blocks[activity]) > 0 && (!templateRecord(session.activityGuidance) || !templateText(session.activityGuidance[activity]))) {
        issue(at, `missing scheduled activity guidance: ${activity}`);
      }
    }
    if (templateRecord(session.checkpoint) && session.checkpoint.requiredGate === 'student_confirmed_intent') issue(at, 'intent confirmation occurs before formal lessons');
  }
}

function validateTemplateProfile(
  profile: unknown, path: string, profileIds: Set<string>, schedules: readonly PblTemplateSchedule[],
  objectives: ReadonlyMap<string, Record<string, unknown>>, phases: ReadonlyMap<string, Record<string, unknown>>,
  issue: (path: string, message: string) => void,
): void {
  if (!templateRecord(profile)) { issue(path, 'profile must be an object'); return; }
  templateKeys(profile, ['id', 'schedule', 'sessions'], path, issue);
  if (!templateText(profile.id) || profileIds.has(profile.id)) issue(`${path}.id`, 'profile id must be unique');
  else profileIds.add(profile.id);
  if (!templateSchedule(profile.schedule)) { issue(`${path}.schedule`, 'invalid profile schedule'); return; }
  const schedule = profile.schedule;
  templateKeys(schedule, ['lessonCount', 'lessonMinutes'], `${path}.schedule`, issue);
  if (!schedules.some((value) => sameSchedule(value, schedule))) {
    issue(`${path}.schedule`, 'profile schedule must be approved by template');
  }
  const count = schedule.lessonCount;
  if (!Array.isArray(profile.sessions) || profile.sessions.length !== count) { issue(`${path}.sessions`, 'sessions must match schedule count'); return; }
  const ids = new Set<string>();
  const covered = new Set<string>();
  let previousPhase = -1;
  for (const [index, session] of profile.sessions.entries()) {
    const sessionPath = `${path}.sessions[${index}]`;
    if (!templateRecord(session)) { issue(sessionPath, 'session must be an object'); continue; }
    templateKeys(session, ['id', 'sessionIndex', 'title', 'phase', 'sessionType', 'objectiveIds',
      'durationMinutes', 'blocks', 'learningGoal', 'activityGuidance', 'evidenceRequirements', 'completionSpec', 'checkpoint', 'interactiveSpec', 'teachingRequirements', 'requiredSkillIds', 'leadAssistantId', 'activityRequirements'], sessionPath, issue);
    if (session.leadAssistantId !== undefined && !templateText(session.leadAssistantId)) issue(`${sessionPath}.leadAssistantId`, 'invalid lead assistant');
    if (session.activityRequirements !== undefined) validateActivityRequirements(session, sessionPath, issue);
    if (session.requiredSkillIds !== undefined && (!Array.isArray(session.requiredSkillIds)
      || new Set(session.requiredSkillIds).size !== session.requiredSkillIds.length
      || session.requiredSkillIds.some(value => typeof value !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)))) {
      issue(`${sessionPath}.requiredSkillIds`, 'invalid canonical skill requirements');
    }
    if (session.teachingRequirements !== undefined && (!Array.isArray(session.teachingRequirements)
      || session.teachingRequirements.length > 2 || new Set(session.teachingRequirements).size !== session.teachingRequirements.length
      || session.teachingRequirements.some(value => !['dynamic_lesson', 'project_knowledge'].includes(String(value))))) {
      issue(`${sessionPath}.teachingRequirements`, 'invalid teaching capability requirements');
    }
    if (!templateText(session.id) || ids.has(session.id)) issue(`${sessionPath}.id`, 'session id must be unique');
    else ids.add(session.id);
    if (session.sessionIndex !== index + 1) issue(`${sessionPath}.sessionIndex`, 'sessionIndex must be a contiguous one-based integer');
    if (!templateText(session.title)) issue(`${sessionPath}.title`, 'session title is required');
    if (session.learningGoal !== undefined && !templateText(session.learningGoal)) issue(`${sessionPath}.learningGoal`, 'learningGoal must be non-empty text');
    if (session.evidenceRequirements !== undefined && (!templateStrings(session.evidenceRequirements)
      || session.evidenceRequirements.length === 0 || session.evidenceRequirements.length > 16)) {
      issue(`${sessionPath}.evidenceRequirements`, 'evidenceRequirements must contain 1 to 16 non-empty descriptions');
    }
    if (session.completionSpec !== undefined) {
      const spec = session.completionSpec;
      const specPath = `${sessionPath}.completionSpec`;
      if (!templateRecord(spec)) issue(specPath, 'completion specification must be an object');
      else {
        templateKeys(spec, ['version', 'requiredEvidence', 'requiredMasteryObjectiveIds', ...(spec.version === 'learning-session-completion.v2' ? ['qualityReview'] : [])], specPath, issue);
        if (!['learning-session-completion.v1', 'learning-session-completion.v2'].includes(String(spec.version))) issue(`${specPath}.version`, 'unsupported completion specification');
        if (spec.version === 'learning-session-completion.v2') {
          const review = spec.qualityReview;
          if (!templateRecord(review)) issue(`${specPath}.qualityReview`, 'quality review is required');
          else {
            templateKeys(review, ['version', 'reviewer', 'criteria'], `${specPath}.qualityReview`, issue);
            if (review.version !== 'lesson-quality.v1' || review.reviewer !== 'current_teacher'
              || !Array.isArray(review.criteria) || review.criteria.length < 1 || review.criteria.length > 8) {
              issue(`${specPath}.qualityReview`, 'one to eight current-teacher quality criteria are required');
            } else {
              const ids = new Set<string>();
              for (const criterion of review.criteria) {
                if (!templateRecord(criterion)) { issue(specPath, 'invalid quality criterion'); continue; }
                templateKeys(criterion, ['id', 'description'], `${specPath}.qualityReview.criteria`, issue);
                if (!templateText(criterion.id) || !templateText(criterion.description) || criterion.description.length > 600
                  || ids.has(String(criterion.id))) issue(`${specPath}.qualityReview.criteria`, 'invalid or duplicate quality criterion');
                ids.add(String(criterion.id));
              }
            }
          }
        }
        if (!Array.isArray(spec.requiredEvidence) || spec.requiredEvidence.length < 1 || spec.requiredEvidence.length > 4) {
          issue(`${specPath}.requiredEvidence`, 'one to four server-owned evidence requirements are required');
        } else {
          const seen = new Set<string>();
          for (const requirement of spec.requiredEvidence) {
            if (!templateRecord(requirement)) { issue(specPath, 'invalid evidence requirement'); continue; }
            templateKeys(requirement, ['kind', 'scope', 'minimumCount'], specPath, issue);
            const key = `${requirement.kind}:${requirement.scope}`;
            if (!templateEnum(requirement.kind, ['session_response', 'experiment_observation', 'submitted_artifact', 'approved_artifact'])
              || !templateEnum(requirement.scope, ['session', 'project']) || !templateInteger(requirement.minimumCount, 1, 10)
              || seen.has(key) || (requirement.scope === 'project' && requirement.kind !== 'approved_artifact')) {
              issue(`${specPath}.requiredEvidence`, 'invalid or duplicate scoped evidence requirement');
            }
            seen.add(key);
          }
        }
        if (!templateStrings(spec.requiredMasteryObjectiveIds)
          || new Set(spec.requiredMasteryObjectiveIds).size !== spec.requiredMasteryObjectiveIds.length) {
          issue(`${specPath}.requiredMasteryObjectiveIds`, 'mastery objectives must be unique');
        } else for (const id of spec.requiredMasteryObjectiveIds) {
          if (!objectives.has(id) || !templateStrings(phases.get('concept_mastery')?.objectiveIds) || !(phases.get('concept_mastery')!.objectiveIds as string[]).includes(id) || !templateStrings(session.objectiveIds) || !session.objectiveIds.includes(id)) {
            issue(`${specPath}.requiredMasteryObjectiveIds`, 'mastery requirements must reference theory objectives in this session');
          }
        }
      }
    }
    if (session.activityGuidance !== undefined) {
      if (!templateRecord(session.activityGuidance) || Object.keys(session.activityGuidance).length === 0) {
        issue(`${sessionPath}.activityGuidance`, 'activityGuidance must contain learning activity instructions');
      } else {
        templateKeys(session.activityGuidance, TEMPLATE_ACTIVITIES, `${sessionPath}.activityGuidance`, issue);
        for (const [activity, text] of Object.entries(session.activityGuidance)) {
          if (!templateText(text) || !templateRecord(session.blocks) || !templateInteger(session.blocks[activity], 1, 120)) {
            issue(`${sessionPath}.activityGuidance.${activity}`, 'guidance must describe a scheduled positive-minute activity');
          }
        }
      }
    }
    if (!templateEnum(session.sessionType, ['theory', 'practice', 'review'])) issue(`${sessionPath}.sessionType`, 'invalid session type');
    const phase = typeof session.phase === 'string' ? phases.get(session.phase) : undefined;
    const phaseIndex = TEMPLATE_PHASES.findIndex((value) => value === session.phase);
    if (phase === undefined || phaseIndex < previousPhase) issue(`${sessionPath}.phase`, 'session phase must exist and not move backwards');
    previousPhase = Math.max(previousPhase, phaseIndex);
    if (session.sessionType === 'practice' && session.phase !== 'guided_practice') issue(`${sessionPath}.sessionType`, 'practice sessions require the guided_practice phase');
    const lessonMinutes = schedule.lessonMinutes;
    if (session.durationMinutes !== lessonMinutes) issue(`${sessionPath}.durationMinutes`, 'session duration must match schedule');
    if (!templateStrings(session.objectiveIds) || session.objectiveIds.length === 0 || session.objectiveIds.length > 4 || new Set(session.objectiveIds).size !== session.objectiveIds.length) {
      issue(`${sessionPath}.objectiveIds`, 'session objectives must be non-empty and unique');
    } else for (const id of session.objectiveIds) {
      if (!objectives.has(id) || !templateStrings(phase?.objectiveIds) || !phase.objectiveIds.includes(id)) issue(`${sessionPath}.objectiveIds`, `objective ${id} must belong to session phase`);
      covered.add(id);
    }
    const blocks = session.blocks;
    const sessionDuration = schedule.lessonMinutes;
    if (!templateRecord(blocks) || TEMPLATE_ACTIVITIES.some((key) => !templateInteger(blocks[key], 0, sessionDuration))
      || Object.keys(blocks).some((key) => !TEMPLATE_ACTIVITIES.some((activity) => activity === key))) {
      issue(`${sessionPath}.blocks`, 'blocks must contain five non-negative integer minute values');
    } else {
      const total = Object.values(blocks).reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
      if (total !== sessionDuration) issue(`${sessionPath}.blocks`, 'block minutes must total session duration');
      for (const activity of ['review', 'theory', 'check', 'reflect']) {
        if (!templateInteger(blocks[activity], 1, sessionDuration)) issue(`${sessionPath}.blocks.${activity}`, 'required learning blocks must have positive integer minutes');
      }
      if (session.phase === 'guided_practice' ? blocks.practice === 0 : blocks.practice !== 0) {
        issue(`${sessionPath}.blocks.practice`, 'practice minutes must match the gated practice phase');
      }
    }
    if (session.checkpoint !== undefined && (!templateRecord(session.checkpoint)
      || !isGateConditionId(session.checkpoint.requiredGate) || session.checkpoint.requiredGate !== phase?.gateCondition)) {
      issue(`${sessionPath}.checkpoint`, 'checkpoint must request the matching phase owner gate');
    }
    if (templateRecord(session.checkpoint)) templateKeys(session.checkpoint, ['requiredGate'], `${sessionPath}.checkpoint`, issue);
    if (session.interactiveSpec !== undefined) {
      const interactive = session.interactiveSpec;
      if (templateRecord(interactive)) templateKeys(interactive, ['enabled', 'domainTopic', 'allowHypothesisPrediction'], `${sessionPath}.interactiveSpec`, issue);
      if (!templateRecord(interactive) || typeof interactive.enabled !== 'boolean' || !templateText(interactive.domainTopic)
        || typeof interactive.allowHypothesisPrediction !== 'boolean') issue(`${sessionPath}.interactiveSpec`, 'invalid interactive specification');
    }
  }
  for (const id of objectives.keys()) if (!covered.has(id)) issue(`${path}.sessions`, `objective ${id} is not scheduled`);
}

export function parseProjectTemplateSpec(input: unknown): ProjectTemplateSpec {
  const result = validateProjectTemplateSpec(input);
  if (!result.valid) throw new ProjectTemplateSpecError(result.errors);
  // Every required and optional contract field has been checked at this boundary.
  return input as ProjectTemplateSpec;
}

