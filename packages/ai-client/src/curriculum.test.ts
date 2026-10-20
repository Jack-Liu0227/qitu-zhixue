import {
  LESSON_COUNT_OPTIONS,
  assertValidCurriculumPlan,
  confirmCurriculumPlan,
  exploreCurriculumInterest,
  generateCurriculumPlan,
  selectNextCurriculumStep,
  toLearningPlanDraft,
  validateCurriculumPlan,
  validateLearningPlanDraft,
} from './curriculum.js';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export function runCurriculumAssertions(): void {
  assert(LESSON_COUNT_OPTIONS.includes(16), '16 lesson option must be available');
  const generated = generateCurriculumPlan({ interest: 'optics', lessonCount: 16, lessonMinutes: 60, seed: 7 });
  assert(generated.plan.sessions.length === 16, 'one session must exist for each lesson');
  assert(generated.plan.sessions.every((session, index) => session.lessonIndex === index + 1), 'lesson indexes must be contiguous');
  assert(validateCurriculumPlan(generated.plan).ok, 'generated plan must validate');
  assertValidCurriculumPlan(generated.plan);
  const draft = toLearningPlanDraft(generated.plan);
  assert(validateLearningPlanDraft(draft).ok, 'lesson projection must validate');
  const confirmed = confirmCurriculumPlan({ plan: generated.plan, projectId: 'project-1', confirmedAt: '2026-01-01T00:00:00.000Z', idempotencyKey: 'confirm-1' });
  assert(confirmed.plan.projectId === 'project-1', 'confirmation must attach project id');
  const next = selectNextCurriculumStep(generated.plan, { masteredObjectiveIds: [] });
  assert(next.sessionIndex === 0, 'selection starts at first lesson');
  const exploration = exploreCurriculumInterest({ interest: 'optics', lessonCount: 16 });
  assert(exploration.lessonCount === 16, 'exploration must preserve lesson count');
}
