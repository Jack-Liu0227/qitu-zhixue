import type { LearningEvidenceProof, LessonActivityProgress, PblTemplateSession } from '@qitu/contracts';

/** Derived from existing evidence/assessment receipts; no parallel activity state store. */
export function projectLessonActivities(input: {
  lesson: PblTemplateSession;
  sessionId: string;
  proofs: readonly LearningEvidenceProof[];
  masteryAccepted: boolean;
  sessionCompleted?: boolean;
  locked?: boolean;
}): LessonActivityProgress[] {
  let blocked = false;
  return (input.lesson.activityRequirements ?? []).map(requirement => {
    const activityId = `${input.sessionId}:activity:${requirement.activity}`;
    const refs = input.proofs.filter(proof => proof.scope.learningSessionId === input.sessionId
      && proof.kind === requirement.evidence
      && (proof.activityId === activityId || requirement.evidence === 'experiment_observation')
      && (input.lesson.checkpoint?.requiredGate !== 'review_completed_and_archived' || requirement.activity !== 'reflect' || proof.sourceKind === 'reflection')
      && proof.quality?.status === 'accepted').map(proof => proof.ref);
    const accepted = requirement.evidence === 'mastery' ? input.masteryAccepted : refs.length > 0;
    const status = input.locked ? 'locked' : input.sessionCompleted || (!blocked && accepted) ? 'completed' : blocked ? 'locked' : 'current';
    if (status !== 'completed') blocked = true;
    return { activityId, kind: requirement.activity, evidence: requirement.evidence, status,
      guidance: input.lesson.activityGuidance?.[requirement.activity] ?? input.lesson.learningGoal ?? input.lesson.title,
      minutes: input.lesson.blocks[requirement.activity], evidenceRefs: refs };
  });
}
