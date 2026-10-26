import type { TutorReplyBlock, TutorTurn } from '@qitu/contracts';

/** Keep lesson controls with a completed reply while the next response streams. */
export function learningActivityTurnId(turns: readonly TutorTurn[], streamingTurnId: string | null): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role === 'assistant' && turn.turnId !== streamingTurnId && turn.blocks.length > 0) return turn.turnId;
  }
  return null;
}

export function retainCoursewareSelection(selected: string, previous: readonly string[], next: readonly string[]): string {
  if (selected && next.includes(selected) && selected !== previous.at(-1)) return selected;
  return next.at(-1) ?? '';
}

export function firstExperimentTurns(turns: readonly TutorTurn[]): ReadonlyMap<string, string> {
  const first = new Map<string, string>();
  for (const turn of turns) for (const raw of turn.blocks) {
    if (!raw || typeof raw !== 'object') continue;
    const block = raw as TutorReplyBlock;
    if (block.kind === 'optics_experiment' && typeof block.experimentId === 'string'
      && !first.has(block.experimentId)) first.set(block.experimentId, turn.turnId);
  }
  return first;
}

export function experimentAnchor(id: string): string { return `saved-experiment-${encodeURIComponent(id)}`; }

export function savedExperimentLinks(turns: readonly TutorTurn[]) {
  const saved = new Map<string, { experimentId: string; sessionIndex: number; title: string }>();
  for (const turn of turns) for (const block of turn.blocks) {
    if (block?.kind === 'optics_experiment' && block.specVersion === '2.0.0' && !saved.has(block.experimentId)) {
      saved.set(block.experimentId, { experimentId: block.experimentId, sessionIndex: block.sessionIndex, title: block.title });
    }
  }
  return [...saved.values()];
}

export function revealExperiment(id: string): void {
  const target = document.getElementById(experimentAnchor(id));
  if (target instanceof HTMLDetailsElement) target.open = true;
  target?.querySelector('summary')?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
