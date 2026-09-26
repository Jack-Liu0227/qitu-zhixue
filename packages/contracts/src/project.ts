/**
 * The server-owned project stage state machine.
 *
 * This union is the single source of truth for stage-gate and authorization
 * decisions. Display projections (see `StageProgressDisplay`) are ILLUSTRATIVE
 * ONLY and must never be read for those decisions.
 */
export type ProjectStage =
  | 'exploration'
  | 'intent_confirmed'
  | 'theory_learning'
  | 'theory_check'
  | 'practice_ready'
  | 'practice_building'
  | 'artifact_review'
  | 'reflection'
  | 'published'
  | 'completed';

/**
 * A single stage of the frozen template used for the stage-progress bar.
 * `id` and `label` come from the frozen template version, not from global
 * constants.
 */
export interface TemplateStage {
  id: string;
  label: string;
}

/**
 * Server-computed, display-only projection of a project's stage progress.
 *
 * ILLUSTRATIVE ONLY — these fields must NEVER be read for an authorization or
 * stage-gate decision. Gates MUST read `ProjectStage` from the server state
 * machine.
 */
export interface StageProgressDisplay {
  currentStageIndex: number;
  stageTotal: number;
  progressPercent: number;
}
