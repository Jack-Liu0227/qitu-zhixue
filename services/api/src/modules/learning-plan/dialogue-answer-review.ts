import { ServiceUnavailableException } from '@nestjs/common';
import type { gradeAnswer } from '@qitu/ai-client';
import type { LessonQualityEvaluator } from '../works/lesson-quality-evaluator';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import type { PlanBundle, PendingQuestionRecord } from './learning-plan.store';

/** A new-contract semantic second look at keyword rejections. Only the assessment owner commits the result. */
export async function reviewDialogueAnswer(input: { bundle: PlanBundle; pending: PendingQuestionRecord; answer: string;
  grade: ReturnType<typeof gradeAnswer>; bindings?: TemplateBindingService; evaluator?: LessonQualityEvaluator }) {
  const { bundle, pending, grade } = input;
  if (grade.isCorrect || pending.assessmentType !== 'qualitative' || pending.options.length || !input.bindings || !bundle.plan.projectId) return { grade };
  const teaching = await input.bindings.getFrozenTeachingBundle(bundle.plan.projectId, bundle.plan.templateVersion);
  if (teaching.template.lessonPolicy !== 'lesson-dialogue.v1') return { grade };
  const lesson = teaching.template.curriculum?.profiles.find(profile => profile.id === teaching.scheduleProfileId)?.sessions
    .find(session => `${bundle.plan.id}:${session.id}` === pending.sessionId);
  if (!lesson || !lesson.completionSpec?.requiredMasteryObjectiveIds.some(id => `${bundle.plan.id}:${id}` === pending.objectiveId)) return { grade };
  try {
    if (!input.evaluator) throw new Error('Evaluator unavailable');
    const id = 'current-question-understanding';
    const candidate = await input.evaluator.evaluate({ lesson, activityId: `${pending.sessionId}:activity:check`,
      activity: { activity: 'check', evidence: 'mastery' }, kind: 'session_response', content: input.answer, evidence: [],
      criteria: [{ id, description: `只核对当前题目：${pending.prompt}。参考答案表达的必要含义：${pending.expectedAnswer}。允许正确的口语、简短解释、同义表达及提示后的理解，不要求复述措辞；只说已懂、照抄指令或含有关键概念错误不能通过。`, required: true }] });
    if (candidate.criteria.length !== 1 || candidate.criteria[0]?.criterionId !== id || typeof candidate.criteria[0].meets !== 'boolean') throw new Error('Invalid candidate');
    return { grade: candidate.criteria[0].meets ? { ...grade, result: 'correct' as const, isCorrect: true, score: 1, errorType: null, remediation: null }
      : { ...grade, remediation: candidate.criteria[0].feedback },
      semanticReview: { policy: 'dialogue-answer.v1', providerId: candidate.providerId, modelId: candidate.modelId, accepted: candidate.criteria[0].meets } };
  } catch { throw new ServiceUnavailableException({ code: 'FORMAL_ANSWER_EVALUATION_UNAVAILABLE', message: '这道题暂未完成评价，尚未计分。请保留答案重试，或继续请求提示。' }); }
}
