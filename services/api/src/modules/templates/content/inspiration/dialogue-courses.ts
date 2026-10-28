import { findGovernancePolicy, parseProjectTemplateSpec, type PblTemplateSession } from '@qitu/contracts';
import { INSPIRATION_COURSES } from './index';
import type { InspirationCourse } from './course-builder';

/** New identities only. Preserve each actual course's concepts, materials, safety and rubric. */
export function dialogueInspirationCourse(source: InspirationCourse): InspirationCourse {
  const slug = `${source.slug}-dialogue`, profileId = `${slug}-8x60-v1`, teamId = `team-${slug}`;
  const assistantIds = [`${slug}-concept`, `${slug}-practice`, `${slug}-review`] as const;
  const policy = findGovernancePolicy('rubric-dialogue:v1');
  if (!policy) throw new Error('DIALOGUE_GOVERNANCE_POLICY_MISSING');
  const oldSessions = source.spec.curriculum!.profiles[0]!.sessions;
  const sessions: PblTemplateSession[] = oldSessions.map((original, index) => {
    if (original.completionSpec?.version !== 'learning-session-completion.v2') throw new Error('DIALOGUE_SOURCE_COMPLETION_REQUIRED');
    const final = index === oldSessions.length - 1, mastery = original.completionSpec.requiredMasteryObjectiveIds;
    const oldReview = original.completionSpec.qualityReview;
    const session: PblTemplateSession = { ...structuredClone(original), id: `${slug}-session-${index + 1}`,
      progression: 'dialogue.v1', leadAssistantId: assistantIds[index <= 2 ? 0 : final ? 2 : 1],
      activityRequirements: final ? [{ activity: 'check', evidence: 'submitted_artifact' }, { activity: 'reflect', evidence: 'session_response' }]
        : [{ activity: 'check', evidence: mastery.length ? 'mastery' : 'session_response' }],
      completionSpec: { version: 'learning-session-completion.v2', requiredMasteryObjectiveIds: mastery,
        requiredEvidence: mastery.length ? [] : final ? [{ kind: 'approved_artifact', scope: 'session', minimumCount: 1 },
          { kind: 'session_response', scope: 'session', minimumCount: 1 }] : [{ kind: 'session_response', scope: 'session', minimumCount: 1 }],
        qualityReview: { ...structuredClone(oldReview), criteria: oldReview.criteria.map(item => ({ ...item, required: true })),
          ...(final ? { artifactCriteria: source.rubric.map(item => ({ id: item.id, description: item.description, required: true })) } : {}) } },
      activityGuidance: { ...original.activityGuidance,
        check: final ? '整理先前已保存的过程记录，确认最终交付版本。评价通过后用问答完成反思。'
          : mastery.length ? original.activityGuidance!.check!
            : `直接用问答保存本课的尝试、解释或实际记录。${original.learningGoal} 尚未发生的观察不能补写；证据不足时如实说明。`,
        reflect: final ? '结合本项目已通过的具体成果，说出一次认识变化、依据与仍有的限制。' : original.activityGuidance!.reflect! },
    };
    if (index === 6) {
      session.checkpoint = { requiredGate: 'practice_evidence_ready' };
      session.title = `${original.title.replace(/提交|交付/gu, '整理')}·过程草稿`;
      session.learningGoal = `${original.learningGoal} 本课在问答中形成过程草稿，最后一课再确认最终交付。`;
    }
    if (!final && session.completionSpec?.version === 'learning-session-completion.v2') delete session.completionSpec.qualityReview.artifactCriteria;
    return session;
  });
  const title = `${source.spec.title}·问答版`;
  const spec = parseProjectTemplateSpec({ ...structuredClone(source.spec), title, version: 'v2-8x60-dialogue',
    lessonPolicy: 'lesson-dialogue.v1', teamId, governancePolicyId: policy.id,
    phases: source.spec.phases.map(phase => ({ ...phase,
      assignedAssistantId: phase.phase === 'exploration' || phase.phase === 'concept_mastery' ? assistantIds[0]
        : phase.phase === 'guided_practice' ? assistantIds[1] : assistantIds[2],
      ...(phase.phase === 'guided_practice' ? { gateCondition: 'practice_evidence_ready', evidenceProfile: 'learning_progress' } : {}) })),
    curriculum: { profiles: [{ id: profileId, schedule: source.spec.schedules[0], sessions }] } });
  const bootstrapKey = `inspiration:${slug}:8x60-v1`;
  return { ...source, slug, profileId, teamId, assistantIds, teamName: `${source.teamName}·问答探究`, spec, bootstrapKey,
    roles: [`${source.roles[0]}·问答`, `${source.roles[1]}·问答`, `${source.roles[2]}·问答`],
    templateInput: { ...source.templateInput, slug, title, summary: `${source.templateInput.summary} 过程问答留证，最后一课正式交付。` },
    versionInput: { ...source.versionInput, stages: spec.phases.map(phase => ({ id: phase.phase, label: phase.title })),
      content: { bootstrapKey, pbl: spec, linkedTeamId: teamId } } };
}
export const INSPIRATION_DIALOGUE_COURSES = INSPIRATION_COURSES.map(dialogueInspirationCourse);
