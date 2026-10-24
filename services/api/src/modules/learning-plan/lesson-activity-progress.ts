import type { CoursewareInstance, LearningEvidenceProof, LessonActivityProgress, PblTemplateSession } from '@qitu/contracts';

/** Derived from existing evidence/assessment receipts; no parallel activity state store. */
export function projectLessonActivities(input: {
  lesson: PblTemplateSession;
  sessionId: string;
  proofs: readonly LearningEvidenceProof[];
  masteryAccepted: boolean;
  teachingDeliveries?: readonly CoursewareInstance[];
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
    const deliveries = (input.teachingDeliveries ?? []).filter(v => v.learningSessionId === input.sessionId
      && v.activityId === activityId && v.acknowledgedAt !== null);
    const taught = new Set(deliveries.flatMap(v => v.objectiveRefs));
    const delivered = !!input.lesson.teachingSpec && input.lesson.teachingSpec.concepts.every(c => taught.has(c.objectiveId));
    if (requirement.evidence === 'teaching_delivery' && delivered) refs.push(...deliveries.map(v => `courseware:${v.id}`));
    const minimumObservations = Math.max(1, ...(input.lesson.completionSpec?.requiredEvidence ?? [])
      .filter(item => item.kind === 'experiment_observation' && item.scope === 'session').map(item => item.minimumCount));
    const observationCount = new Set(refs).size;
    const accepted = requirement.evidence === 'mastery' ? input.masteryAccepted
      : requirement.evidence === 'teaching_delivery' ? delivered
      : requirement.evidence === 'experiment_observation' ? observationCount >= minimumObservations : refs.length > 0;
    const status = input.locked ? 'locked' : input.sessionCompleted || (!blocked && accepted) ? 'completed' : blocked ? 'locked' : 'current';
    if (status !== 'completed') blocked = true;
    const guidance = input.lesson.activityGuidance?.[requirement.activity] ?? input.lesson.learningGoal ?? input.lesson.title;
    const observationGuidance = requirement.evidence === 'experiment_observation'
      ? ` 本活动需保存 ${minimumObservations} 条通过评价的独立观察记录，当前 ${observationCount} / ${minimumObservations} 条。${observationCount < minimumObservations ? '请完成不同参数下的观察并分别保存；同一记录中描述多次运行仍计为一条。' : '观察数量已达标。'}` : '';
    return { activityId, kind: requirement.activity, evidence: requirement.evidence, status,
      guidance: guidance + observationGuidance,
      minutes: input.lesson.blocks[requirement.activity], evidenceRefs: refs };
  });
}
