import type {
  ProjectSummary,
  StageProgressDisplay,
  TemplateStage,
  TutorHintLevel,
} from '@qitu/contracts';

/**
 * A single task shown in the left column's 「当前任务」 card.
 *
 * This is a DISPLAY PROJECTION of the server's `/projects/:id/tasks` response,
 * not a client-owned task record and never a mutation target.
 */
export interface TutorCurrentTask {
  id: string;
  title: string;
  detail?: string;
  /** Server signal for today's focus; display only. */
  isTodayFocus: boolean;
}

/**
 * Left-column project context.
 *
 * PURE DISPLAY PROJECTION. `progress` is server-computed
 * (`StageProgressDisplay` is explicitly ILLUSTRATIVE ONLY). Any stage gate must
 * read `project.stage` (`ProjectStage`) from the server state machine — never
 * `progress.currentStageIndex`. See the comment in `ProjectContextPanel.tsx`.
 */
export interface TutorProjectContext {
  project: ProjectSummary;
  progress: StageProgressDisplay;
  stages: TemplateStage[];
  currentTask: TutorCurrentTask | null;
}

export type TutorConnectionStatus = 'idle' | 'connecting' | 'open' | 'offline' | 'closed';

export type TutorLoadStatus = 'loading' | 'ready' | 'empty' | 'error';

export interface TutorViewError {
  message: string;
  /** HTTP status when known (403 → permission denied, 0/undefined → transport/offline). */
  status?: number;
  code?: string;
}

export interface TutorEscalationState {
  escalated: boolean;
  stallCount: number;
  lastHintLevel: TutorHintLevel | null;
}
