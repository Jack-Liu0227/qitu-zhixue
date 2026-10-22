'use client';

import type { TutorProjectContext } from '@qitu/contracts';
import { LessonLearningWorkspace } from './CurrentLessonCard';
import { LessonAssessmentCard } from './LessonAssessmentCard';
import { LessonCollaborationCard } from './LessonCollaborationCard';
import styles from './LessonLearningDock.module.css';

export function LessonLearningDock({ projectId, lesson, refreshKey, disabled, onChanged }: {
  projectId: string; lesson: NonNullable<TutorProjectContext['lesson']>; refreshKey: unknown;
  disabled: boolean; onChanged(): Promise<void>;
}) {
  const identity = `${projectId}:${lesson.planId}:${lesson.planRevision}:${lesson.learningSessionId}`;
  return <details className={styles.dock} aria-label="本课记录与评价">
    <summary><span>第 {lesson.lessonIndex} 课 · 本课记录与评价</span><small>保存表达、查看反馈与完成当前活动</small></summary>
    <div className={styles.content}>
      <LessonAssessmentCard key={`assessment:${identity}`} projectId={projectId} lesson={lesson}
        disabled={disabled} onChanged={onChanged} />
      <LessonLearningWorkspace projectId={projectId} lesson={lesson} refreshKey={refreshKey}
        disabled={disabled} onProgressChanged={onChanged} />
      <LessonCollaborationCard key={`collaboration:${identity}`} projectId={projectId} lesson={lesson}
        disabled={disabled} onChanged={() => { void onChanged(); }} />
    </div>
  </details>;
}
