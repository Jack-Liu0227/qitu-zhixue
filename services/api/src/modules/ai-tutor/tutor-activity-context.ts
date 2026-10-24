import { ConflictException } from '@nestjs/common';
import type { LearningPlanService } from '../learning-plan/learning-plan.service';
import type { EffectiveAgentRuntime, PlatformRegistryService } from '../platform-registry/platform-registry.service';
import type { TutorExperimentService } from './tutor-experiment.service';
import type { TutorTeachingContext } from './tutor-teaching-context';
import type { createTutorKnowledgeAccess } from './tutor-knowledge-access';
import { freezeTutorRuntime, scopeTutorRuntimeToLesson } from './tutor-frozen-runtime';
import { createLessonActivityChannel, type LessonActivityChannel } from './tutor-lesson-activity';
import type { ImaReadEvidence } from './ima-project-scope';
import type { CoursewareService } from '../knowledge/courseware.service';
import { createCoursewareActivityPort, frozenTeachingSpec } from './tutor-courseware-activity';

type Access = ReturnType<typeof createTutorKnowledgeAccess>;
function unavailable(): never {
  throw new ConflictException({ code: 'TUTOR_ACTIVITY_UNAVAILABLE', message: '当前课时、资料或教学权限已变化，请刷新后继续。' });
}

/** Source claims are proven only by this turn's successful, scoped document reads. */
export async function verifyLessonEvidence(access: Access, refs: readonly string[], now = Date.now()): Promise<readonly ImaReadEvidence[]> {
  if (!access.scope || !access.readEvidence || !refs.length || refs.length > 8 || new Set(refs).size !== refs.length
    || !await access.authorize?.('ima_read_document')) unavailable();
  const current = await access.scope.refreshAllowedKnowledgeBaseIds();
  const sources = refs.map((ref) => access.readEvidence!.get(ref));
  if (sources.some((source) => !source || source.expiresAt <= now || !access.scope!.knowledgeBaseIds.includes(source.knowledgeBaseId)
    || !current.includes(source.knowledgeBaseId))) unavailable();
  if (!await access.authorize?.('ima_read_document')) unavailable();
  return sources.map((source) => ({ ...source! }));
}

export async function prepareTutorLessonActivities(input: {
  teaching: TutorTeachingContext | null; runtime: EffectiveAgentRuntime | null;
  projectId: string | null; studentId: string; tutorSessionId: string; idempotencyKey: string;
  knowledgeAccess: Access; registry?: Pick<PlatformRegistryService, 'getAssistantRuntime' | 'isModelAvailable'>;
  questions?: Pick<LearningPlanService, 'readPendingQuestionCandidate' | 'acceptQuestionCandidate'>; experiments?: TutorExperimentService;
  resolve(): Promise<TutorTeachingContext | null>;
  hasQuestion(questionId: string): boolean;
  assessmentPending?: boolean;
  courseware?: CoursewareService;
}): Promise<LessonActivityChannel | undefined> {
  const { teaching, runtime } = input;
  if (!teaching?.objective || !runtime || !input.projectId || !input.registry) return undefined;
  const scope = { projectId: input.projectId, planId: teaching.planId, planRevision: teaching.planRevision,
    learningSessionId: teaching.session.id, objectiveId: teaching.objective.id, tutorSessionId: input.tutorSessionId,
    ...(teaching.lesson.currentActivity ? { activityId: teaching.lesson.currentActivity.activityId } : {}) };
  const actor = { id: input.studentId, role: 'student' as const, email: '', displayName: '' };
  const assessmentObjective = [...teaching.session.theoryObjectiveIds, ...teaching.session.practiceObjectiveIds].includes(teaching.objective.id);
  const pendingQuestion = assessmentObjective ? await input.questions?.readPendingQuestionCandidate(actor, scope) : undefined;
  return createLessonActivityChannel({
    teaching, runtime, scope, idempotencyKey: input.idempotencyKey, pendingQuestion, assessmentPending: input.assessmentPending,
    ...(input.courseware && frozenTeachingSpec(teaching) ? { courseware: createCoursewareActivityPort({
      service: input.courseware, teaching, scope, studentId: input.studentId,
      verify: refs => verifyLessonEvidence(input.knowledgeAccess, refs),
      allowedLibraries: async () => {
        if (!await input.knowledgeAccess.authorize?.('ima_read_document')) unavailable();
        const fresh = await input.knowledgeAccess.scope?.refreshAllowedKnowledgeBaseIds() ?? [];
        return fresh.filter(id => input.knowledgeAccess.scope!.knowledgeBaseIds.includes(id));
      },
    }) } : {}),
    restorePending: !!pendingQuestion && !input.hasQuestion(pendingQuestion.questionId),
    refresh: async () => {
      const fresh = await input.resolve();
      if (!fresh) unavailable();
      return { teaching: fresh, runtime: scopeTutorRuntimeToLesson(freezeTutorRuntime(await input.registry!.getAssistantRuntime(fresh.role.assistantId),
        fresh.role, input.registry!.isModelAvailable(fresh.role.modelByPurpose.dialogue!)), fresh) };
    },
    verifyEvidence: (refs) => verifyLessonEvidence(input.knowledgeAccess, refs),
    ...(assessmentObjective && input.questions ? { acceptQuestion: (candidate, key, verify: (refs: readonly string[]) => Promise<readonly ImaReadEvidence[]>) =>
      input.questions!.acceptQuestionCandidate(actor, scope, candidate, key, verify) } : {}),
    proposeOptics: (candidate, key) => {
      if (!input.experiments) unavailable();
      return input.experiments.propose(input.studentId, scope, candidate, key);
    },
  });
}
