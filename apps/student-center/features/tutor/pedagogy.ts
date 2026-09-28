import {
  EXPLAIN_ONLY_LEVEL,
  HINT_LEVEL_MAX,
  HINT_LEVEL_MIN,
  HINT_PATH_MAX_LEVEL,
  MAX_HINT_RISE_PER_TURN,
  PEDAGOGIC_MOVES,
  SCAFFOLD_LEVEL,
  STALL_WINDOW_SIZE,
  CONTINUOUS_GUIDANCE_TURN_CAP,
} from '@qitu/ai-client/pedagogy';
import type { PedagogicMove, TutorHintLevel, TutorTurn } from '@qitu/contracts';

export {
  EXPLAIN_ONLY_LEVEL,
  HINT_LEVEL_MAX,
  HINT_LEVEL_MIN,
  HINT_PATH_MAX_LEVEL,
  MAX_HINT_RISE_PER_TURN,
  PEDAGOGIC_MOVES,
  SCAFFOLD_LEVEL,
} from '@qitu/ai-client/pedagogy';

/** Display-only aliases for the SDK policy. */
export const CONTINUOUS_GUIDANCE_CAP = CONTINUOUS_GUIDANCE_TURN_CAP;
export const STALL_WINDOW = STALL_WINDOW_SIZE;


export type CapabilityKind = 'guidance' | 'scaffold' | 'explain' | 'review' | 'stall';

export interface CapabilityEntry {
  /** Payload sent as the turn's `pedagogicMove`; the server records the final value. */
  move: PedagogicMove;
  label: string;
  description: string;
  /** Render-only summary of the ladder rule; the server enforces it. */
  levelNote: string;
  kind: CapabilityKind;
}

/**
 * Six-entry → `pedagogic_move` mapping, VERBATIM from the module spec
 * (design 6 table). Do not improvise an entry's intent. Order is the visual
 * order of the right-hand 「我可以这样帮你」 rail.
 */
export const CAPABILITY_ENTRIES = [
  {
    move: 'hint',
    label: '给我提示',
    description: '沿着提示阶梯往前走一小步',
    levelNote: '1 → 3，默认从 1 起',
    kind: 'guidance',
  },
  {
    move: 'scaffold',
    label: '帮我拆解',
    description: '拆成 2–6 步，每步一个目标',
    levelNote: '4',
    kind: 'scaffold',
  },
  {
    move: 'explain',
    label: '解释这个概念',
    description: '唯一允许直接讲解的入口',
    levelNote: '5（唯一允许讲解）',
    kind: 'explain',
  },
  {
    move: 'review_work',
    label: '检查我的方案',
    description: '只评审、不代做',
    levelNote: '—',
    kind: 'review',
  },
  {
    move: 'debug_guide',
    label: '帮我调试',
    description: '引导你定位，不给修好的代码',
    levelNote: '1 → 3',
    kind: 'guidance',
  },
  {
    move: 'stall_signal',
    label: '我卡住了',
    description: '计入 4 轮卡顿窗口，必要时升级班主任',
    levelNote: '—',
    kind: 'stall',
  },
] as const satisfies readonly CapabilityEntry[];

/** `hint` and `debug_guide` are the level-climbing guidance paths. */
export function isGuidanceMove(move: PedagogicMove): boolean {
  return move === 'hint' || move === 'debug_guide';
}

/**
 * Level 5 may only ever be produced by `explain`; the UI uses this to decide
 * whether the 5th ladder notch is even reachable.
 */
export function isLevelFiveReachable(move: PedagogicMove): boolean {
  return move === 'explain';
}

/**
 * Next hint level for a requested move, given the previous level of the same
 * question. Mirrors the server policy: rises at most one step, guidance paths
 * cap at 3, scaffold is 4, explain is 5, review/stall yield no level.
 */
export function nextHintLevel(
  previous: TutorHintLevel | null,
  move: PedagogicMove,
): TutorHintLevel | null {
  if (move === 'explain') return EXPLAIN_ONLY_LEVEL;
  if (move === 'scaffold') return SCAFFOLD_LEVEL;
  if (isGuidanceMove(move)) {
    if (previous === null) return HINT_LEVEL_MIN;
    const risen = previous + MAX_HINT_RISE_PER_TURN;
    return (risen > HINT_PATH_MAX_LEVEL ? HINT_PATH_MAX_LEVEL : risen) as TutorHintLevel;
  }
  return null;
}

/** Whether a fresh guidance turn is still inside the continuous-guidance run. */
export function canRequestGuidance(run: number): boolean {
  return run < CONTINUOUS_GUIDANCE_CAP;
}

/**
 * Approximates the per-question continuous-guidance run from server turns.
 *
 * The authoritative question boundary (`questionId`) is an open contract
 * question. Until the server exposes it we count consecutive assistant turns
 * that carry a hint level since the last student turn that carried free text.
 * This is a display/enablement heuristic only; the server remains the enforcer
 * of the 6-turn cap.
 */
export function deriveGuidanceRun(turns: readonly TutorTurn[]): number {
  let run = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn === undefined) continue;
    if (turn.role === 'student') {
      const hasFreeText = turn.blocks.some(
        (block) => block.kind === 'text' && block.text.trim().length > 0,
      );
      if (hasFreeText) break;
      continue;
    }
    if (turn.hintLevel !== null) run += 1;
  }
  return run;
}
