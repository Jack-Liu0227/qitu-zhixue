import type { EvidenceProfile, GateConditionId, PblPhase } from './team-runtime.js';
import { isGateConditionId } from './team-runtime.js';
import type { KnowledgeType } from './learning-plan.js';

/** Versioned contracts for the planned project-based learning workflow. */
export const PBL_LEARNING_CONTRACT_VERSION = 'qitu.pbl-learning.v1' as const;

export type PblDurationWeeks = 4 | 8;
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

/**
 * Legacy calendar schedule. New governed templates are lesson-based and must
 * use `PblLessonSchedule` instead; this shape remains only for old plans and
 * compatibility adapters.
 */
export interface PblSchedule {
  durationWeeks: PblDurationWeeks;
  weeklyMinutes: 120;
  sessionsPerWeek: 1 | 2;
  sessionMinutes: 60 | 120;
}

/** Canonical schedule for templates that are organized only by lesson. */
export interface PblLessonSchedule {
  lessonCount: number;
  lessonMinutes: 60 | 120;
}

export type PblCurriculumSchedule = PblSchedule | PblLessonSchedule;

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

export type PblTemplateSchedule =
  | (PblSchedule & { moduleCount: number; sessionCount?: number })
  | (PblLessonSchedule);

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
  /** All other theme metadata remains in the existing authoritative fields. */
  theme?: { drivingQuestion: string };
  curriculum?: { profiles: readonly PblCurriculumProfile[] };
}

export type PblTemplateSessionType = 'theory' | 'practice' | 'review';

export interface PblTemplateSession {
  id: string;
  sessionIndex: number;
  /** Legacy calendar placement. Omit these fields for lesson-only templates. */
  week?: number;
  session?: number;
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
  schedule: PblCurriculumSchedule;
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
  if (schedule.sessionsPerWeek !== 1 && schedule.sessionsPerWeek !== 2) {
    errors.push('sessionsPerWeek must be 1 or 2');
  }
  if (schedule.sessionMinutes !== 60 && schedule.sessionMinutes !== 120) {
    errors.push('sessionMinutes must be 60 or 120');
  }
  return { valid: errors.length === 0, errors };
}

/** Validate the lesson-only schedule used by the current PBL templates. */
export function validatePblLessonSchedule(schedule: PblLessonSchedule): PblScheduleValidationResult {
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

function isLessonSchedule(value: unknown): value is PblLessonSchedule {
  return templateRecord(value) && 'lessonCount' in value;
}

function templateSchedule(value: unknown): value is PblCurriculumSchedule {
  if (!templateRecord(value)) return false;
  if ('lessonCount' in value || 'lessonMinutes' in value) {
    const lessonCount = value.lessonCount;
    const lessonMinutes = value.lessonMinutes;
    return typeof lessonCount === 'number' && Number.isSafeInteger(lessonCount) && lessonCount >= 1 && lessonCount <= 128
      && (lessonMinutes === 60 || lessonMinutes === 120);
  }
  const durationWeeks = value.durationWeeks;
  const weeklyMinutes = value.weeklyMinutes;
  const sessionsPerWeek = value.sessionsPerWeek;
  const sessionMinutes = value.sessionMinutes;
  return (durationWeeks === 4 || durationWeeks === 8)
    && weeklyMinutes === 120 && (sessionsPerWeek === 1 || sessionsPerWeek === 2)
    && (sessionMinutes === 60 || sessionMinutes === 120)
    && (typeof sessionsPerWeek === 'number' && typeof sessionMinutes === 'number' && sessionsPerWeek * sessionMinutes === weeklyMinutes);
}

function sameSchedule(left: PblCurriculumSchedule, right: PblCurriculumSchedule): boolean {
  if (isLessonSchedule(left) || isLessonSchedule(right)) {
    return isLessonSchedule(left) && isLessonSchedule(right)
      && left.lessonCount === right.lessonCount && left.lessonMinutes === right.lessonMinutes;
  }
  return left.durationWeeks === right.durationWeeks
    && left.sessionsPerWeek === right.sessionsPerWeek
    && left.sessionMinutes === right.sessionMinutes;
}

/** Validate untrusted JSON without changing or filling any teaching content. */
export function validateProjectTemplateSpec(input: unknown): ProjectTemplateValidationResult {
  const errors: ProjectTemplateValidationIssue[] = [];
  const issue = (path: string, message: string): void => { errors.push({ path, message }); };
  if (!templateRecord(input)) return { valid: false, errors: [{ path: 'pbl', message: 'pbl must be an object' }] };
  templateKeys(input, ['contractVersion', 'id', 'version', 'status', 'title', 'description', 'targetDomain', 'ageRange',
    'prerequisites', 'materials', 'safetyRequirements', 'objectives', 'phases', 'schedules', 'finalDeliverableType',
    'rubricId', 'teamId', 'theme', 'curriculum'], 'pbl', issue);
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
    if (isLessonSchedule(value)) {
      templateKeys(value, ['lessonCount', 'lessonMinutes'], path, issue);
      if (!templateInteger(value.lessonCount, 1, 128)) issue(`${path}.lessonCount`, 'lessonCount must be a positive integer');
    } else {
      templateKeys(value, ['durationWeeks', 'weeklyMinutes', 'sessionsPerWeek', 'sessionMinutes', 'moduleCount', 'sessionCount'], path, issue);
      const weekSchedule = value as unknown as PblSchedule & { moduleCount?: unknown; sessionCount?: unknown };
      if (!templateInteger(weekSchedule.moduleCount, 1, 16)) issue(`${path}.moduleCount`, 'moduleCount must be a positive integer');
      if (weekSchedule.sessionCount !== undefined
        && weekSchedule.sessionCount !== weekSchedule.durationWeeks * weekSchedule.sessionsPerWeek) issue(`${path}.sessionCount`, 'sessionCount must match schedule');
    }
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
      }
    }
  }
  return { valid: errors.length === 0, errors };
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
  if (isLessonSchedule(schedule)) {
    templateKeys(schedule, ['lessonCount', 'lessonMinutes'], `${path}.schedule`, issue);
  } else {
    templateKeys(schedule, ['durationWeeks', 'weeklyMinutes', 'sessionsPerWeek', 'sessionMinutes'], `${path}.schedule`, issue);
  }
  if (!schedules.some((value) => sameSchedule(value, schedule))) {
    issue(`${path}.schedule`, 'profile schedule must be approved by template');
  }
  const count = isLessonSchedule(schedule)
    ? schedule.lessonCount
    : schedule.durationWeeks * schedule.sessionsPerWeek;
  if (!Array.isArray(profile.sessions) || profile.sessions.length !== count) { issue(`${path}.sessions`, 'sessions must match schedule count'); return; }
  const ids = new Set<string>();
  const covered = new Set<string>();
  let previousPhase = -1;
  for (const [index, session] of profile.sessions.entries()) {
    const sessionPath = `${path}.sessions[${index}]`;
    if (!templateRecord(session)) { issue(sessionPath, 'session must be an object'); continue; }
    templateKeys(session, ['id', 'sessionIndex', 'week', 'session', 'title', 'phase', 'sessionType', 'objectiveIds',
      'durationMinutes', 'blocks', 'learningGoal', 'activityGuidance', 'evidenceRequirements', 'checkpoint', 'interactiveSpec'], sessionPath, issue);
    if (!templateText(session.id) || ids.has(session.id)) issue(`${sessionPath}.id`, 'session id must be unique');
    else ids.add(session.id);
    if (session.sessionIndex !== index + 1) issue(`${sessionPath}.sessionIndex`, 'sessionIndex must be a contiguous one-based integer');
    if (isLessonSchedule(schedule)) {
      if (session.week !== undefined) issue(`${sessionPath}.week`, 'lesson-only profiles must not contain week');
      if (session.session !== undefined) issue(`${sessionPath}.session`, 'lesson-only profiles must not contain session/day placement');
    } else {
      if (session.week !== Math.floor(index / schedule.sessionsPerWeek) + 1) issue(`${sessionPath}.week`, 'week must match profile schedule');
      if (session.session !== index % schedule.sessionsPerWeek + 1) issue(`${sessionPath}.session`, 'session must match profile schedule');
    }
    if (!templateText(session.title)) issue(`${sessionPath}.title`, 'session title is required');
    if (session.learningGoal !== undefined && !templateText(session.learningGoal)) issue(`${sessionPath}.learningGoal`, 'learningGoal must be non-empty text');
    if (session.evidenceRequirements !== undefined && (!templateStrings(session.evidenceRequirements)
      || session.evidenceRequirements.length === 0 || session.evidenceRequirements.length > 16)) {
      issue(`${sessionPath}.evidenceRequirements`, 'evidenceRequirements must contain 1 to 16 non-empty descriptions');
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
    const lessonMinutes = isLessonSchedule(schedule) ? schedule.lessonMinutes : schedule.sessionMinutes;
    if (session.durationMinutes !== lessonMinutes) issue(`${sessionPath}.durationMinutes`, 'session duration must match schedule');
    if (!templateStrings(session.objectiveIds) || session.objectiveIds.length === 0 || session.objectiveIds.length > 4 || new Set(session.objectiveIds).size !== session.objectiveIds.length) {
      issue(`${sessionPath}.objectiveIds`, 'session objectives must be non-empty and unique');
    } else for (const id of session.objectiveIds) {
      if (!objectives.has(id) || !templateStrings(phase?.objectiveIds) || !phase.objectiveIds.includes(id)) issue(`${sessionPath}.objectiveIds`, `objective ${id} must belong to session phase`);
      covered.add(id);
    }
    const blocks = session.blocks;
    const sessionDuration = isLessonSchedule(schedule) ? schedule.lessonMinutes : schedule.sessionMinutes;
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

