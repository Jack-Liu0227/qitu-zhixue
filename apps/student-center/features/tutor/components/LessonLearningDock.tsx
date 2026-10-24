'use client';

import type { TutorProjectContext } from '@qitu/contracts';
import { LessonLearningWorkspace } from './CurrentLessonCard';
import { LessonAssessmentCard } from './LessonAssessmentCard';
import { LessonCoursewareCard } from './LessonCoursewareCard';
import { LessonCollaborationCard } from './LessonCollaborationCard';
import styles from './LessonLearningDock.module.css';

export function LessonLearningDock({ projectId, lesson, refreshKey, disabled, onChanged, onExplain }: {
  projectId: string; lesson: NonNullable<TutorProjectContext['lesson']>; refreshKey: unknown;
  disabled: boolean; onChanged(): Promise<void>;
  onExplain?(message: string): void;
}) {
  const identity = `${projectId}:${lesson.planId}:${lesson.planRevision}:${lesson.learningSessionId}`;
  return <details className={styles.dock} aria-label="本课记录与评价">
    <summary><span>第 {lesson.lessonIndex} 课 · 本课记录与评价</span><small>保存表达、查看反馈与完成当前活动</small></summary>
    <div className={styles.content}>
      <LessonLearningWorkspace projectId={projectId} lesson={lesson} refreshKey={refreshKey}
        disabled={disabled} onProgressChanged={onChanged} />
      <LessonCollaborationCard key={`collaboration:${identity}`} projectId={projectId} lesson={lesson}
        disabled={disabled} onChanged={() => { void onChanged(); }} />
    </div>
  </details>;
}

export function LessonTeachingWorkspace({ projectId, lesson, refreshKey, disabled, onChanged, onExplain }: Parameters<typeof LessonLearningDock>[0]) {
  const identity = `${projectId}:${lesson.planId}:${lesson.planRevision}:${lesson.learningSessionId}`;
  return <section aria-label="本课学习区">
    {lesson.teachingMode === 'zero-base.v1' ? <LessonCoursewareCard key={`courseware:${identity}`} projectId={projectId} lesson={lesson} refreshKey={refreshKey}
      disabled={disabled} onChanged={onChanged} onExplain={onExplain} /> : null}
    <LessonAssessmentCard key={`assessment:${identity}`} projectId={projectId} lesson={lesson}
      disabled={disabled} onChanged={onChanged} onExplain={onExplain} />
  </section>;
}
