import type { ProjectStage } from './project';

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
  | 'help_request';

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
