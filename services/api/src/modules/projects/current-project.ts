import type { LearningProjectRecord } from '../learning-plan/learning-plan.store';

/** One deterministic read rule; no mutation and no inferred teaching completion. */
export function orderStudentProjects(projects: LearningProjectRecord[]): LearningProjectRecord[] {
  return [...projects].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));
}

export function currentStudentProject(projects: LearningProjectRecord[]): LearningProjectRecord | null {
  return orderStudentProjects(projects).find((project) => !['completed', 'published', 'exploration'].includes(project.status)) ?? null;
}
