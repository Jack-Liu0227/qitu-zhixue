import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { CurrentUser, TutorLearningScope, TutorLessonAssessmentAnswer, TutorLessonAssessmentResult, TutorLessonAssessmentView } from '@qitu/contracts';
import { LearningPlanService } from '../learning-plan/learning-plan.service';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { ProjectLearningLifecycleService } from '../projects/project-learning-lifecycle.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { TutorService } from './tutor.service';

/** Tutor is an adapter; the existing pending-question and mastery owners retain grading. */
@Injectable()
export class TutorLessonAssessmentService {
  constructor(
    private readonly tutor: TutorService,
    private readonly plans: LearningPlanService,
    private readonly store: LearningPlanStore,
    private readonly lifecycle: ProjectLearningLifecycleService,
  ) {}

  async start(actor: CurrentUser, projectId: string, expected: TutorLearningScope): Promise<TutorLessonAssessmentView> {
    const scope = await this.current(actor, projectId, expected, true);
    const pending = await this.store.findAwaitingQuestion(actor.id, scope.planId);
    if (pending?.assessmentType === 'formative') return { projectId, scope, nextStep: null, blockedReason: '请先完成对话中的巩固题，再检查目标理解。' };
    if (pending && pending.sessionId !== scope.learningSessionId) this.conflict();
    const plan = await this.store.findBundle(scope.planId);
    const session = plan?.sessions.find(item => item.id === scope.learningSessionId);
    if (!session || !session.theoryObjectiveIds.length || session.practiceObjectiveIds.length) {
      return { projectId, scope, nextStep: null, blockedReason: '本课通过学习产物或探究证据完成；目标考核适用于理论学习课时。' };
    }
    const nextStep = await this.plans.getNextStep(actor, scope.planId, scope.learningSessionId);
    await this.current(actor, projectId, scope);
    return { projectId, scope, nextStep, blockedReason: null };
  }

  async answer(actor: CurrentUser, projectId: string, input: TutorLessonAssessmentAnswer, key: string): Promise<TutorLessonAssessmentResult> {
    const scope = await this.current(actor, projectId, input);
    if (typeof input.questionId !== 'string' || !input.questionId.trim() || typeof input.answer !== 'string' || !input.answer.trim() || input.answer.length > 8000) {
      throw new BadRequestException({ code: 'TUTOR_ASSESSMENT_INVALID', message: '请提交当前题目的答案。' });
    }
    const pending = await this.store.findPendingQuestion(input.questionId);
    if (!pending || pending.studentUserId !== actor.id || pending.planId !== scope.planId || pending.sessionId !== scope.learningSessionId || pending.assessmentType === 'formative') {
      throw new ConflictException({ code: 'TUTOR_ASSESSMENT_SCOPE_INVALID', message: '题目与当前课时不一致，请重新读取。' });
    }
    const answer = await this.plans.submitAnswer(actor, scope.planId, scope.learningSessionId, { questionId: input.questionId, answer: input.answer }, key);
    if (answer.theoryMastered) await this.lifecycle.syncAfterAnswer(actor, scope.planId,
      hashIdempotentInput('formal.answer.sync', { sessionId: scope.learningSessionId, questionId: input.questionId }, { key }));
    return { projectId, scope, answer };
  }

  private async current(actor: CurrentUser, projectId: string, expected: TutorLearningScope, requireCheck = false): Promise<TutorLearningScope> {
    if (actor.role !== 'student') throw new ForbiddenException('目标考核仅允许学生本人操作');
    if (!Number.isSafeInteger(expected.planRevision) || expected.planRevision < 1 || typeof expected.planId !== 'string' || typeof expected.learningSessionId !== 'string') this.conflict();
    const context = await this.tutor.getProjectContext(projectId, actor.id);
    const lesson = context?.lesson;
    if (context?.project?.id !== projectId || !lesson || lesson.status !== 'current' || lesson.planId !== expected.planId ||
        lesson.planRevision !== expected.planRevision || lesson.learningSessionId !== expected.learningSessionId) this.conflict();
    if (requireCheck && lesson.currentActivity !== undefined && lesson.currentActivity?.kind !== 'check') {
      throw new ConflictException({ code: 'TUTOR_ACTIVITY_CHECK_REQUIRED', message: '请先完成当前活动，再进入本课检查。' });
    }
    return { planId: expected.planId, planRevision: expected.planRevision, learningSessionId: expected.learningSessionId };
  }
  private conflict(): never {
    throw new ConflictException({ code: 'TUTOR_LESSON_CHANGED', message: '当前课时或计划版本已变化，请刷新课时安排。' });
  }
}
