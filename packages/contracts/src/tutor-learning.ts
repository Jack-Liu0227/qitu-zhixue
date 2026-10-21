import type { NextStepView, SubmitAnswerResponse } from './learning-plan.js';

/** Correlation only. The server resolves and checks the current frozen lesson again. */
export interface TutorLearningScope {
  planId: string;
  planRevision: number;
  learningSessionId: string;
}
export interface TutorLessonAssessmentView {
  projectId: string;
  scope: TutorLearningScope;
  nextStep: NextStepView | null;
  blockedReason: string | null;
}
export interface TutorLessonAssessmentAnswer extends TutorLearningScope {
  questionId: string;
  answer: string;
}
export interface TutorLessonAssessmentResult {
  projectId: string;
  scope: TutorLearningScope;
  answer: SubmitAnswerResponse;
}
