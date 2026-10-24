import { ConflictException } from '@nestjs/common';
import type { LessonActivity, TutorLessonProgram } from '@qitu/contracts';
import type { TutorTeachingContext } from './tutor-teaching-context';

const ACTIVITIES: readonly LessonActivity[] = ['review', 'theory', 'check', 'practice', 'reflect'];

/** Consume frozen content, never mutable task titles or client lesson numbers. */
export function projectTutorLessonProgram(context: TutorTeachingContext): TutorLessonProgram {
  const profile = context.bundle.template.curriculum?.profiles.find(entry => entry.id === context.bundle.scheduleProfileId);
  const lesson = profile?.sessions.find(entry => entry.sessionIndex === context.session.lessonIndex);
  if (!lesson || context.session.id !== `${context.planId}:${lesson.id}`) {
    throw new ConflictException({ code: 'PROJECT_TEACHING_SESSION_INVALID', message: '当前课时与冻结教案不一致' });
  }
  return {
    ...(lesson.teachingSpec ? { teachingSpec: lesson.teachingSpec } : {}),
    ...(context.lesson.currentActivity !== undefined ? { currentActivity: context.lesson.currentActivity } : {}),
    templateVersionId: context.bundle.templateVersionId, planId: context.planId, planRevision: context.planRevision,
    learningSessionId: context.session.id, lessonIndex: lesson.sessionIndex, title: lesson.title,
    learningGoal: lesson.learningGoal ?? lesson.title,
    objectiveIds: lesson.objectiveIds.map(id => `${context.planId}:${id}`),
    activities: ACTIVITIES.filter(kind => lesson.blocks[kind] > 0).map(kind => ({
      kind, minutes: lesson.blocks[kind], guidance: lesson.activityGuidance?.[kind] ?? lesson.learningGoal ?? lesson.title,
    })),
    evidenceRequirements: [...lesson.evidenceRequirements ?? []], completion: lesson.completionSpec ?? null,
    checkpoint: lesson.checkpoint?.requiredGate ?? null,
  };
}
