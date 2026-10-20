import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CurrentUser, NextStepView, SubmitAnswerResponse } from '@qitu/contracts';
import type { LearningPlanService } from '../learning-plan/learning-plan.service';
import type { LearningPlanStore } from '../learning-plan/learning-plan.store';
import type { TutorService } from './tutor.service';
import { TutorLessonAssessmentService } from './tutor-lesson-assessment.service';

const actor: CurrentUser = { id: 'learner', role: 'student', displayName: 'Synthetic learner', email: 'learner@example.invalid' };
const scope = { planId: 'plan', planRevision: 3, learningSessionId: 'lesson-3' };
const question = { questionId: 'owner-question', prompt: '解释反射角的基准', questionType: 'short' as const, options: [], allowFreeText: true as const, attempt: 1 };
const next: NextStepView = { action: 'probe', objectiveId: 'objective', knowledgeType: 'concept', status: 'new', gate: 'qualitative', mastery: 0,
  threshold: 0.9, reason: '检查理解', theoryMastered: false, practiceUnlocked: false, question };
const grade: SubmitAnswerResponse = { questionId: question.questionId, result: 'correct', isCorrect: true, score: 1, explanation: '角度以法线为基准。',
  errorType: null, remediation: null, mastery: null, theoryMastered: false, practiceUnlocked: false, replayed: false };
function fixture() {
  const calls: unknown[][] = [];
  let pending: Record<string, unknown> | null = null;
  const tutor = { getProjectContext: async (projectId: string, studentId: string) => {
    assert.equal(projectId, 'project'); assert.equal(studentId, actor.id);
    return { project: { id: projectId }, lesson: { ...scope, status: 'current' } };
  } } as unknown as TutorService;
  const plans = { getNextStep: async (...args: unknown[]) => { calls.push(args); return next; },
    submitAnswer: async (...args: unknown[]) => { calls.push(args); return grade; } } as unknown as LearningPlanService;
  const store = {
    findAwaitingQuestion: async () => pending,
    findPendingQuestion: async () => pending,
    findBundle: async () => ({ sessions: [{ id: scope.learningSessionId, theoryObjectiveIds: ['objective'], practiceObjectiveIds: [] }] }),
  } as unknown as LearningPlanStore;
  return { service: new TutorLessonAssessmentService(tutor, plans, store), calls, pending: (value: Record<string, unknown> | null) => { pending = value; } };
}
const code = (expected: string) => (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === expected;

test('Tutor formal check delegates current frozen lesson to the existing question owner', async () => {
  const f = fixture();
  const result = await f.service.start(actor, 'project', scope);
  assert.deepEqual(result.nextStep, next);
  assert.deepEqual(f.calls[0], [actor, scope.planId, scope.learningSessionId]);
  assert.equal(JSON.stringify(result).includes('expectedAnswer'), false);
});

test('stale revision, future lesson and non-student checks never reach the grading owner', async () => {
  const f = fixture();
  for (const patch of [{ planRevision: 2 }, { planRevision: 3.1 }, { planId: 'other' }, { learningSessionId: 'lesson-11' }]) {
    await assert.rejects(f.service.start(actor, 'project', { ...scope, ...patch }), code('TUTOR_LESSON_CHANGED'));
  }
  await assert.rejects(f.service.start({ ...actor, role: 'teacher' }, 'project', scope));
  assert.equal(f.calls.length, 0);
});

test('a pending formative question is preserved instead of being turned into a mastery assessment', async () => {
  const f = fixture();
  f.pending({ assessmentType: 'formative', sessionId: scope.learningSessionId });
  const result = await f.service.start(actor, 'project', scope);
  assert.equal(result.nextStep, null);
  assert.ok(result.blockedReason);
  assert.equal(f.calls.length, 0);
});

test('answers require actual same-student, same-plan, same-session formal question and preserve retry key', async () => {
  const f = fixture();
  const pending = { id: question.questionId, studentUserId: actor.id, planId: scope.planId, sessionId: scope.learningSessionId, assessmentType: 'qualitative' };
  for (const patch of [{ studentUserId: 'another' }, { planId: 'other' }, { sessionId: 'other' }, { assessmentType: 'formative' }]) {
    f.pending({ ...pending, ...patch });
    await assert.rejects(f.service.answer(actor, 'project', { ...scope, questionId: question.questionId, answer: '法线' }, 'stable-key'), code('TUTOR_ASSESSMENT_SCOPE_INVALID'));
  }
  assert.equal(f.calls.length, 0);
  f.pending(pending);
  const result = await f.service.answer(actor, 'project', { ...scope, questionId: question.questionId, answer: '法线' }, 'stable-key');
  assert.deepEqual(result.answer, grade);
  assert.deepEqual(f.calls[0], [actor, scope.planId, scope.learningSessionId, { questionId: question.questionId, answer: '法线' }, 'stable-key']);
});
