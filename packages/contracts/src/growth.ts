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
