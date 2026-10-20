import type { LearningPlanStore, LearningProjectRecord, PlanBundle, PendingQuestionRecord } from '../learning-plan/learning-plan.store';
import type { TeachingBundlePayload } from '../templates/teaching-bundle.types';

export function teachingContextFixture(assistantId = 'session-mentor') {
  const project = { id: 'synthetic-project', studentId: 'synthetic-owner', templateVersionId: 'synthetic-template-version', status: 'theory_learning' } as LearningProjectRecord;
  const plan = { id: 'plan-frozen', projectId: project.id, studentUserId: project.studentId,
    templateVersion: project.templateVersionId!, version: 7, status: 'active', lessonCount: 2 } as PlanBundle['plan'];
  const sessions = [1, 2].map((index) => ({
    id: `${plan.id}:lesson-${index}`, planId: plan.id, moduleId: `module-${index}`, index: index - 1, lessonIndex: index,
    title: `Mutable title ${index}`, blocks: [], theoryObjectiveIds: [`${plan.id}:objective-${index}`], practiceObjectiveIds: [], mode: 'study' as const,
  }));
  const objectives = [1, 2].map((index) => ({ id: `${plan.id}:objective-${index}`, planId: plan.id, moduleId: `module-${index}`,
    name: `Task ${index}`, type: 'concept' as const, objective: `Investigate ${index}`, prerequisiteIds: [], ordinal: index }));
  const bundle: PlanBundle = { plan, sessions, objectives, modules: [] };
  const teaching = {
    templateVersionId: project.templateVersionId, scheduleProfileId: 'profile-frozen',
    template: { curriculum: { profiles: [{ id: 'profile-frozen', sessions: [1, 2].map((index) => ({
      id: `lesson-${index}`, sessionIndex: index, title: `Frozen lesson ${index}`, phase: 'concept_mastery', objectiveIds: [`objective-${index}`],
      ...(index === 2 ? { checkpoint: { requiredGate: 'TheoryMastered' } } : {}),
    })) }] } },
    teamVersion: { teamVersionId: 'synthetic-team-version', teamId: 'synthetic-team', leaderAssistantId: assistantId,
      members: [{ memberId: 'member-1', assistantId }] },
    roles: [{ roleSlotId: 'role-frozen', memberId: 'member-1', assistantId, assistantConfigDigest: 'fixed-digest',
      instructions: { roleDefinition: 'Frozen role', agentDefinition: 'FROZEN_TEACHING_INSTRUCTION' },
      modelByPurpose: { dialogue: { modelProviderId: 'chosen-provider', modelId: 'same-model-name', policyVersion: '1' } },
      skills: [], tools: [] }],
    sessionRoutes: [1, 2].map((sessionIndex) => ({ sessionIndex, roleSlotId: 'role-frozen' })), knowledgeGrant: null,
  } as unknown as TeachingBundlePayload;
  let awaiting: PendingQuestionRecord | null = null;
  const mastered = new Set<string>();
  const completed = new Set<string>();
  const store = {
    findProject: async () => project, listPlansByStudent: async () => [plan], findBundle: async () => bundle,
    findAwaitingQuestion: async () => awaiting,
    listSessionCompletions: async () => [...completed].map((learningSessionId) => ({ learningSessionId })),
    findMastery: async (_student: string, objective: string) => mastered.has(objective)
      ? { masteryBasisPoints: 10000, qualitativeMastered: true } : null,
  } as unknown as LearningPlanStore;
  return { project, plan, bundle, teaching, store, mastered, completed,
    setPending: (sessionIndex: number, objectiveIndex = sessionIndex) => { awaiting = {
      studentUserId: project.studentId, planId: plan.id, sessionId: `${plan.id}:lesson-${sessionIndex}`,
      objectiveId: `${plan.id}:objective-${objectiveIndex}`, status: 'awaiting',
    } as PendingQuestionRecord; },
  };
}
