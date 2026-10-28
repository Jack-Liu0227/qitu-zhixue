import type { TutorPhaseProjection, TutorProjectContext, TutorReplyBlock } from '@qitu/contracts';

/** Build complete, read-only interaction blocks from the authorized project projection. */
export function buildProjectInteractionBlocks(
  context: TutorProjectContext | null,
): TutorReplyBlock[] {
  if (context?.lesson) return []; // Actual lesson/activity owner replaces the static four-phase courseware.
  if (context?.project === null || context?.project === undefined || !context.phases?.length) return [];

  const theoryGatePassed = context.phases.some(
    (phase) => phase.gateRule === 'TheoryMastered' && phase.gateStatus === 'passed',
  );
  const active = context.phases.find((phase) => phase.status === 'active');
  const visiblePhase = active && isPracticePhase(active) && !theoryGatePassed
    ? context.phases.find((phase) => phase.phaseId === 'concept_mastery')
    : active;
  const blocks: TutorReplyBlock[] = [];

  const boardSteps = context.phases
    .slice()
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((phase) => ({
      caption: phase.name,
      mermaid: `flowchart LR\n  p${phase.orderIndex}["${escapeMermaidLabel(phase.name)}"]`,
    }));
  if (boardSteps.length > 0) {
    blocks.push({
      kind: 'board',
      boardId: `pbl-phases-${context.project.id}`,
      title: '项目阶段图',
      steps: boardSteps,
    });
  }

  if (visiblePhase) {
    const gateType = visiblePhase.gateRule === 'TheoryMastered'
      ? 'TheoryMastered'
      : visiblePhase.gateRule
        ? 'review'
        : 'none';
    const gateStatus = gateType === 'none' ? 'not_required' : visiblePhase.gateStatus;
    blocks.push({
      kind: 'milestone',
      phaseId: visiblePhase.phaseId,
      title: visiblePhase.name,
      deliverables: visiblePhase.requiredDeliverables.map((item) => ({
        id: item.id,
        title: item.title,
        submitted: item.submitted,
      })),
      gate: { type: gateType, status: gateStatus },
    });
  }

  // Formal experiment actions require a frozen lesson scope and server-issued action instance.
  // Phase/title/version labels alone never authorize a tool or claim saved evidence.
  return blocks;
}

function isPracticePhase(phase: TutorPhaseProjection): boolean {
  return phase.phaseId === 'guided_practice';
}

function escapeMermaidLabel(value: string): string {
  return value
    .replace(/[<>|;]/gu, ' ')
    .replaceAll('"', ' ')
    .replaceAll('`', ' ')
    .replaceAll('[', ' ')
    .replaceAll(']', ' ')
    .replaceAll('{', ' ')
    .replaceAll('}', ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 120);
}
