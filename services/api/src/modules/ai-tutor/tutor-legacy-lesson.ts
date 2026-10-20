import { isObjectiveMastered } from '@qitu/ai-client';
import type { TutorProjectContext } from '@qitu/contracts';
import type { LearningPlanStore } from '../learning-plan/learning-plan.store';

/** Compatibility projection for governed projects without TeachingBundle. */
export async function resolveLegacyTutorLesson(
  store: LearningPlanStore | undefined, projectId: string, studentId: string,
): Promise<NonNullable<TutorProjectContext['lesson']> | null> {
    if (!store) return null;
    const plan = (await store.listPlansByStudent(studentId)).find((candidate) => candidate.projectId === projectId);
    if (!plan) return null;
    const bundle = await store.findBundle(plan.id);
    if (!bundle || bundle.sessions.length === 0) return null;
    const objectiveById = new Map(bundle.objectives.map((objective) => [objective.id, objective]));
    const incomplete: boolean[] = [];
    for (const session of bundle.sessions.slice().sort((left, right) => left.index - right.index)) {
      let pending = session.theoryObjectiveIds.length === 0 && session.practiceObjectiveIds.length === 0;
      for (const objectiveId of [...session.theoryObjectiveIds, ...session.practiceObjectiveIds]) {
        const objective = objectiveById.get(objectiveId);
        if (!objective) continue;
        const mastery = await store.findMastery(studentId, objectiveId);
        if (!mastery || !isObjectiveMastered(objective.type, {
          score: mastery.masteryBasisPoints / 10_000,
          qualitativeMastered: mastery.qualitativeMastered,
        })) pending = true;
      }
      incomplete.push(pending);
    }
    const currentIndex = incomplete.findIndex(Boolean);
    const index = currentIndex === -1 ? incomplete.length - 1 : currentIndex;
    const session = bundle.sessions.slice().sort((left, right) => left.index - right.index)[index];
    if (!session) return null;
    return {
      lessonIndex: session.lessonIndex ?? session.index + 1,
      lessonCount: plan.lessonCount ?? bundle.sessions.length,
      title: session.title ?? `第 ${session.lessonIndex ?? session.index + 1} 课时`,
      status: currentIndex === -1 ? 'completed' : 'current',
      checkpoint: null,
    };
}
