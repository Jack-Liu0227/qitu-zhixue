import type { ProjectStage } from './project.js';

/**
 * Shared growth-record model (growth-spec.md §3) — STUDENT projection only.
 *
 * The server growth model is projected differently for 学生 / 家长 / 班主任;
 * these types express the STUDENT projection. They are deliberately narrower
 * than the shared model: no `summaryParent`, `summaryMentor`, `riskSignal`,
 * `visibility`, or audit fields, and `StudentGrowthEntryType` cannot even
 * represent a guardian/mentor/tutor/escalation entry.
 */

/** The four growth categories the child may see (growth-spec.md §6). */
export type StudentGrowthEntryType =
  | 'project_stage_completed'
  | 'artifact_published'
  | 'reflection_created'
  | 'objective_mastered';

export type StudentGrowthIcon = 'stage' | 'artifact' | 'reflection' | 'objective';

/**
 * 服务端认可的成长证据来源种类——**封闭集合**（growth-spec.md §4.7）。
 *
 * 证据引用统一编码为 `${sourceKind}:${opaqueId}`，只有这里列出的种类才被
 * 服务端白名单接受。原始 AI 对话、语音转写、内部风险标签都不在集合内，因此
 * 它们不可能伪装成证据引用进入学生视图。这里没有任何分数 / 排名 / 百分位 /
 * 等级语义。
 */
export type GrowthEvidenceSourceKind =
  | 'student_answer'
  | 'theory_check'
  | 'artifact'
  | 'reflection'
  | 'project_event'
  | 'mastery_event'
  /** Opaque owned Tutor turn locator; never raw text or proof of mastery. */
  | 'learning_interaction'
  | 'intent_confirmation'
  | 'experiment_observation'
  | 'help_request';

/** Versioned, closed contract exchanged between projection workers and Growth owners. */
export const GROWTH_PROJECTION_CONTRACT_VERSION = 'qitu.growth-projection.v1' as const;
export type GrowthProjectionType = 'learner_profile' | 'growth_trajectory';
export type GrowthProjectionConfidence = 'low' | 'medium' | 'high';

export interface StudentLearningAnalysisStatus {
  status: 'accepted' | 'pending' | 'unavailable';
  policyVersion: string | null;
  observedThrough: string | null;
  sourceEventId: string | null;
  pendingReason: string | null;
}

export interface StudentGrowthTrajectoryProjection extends GrowthTrajectoryProjectionResult {
  observedThrough: string | null;
  policyVersion: string | null;
}

export interface StudentGrowthAnalysis {
  trajectory: StudentGrowthTrajectoryProjection | null;
  analysis: StudentLearningAnalysisStatus;
}
export type StudentGrowthAnalysisView = StudentGrowthAnalysis;

/** Global Admin-owned purpose bindings. IDs are exact shared Admin/runtime identities. */
export interface GrowthProjectionSettings {
  profileAssistantId: string | null;
  growthAssistantId: string | null;
}

export interface GrowthProjectionSettingsView {
  revision: number;
  settings: GrowthProjectionSettings;
  assistants: Array<{ id: string; displayName: string }>;
  /** Identity readiness only; this does not assert a successful model or event route. */
  readiness: Record<'profile' | 'growth', 'ready' | 'unconfigured' | 'disabled_or_missing'>;
  pendingPolicy: 'proposed';
}

export interface GrowthProjectionSettingsUpdate {
  expectedRevision: number;
  settings: GrowthProjectionSettings;
}

export function parseGrowthProjectionSettings(value: unknown): GrowthProjectionSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = ['profileAssistantId', 'growthAssistantId'] as const;
  if (Object.keys(row).some((key) => !keys.includes(key as typeof keys[number]))) return null;
  if (keys.some((key) => row[key] !== null && (typeof row[key] !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(row[key])))) return null;
  return { profileAssistantId: row.profileAssistantId as string | null, growthAssistantId: row.growthAssistantId as string | null };
}

export interface LearnerProfileProjectionResult {
  version: number;
  priorKnowledge: string | null;
  targetLevel: string | null;
  timeBudgetMinutesPerWeek: number | null;
  preferences: string[];
  interests: string[];
  strengths: string[];
  nextQuestions: string[];
}

export interface GrowthTrajectoryProjectionResult {
  version: number;
  milestones: string[];
  strengths: string[];
  nextQuestions: string[];
  studentSummary: string | null;
  evidenceRefs: string[];
  confidence: GrowthProjectionConfidence | null;
}

export type GrowthProjectionResult =
  | LearnerProfileProjectionResult
  | GrowthTrajectoryProjectionResult;

/** Opaque worker input. It deliberately has no conversation/body/content fields. */
export interface GrowthProjectionWorkerInput {
  contractVersion: typeof GROWTH_PROJECTION_CONTRACT_VERSION;
  studentUserId: string;
  projectId: string | null;
  sourceEventId: string;
  sourceTopic: string;
  evidenceRefs: string[];
  sourceMetadata: Record<string, string | number | boolean | null>;
}

export interface GrowthProjectionValidation {
  ok: boolean;
  code?:
    | 'PROJECTION_TYPE_INVALID'
    | 'PROJECTION_RESULT_INVALID'
    | 'PROJECTION_UNKNOWN_FIELD'
    | 'PROJECTION_EVIDENCE_INVALID';
  errors: string[];
  value?: GrowthProjectionResult;
}

const GROWTH_EVIDENCE_RE = /^(student_answer|theory_check|artifact|reflection|project_event|mastery_event|help_request|learning_interaction|intent_confirmation|experiment_observation):[A-Za-z0-9._:-]{1,180}$/u;
const PROFILE_KEYS = [
  'version', 'priorKnowledge', 'targetLevel', 'timeBudgetMinutesPerWeek',
  'preferences', 'interests', 'strengths', 'nextQuestions',
] as const;
const TRAJECTORY_KEYS = [
  'version', 'milestones', 'strengths', 'nextQuestions', 'studentSummary',
  'evidenceRefs', 'confidence',
] as const;

/** Prompt contract shares the owner's complete field allow-list; no model-invented wrapper. */
export function growthProjectionResultSchema(type: GrowthProjectionType): Record<string, unknown> {
  const version = { type: 'integer', minimum: 1 };
  const text = { type: ['string', 'null'], pattern: '^\\s*[\\s\\S]{0,1000}\\s*$' };
  const list = { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 240, pattern: '\\S' } };
  const properties = type === 'learner_profile' ? {
    version, priorKnowledge: text, targetLevel: text,
    timeBudgetMinutesPerWeek: { type: ['integer', 'null'], minimum: 0, maximum: 10080 },
    preferences: list, interests: list, strengths: list, nextQuestions: list,
  } satisfies Record<typeof PROFILE_KEYS[number], Record<string, unknown>> : {
    version, milestones: list, strengths: list, nextQuestions: list, studentSummary: text,
    evidenceRefs: { type: 'array', minItems: 1, maxItems: 20,
      items: { type: 'string', pattern: GROWTH_EVIDENCE_RE.source } },
    confidence: { type: ['string', 'null'], enum: ['low', 'medium', 'high', null] },
  } satisfies Record<typeof TRAJECTORY_KEYS[number], Record<string, unknown>>;
  return {
    type: 'object', additionalProperties: false,
    description: 'Return exactly these top-level fields. Include every required field, use null or [] for empty values, and add no wrapper, commentary, metadata or other fields.',
    required: [...(type === 'learner_profile' ? PROFILE_KEYS : TRAJECTORY_KEYS)], properties,
  };
}

export function isGrowthEvidenceRef(value: unknown): value is string {
  return typeof value === 'string' && GROWTH_EVIDENCE_RE.test(value);
}

/** Filters evidence to the closed, opaque-ref allow-list without exposing input text. */
export function normalizeGrowthEvidenceRefs(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isGrowthEvidenceRef).map((ref) => ref.trim()))].slice(0, max);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, allowNull = false): value is string | null {
  return (allowNull && value === null) || (typeof value === 'string' && value.trim().length <= 1000);
}

function boundedList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 20
    && value.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 240);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

/** Strict runtime validation used by the domain owner before accepting model output. */
export function validateGrowthProjectionResult(
  projectionType: string,
  candidate: unknown,
): GrowthProjectionValidation {
  if (projectionType !== 'learner_profile' && projectionType !== 'growth_trajectory') {
    return { ok: false, code: 'PROJECTION_TYPE_INVALID', errors: ['projectionType'] };
  }
  if (!isPlainRecord(candidate)) {
    return { ok: false, code: 'PROJECTION_RESULT_INVALID', errors: ['result'] };
  }
  const keys = projectionType === 'learner_profile' ? PROFILE_KEYS : TRAJECTORY_KEYS;
  if (!hasOnlyKeys(candidate, keys)) {
    return { ok: false, code: 'PROJECTION_UNKNOWN_FIELD', errors: ['unknown_field'] };
  }
  const errors: string[] = [];
  if (!Number.isInteger(candidate.version) || (candidate.version as number) < 1) errors.push('version');
  if (projectionType === 'learner_profile') {
    if (!boundedString(candidate.priorKnowledge, true)) errors.push('priorKnowledge');
    if (!boundedString(candidate.targetLevel, true)) errors.push('targetLevel');
    if (candidate.timeBudgetMinutesPerWeek !== null
      && (!Number.isInteger(candidate.timeBudgetMinutesPerWeek) || (candidate.timeBudgetMinutesPerWeek as number) < 0 || (candidate.timeBudgetMinutesPerWeek as number) > 10080)) errors.push('timeBudgetMinutesPerWeek');
    for (const key of ['preferences', 'interests', 'strengths', 'nextQuestions'] as const) {
      if (!boundedList(candidate[key])) errors.push(key);
    }
  } else {
    for (const key of ['milestones', 'strengths', 'nextQuestions'] as const) {
      if (!boundedList(candidate[key])) errors.push(key);
    }
    if (!boundedString(candidate.studentSummary, true)) errors.push('studentSummary');
    if (!Array.isArray(candidate.evidenceRefs) || candidate.evidenceRefs.length === 0 || candidate.evidenceRefs.length > 20 || candidate.evidenceRefs.some((ref) => !isGrowthEvidenceRef(ref))) errors.push('evidenceRefs');
    if (candidate.confidence !== null && candidate.confidence !== 'low' && candidate.confidence !== 'medium' && candidate.confidence !== 'high') errors.push('confidence');
  }
  if (errors.length > 0) return { ok: false, code: errors.includes('evidenceRefs') ? 'PROJECTION_EVIDENCE_INVALID' : 'PROJECTION_RESULT_INVALID', errors };
  return { ok: true, errors, value: candidate as unknown as GrowthProjectionResult };
}

/**
 * 观察状态——**封闭两值**（growth-spec.md §4.7 验收标准）。
 *
 * 当一条结论没有证据支撑时必须落到 `pending_observation`，界面据此渲染
 * 「待观察」，而**不是** 0 分、负面结论或任何形式的默认判定。该状态由服务端
 * 根据证据有无推导，客户端不可写入。
 */
export type GrowthObservationState = 'observed' | 'pending_observation';

/**
 * Positive, process-oriented counts only (growth-spec.md §3.3, §6).
 * There is deliberately no score, rank, grade, or percentile anywhere.
 */
export interface StudentGrowthSummary {
  streakDays: number;
  projectsCompleted: number;
  objectivesMastered: number;
  artifactsPublished: number;
}

/**
 * One timeline row, student projection only (growth-spec.md §8 C2).
 *
 * `summaryStudent` is always strength-based. `encouragement` is a
 * server-computed, pre-approved child-facing note — never a raw internal risk
 * label. `stage` is the frozen `ProjectStage` contract used ONLY for display;
 * it never drives a gate or permission here.
 *
 * `evidenceIds` are opaque, server-allowlisted references
 * (`sourceKind:opaqueId`) that point back to the original record; they never
 * contain raw conversation / voice content. `observationState` is derived
 * server-side from `evidenceIds` and is the only signal the UI needs to render
 * 「待观察」 instead of a zero.
 */
export interface StudentGrowthEntry {
  id: string;
  type: StudentGrowthEntryType;
  occurredAt: string;
  title: string;
  summaryStudent: string;
  projectId: string | null;
  projectTitle: string | null;
  stage: ProjectStage | null;
  artifactRef: string | null;
  objectiveTitles: string[];
  icon: StudentGrowthIcon;
  encouragement: string | null;
  /** 只读证据引用（`sourceKind:opaqueId`）；服务端白名单产出，可为空数组。 */
  evidenceIds: string[];
  /** 由服务端按证据有无推导；无证据即 `pending_observation`（「待观察」）。 */
  observationState: GrowthObservationState;
}

export type StudentGrowthFilterType = StudentGrowthEntryType | 'all';

/** Read-only timeline query (growth-spec.md §8 C2). */
export interface StudentGrowthQuery {
  type: StudentGrowthFilterType;
  projectId: string | null;
  from: string | null;
  to: string | null;
  cursor: string | null;
  limit: number;
}

export interface StudentGrowthTimeline {
  items: StudentGrowthEntry[];
  nextCursor: string | null;
  hasNext: boolean;
}

export interface GrowthProjectOption {
  id: string;
  title: string;
}

/** Everything one render of `/student/growth` needs from the data layer. */
export interface StudentGrowthPageData {
  summary: StudentGrowthSummary;
  timeline: StudentGrowthTimeline;
  projects: GrowthProjectOption[];
  hasAnyProject: boolean;
}

/* ------------------------------------------------------------------ *
 * 家长投影（家长端读取同一份服务端成长档案的另一个投影）
 *
 * 同步是「构造上成立」的：家长端与学生端读的是服务端**同一个**成长记录存储，
 * 只是投影字段不同。家长投影比学生投影更窄：
 *  - 没有分数 / 排名 / 百分位（同 `StudentGrowthSummary`）
 *  - 没有内部风险标签、没有原始对话或语音
 *  - **没有** `evidenceIds` / `observationState`：这两者是学生端「点回原始
 *    记录 / 待观察」的视图词汇，家长投影按最小可见范围暂不携带
 *  - `summaryParent` 是服务端预审过的、面向家长的措辞
 *
 * ⚠️ 该投影的字段矩阵在 growth-spec.md §4 仍是 UNAPPROVED 提案。
 * 这里只实现「最小可见范围」版本，等评审通过后再扩展。
 * ------------------------------------------------------------------ */

/** 家长可访问的孩子（对象级权限由后端校验，前端不可自行扩展）。 */
export interface ChildRef {
  childId: string;
  displayName: string;
  /** 孩子当前正在进行的项目数；仅用于列表展示。 */
  activeProjectCount: number;
}

export interface ParentGrowthSummary {
  childId: string;
  childDisplayName: string;
  streakDays: number;
  projectsCompleted: number;
  objectivesMastered: number;
  artifactsPublished: number;
  /** 最近一条成长记录的时间；没有记录时为 null。 */
  lastActivityAt: string | null;
}

/**
 * 家长视角的一行。**没有** `icon`（那是学生端的视觉词汇），
 * 也**没有**任何原始对话 / 语音 / 风险标签。
 */
export interface ParentGrowthEntry {
  id: string;
  type: StudentGrowthEntryType;
  occurredAt: string;
  title: string;
  summaryParent: string;
  projectTitle: string | null;
  stage: ProjectStage | null;
  artifactRef: string | null;
}

export interface ParentGrowthTimeline {
  items: ParentGrowthEntry[];
  nextCursor: string | null;
  hasNext: boolean;
}

/** Everything one render of the parent's child-growth view needs. */
export interface ParentGrowthPageData {
  summary: ParentGrowthSummary;
  timeline: ParentGrowthTimeline;
}
