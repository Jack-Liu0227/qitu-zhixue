import type { TutorPhaseProjection, TutorProjectContext, TutorReplyBlock } from '@qitu/contracts';

/** Build complete, read-only interaction blocks from the authorized project projection. */
export function buildProjectInteractionBlocks(
  context: TutorProjectContext | null,
): TutorReplyBlock[] {
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

  // Gated practice simulation: Only emit optics interactive experiment if TheoryMastered passed and in practice phase
  const opticsProject = (context.project as typeof context.project & { templateVersionId?: string | null })
    .templateVersionId?.startsWith('optics-physical-inquiry') === true;
  if (theoryGatePassed && active && isPracticePhase(active) && opticsProject) {
    blocks.push({
      kind: 'optics_experiment',
      experimentId: `optics-exp-${context.project.id}`,
      title: '光的散射与衍射动态探究台',
      summary: '单缝衍射图样与微粒散射交互仿真',
      initialMode: 'scattering',
      specVersion: 'optics-experiment.v1',
      objectiveId: 'opt-practice-measure',
      sessionIndex: 10,
      allowedActions: ['set_parameter', 'run', 'record_observation', 'submit_evidence'],
    } as TutorReplyBlock);
  }

  return blocks;
}

function isPracticePhase(phase: TutorPhaseProjection): boolean {
  return phase.phaseId === 'guided_practice' || /practice|实践|制作|动手/i.test(phase.name);
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
