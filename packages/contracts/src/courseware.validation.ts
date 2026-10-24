/** This validates opt-in content policy, never a runtime authorization grant. */
export function validateLessonTeachingSpec(session: Record<string, unknown>, path: string, issue: (path: string, message: string) => void): void {
  const raw = session.teachingSpec;
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!object(raw) || Object.keys(raw).some(k => !['version', 'concepts', 'sourceRequired', 'courseware'].includes(k))
    || raw.version !== 'zero-base.v1' || raw.sourceRequired !== true || raw.courseware !== 'reviewed-with-project-generation.v1'
    || !Array.isArray(raw.concepts) || raw.concepts.length < 1 || raw.concepts.length > 8
    || !Array.isArray(session.objectiveIds) || !Array.isArray(session.requiredToolIds)
    || !['tutor.propose_courseware_activity', 'knowledge_search', 'knowledge_read'].every(id => (session.requiredToolIds as unknown[]).includes(id))
    || !Array.isArray(session.requiredSkillIds) || !session.requiredSkillIds.includes('pbl-courseware-guidance')) {
    issue(`${path}.teachingSpec`, 'zero-base teaching requires concepts, verified sources and the courseware capability'); return;
  }
  if (!object(session.blocks) || !Array.isArray(session.activityRequirements)
    || ['review', 'theory'].some(activity => Number((session.blocks as Record<string, unknown>)[activity]) > 0
      && !(session.activityRequirements as unknown[]).some(requirement => object(requirement)
        && requirement.activity === activity && requirement.evidence === 'teaching_delivery'))) {
    issue(`${path}.activityRequirements`, 'zero-base content activities require explicit teaching delivery receipts');
  }
  const ids = new Set<string>();
  for (const concept of raw.concepts) {
    if (!object(concept) || Object.keys(concept).some(k => !['objectiveId', 'introduction'].includes(k))
      || typeof concept.objectiveId !== 'string' || !session.objectiveIds.includes(concept.objectiveId)
      || ids.has(concept.objectiveId) || typeof concept.introduction !== 'string' || !concept.introduction.trim()
      || concept.introduction.length > 1000) {
      issue(`${path}.teachingSpec.concepts`, 'concepts must reference distinct scheduled objectives and bounded introductions');
    } else ids.add(concept.objectiveId);
  }
  if (session.objectiveIds.some(id => !ids.has(String(id)))) issue(`${path}.teachingSpec.concepts`, 'each scheduled objective needs a teaching introduction');
}
