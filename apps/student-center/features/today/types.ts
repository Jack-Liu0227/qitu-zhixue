/**
 * Page view types for the student "今天" (Today) home.
 *
 * These mirror the read-only projections from the (still `gap`) student API
 * endpoints C1–C3 in the module spec. Server-owned values are annotated and
 * MUST NOT be written by the client — this module only reads and renders.
 */
import type { ProjectStage } from '@qitu/contracts';

export type TodayTaskStatus = 'todo' | 'done';

/** C1 projection: a single current-stage task. */
export interface TodayTask {
  id: string;
  projectId: string;
  /** Frozen-template stage id this task belongs to (server-computed). */
  stageId: string;
  stageName: string;
  title: string;
  description: string;
  /** Server-computed; `true` renders the 「今日重点」 badge. */
  isTodayFocus: boolean;
  /** Server-computed completion; the client only navigates, never completes. */
  status: TodayTaskStatus;
  /** Server-computed CTA target route (Q6 pending); `null` renders no CTA. */
  actionTarget: string | null;
}

/** C1 projection: server-computed AI suggestion (Q3 pending). Read-only. */
export interface TodaySuggestion {
  id: string;
  title: string;
  body: string;
  computedAt: string;
}

/** C1 projection: "从一个想法开始" direction card (Q2 pending). Read-only. */
export interface IdeaDirection {
  templateId: string;
  title: string;
  subtitle: string;
  coverUrl: string;
  href: string;
}

/** C1 projection: quick-start entry (Q4 pending). No write is issued by default. */
export interface QuickStartInfo {
  enabled: boolean;
  mode: 'voice' | 'navigate';
  exploreHref: string;
}

/** C1 projection: server-computed growth stats (Q1/Q3 pending). Read-only. */
export interface LearningStats {
  streakDays: number;
  tasksCompletedThisWeek: number;
  projectsInProgress: number;
}

/** C1 `GET /api/v1/students/me/today`. */
export interface TodayView {
  date: string;
  greetingName: string;
  avatarUrl: string | null;
  hasActiveProject: boolean;
  tasks: TodayTask[];
  suggestion: TodaySuggestion | null;
  directions: IdeaDirection[];
  quickStart: QuickStartInfo;
  stats: LearningStats | null;
}

export interface ProjectStageView {
  index: number;
  /** Frozen-template stage id, used only for display-side task filtering. */
  stageId: string;
  name: string;
  status: 'done' | 'active' | 'pending';
}

/** C2 `GET /api/v1/students/me/active-project`. `null` data drives the empty state. */
export interface ActiveProjectSummary {
  id: string;
  title: string;
  subtitle: string;
  coverUrl: string;
  templateVersionId: string;
  /**
   * Server state-machine value. Reserved for stage-gate reads — never derive or
   * overwrite it client-side.
   */
  stage: ProjectStage;
  /** Display-only projections. NEVER used for authorization / gate decisions. */
  stageIndex: number;
  stageTotal: number;
  progressPercent: number;
  stages: ProjectStageView[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  createdAt: string;
  targetHref: string | null;
}

/** C3 `GET /api/v1/students/me/notifications?unread=true`. Read-only. */
export interface NotificationList {
  unreadCount: number;
  items: NotificationItem[];
}
