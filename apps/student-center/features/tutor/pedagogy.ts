import type { TutorTurn } from '@qitu/contracts';

export {
  CONTINUOUS_GUIDANCE_TURN_CAP,
  EXPLAIN_ONLY_LEVEL,
  HINT_LEVEL_MAX,
  HINT_LEVEL_MIN,
  HINT_PATH_MAX_LEVEL,
  MAX_HINT_RISE_PER_TURN,
  PEDAGOGIC_MOVES,
  SCAFFOLD_LEVEL,
  STALL_WINDOW_SIZE,
} from '@qitu/ai-client/pedagogy';

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
