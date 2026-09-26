import type { TutorHintLevel } from '../index';

/**
 * The six pedagogic moves mapped from the tutor page capability entries.
 * `stall_signal` feeds the 4-turn stall window and never produces a hint
 * level by itself.
 */
export type PedagogicMove =
  | 'hint'
  | 'scaffold'
  | 'explain'
  | 'review_work'
  | 'debug_guide'
  | 'stall_signal';

export const PEDAGOGIC_MOVES: readonly PedagogicMove[] = [
  'hint',
  'scaffold',
  'explain',
  'review_work',
  'debug_guide',
  'stall_signal',
];

/** Hint-level policy: the ladder runs 1..5 and starts at 1. */
export const HINT_LEVEL_MIN: TutorHintLevel = 1;
export const HINT_LEVEL_MAX: TutorHintLevel = 5;

/** `hint` and `debug_guide` may rise to level 3 at most. */
export const HINT_PATH_MAX_LEVEL: TutorHintLevel = 3;

/** `scaffold` produces level 4 (2–6 steps). */
export const SCAFFOLD_LEVEL: TutorHintLevel = 4;

/** Level 5 is reachable ONLY through the `explain` move. */
export const EXPLAIN_ONLY_LEVEL: TutorHintLevel = 5;

/** The hint level rises by at most one per turn. */
export const MAX_HINT_RISE_PER_TURN = 1;

/**
 * Single-question continuous-guidance cap: turns 1..6 may receive guidance;
 * turn 7 must switch topic or escalate instead.
 */
export const CONTINUOUS_GUIDANCE_TURN_CAP = 6;

/** Four-turn stall window that feeds the mentor escalation path. */
export const STALL_WINDOW_SIZE = 4;
