import type { TutorLearningScope } from '@qitu/contracts';

export function matchesCurrentLessonScope(value: unknown, expected: TutorLearningScope): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const scope = value as Record<string, unknown>;
  return scope.planId === expected.planId && scope.planRevision === expected.planRevision && scope.learningSessionId === expected.learningSessionId;
}
