type VisualStep = { tex?: string; mermaid?: string; svg?: string; nodes?: readonly unknown[] };

/** Keep the preceding illustration available while the learner considers a text-only prompt. */
export function coursewareVisual<T extends VisualStep>(steps: readonly T[], position: number): { step: T; index: number } | null {
  if (!Number.isInteger(position) || position < 0 || position >= steps.length) return null;
  for (let index = position; index >= 0; index--) {
    const step = steps[index]!;
    if (step.tex || step.mermaid || step.svg || step.nodes?.length) return { step, index };
  }
  return null;
}
