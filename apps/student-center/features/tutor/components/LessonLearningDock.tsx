'use client';

import type { TutorProjectContext } from '@qitu/contracts';
import { LessonLearningWorkspace } from './CurrentLessonCard';
import { LessonAssessmentCard } from './LessonAssessmentCard';
import { LessonCoursewareCard } from './LessonCoursewareCard';
import { LessonCollaborationCard } from './LessonCollaborationCard';
import { LessonNextStep } from './LessonNextStep';
import styles from './LessonLearningDock.module.css';
import { DialogueLessonPanel } from './DialogueLessonPanel';

export function LessonLearningDock({ projectId, lesson, refreshKey, disabled, onChanged, open, onOpenChange }: {
  projectId: string; lesson: NonNullable<TutorProjectContext['lesson']>; refreshKey: unknown;
  disabled: boolean; onChanged(): Promise<void>;
  onExplain?(message: string): void;
  onOpenRecords?(): void;
  open?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const identity = `${projectId}:${lesson.planId}:${lesson.planRevision}:${lesson.learningSessionId}`;
  return <details className={styles.dock} aria-label="本课记录与评价" open={open}
    onToggle={event => onOpenChange?.(event.currentTarget.open)}>
    <summary><span>第 {lesson.lessonIndex} 课 · 本课记录与评价</span><small>{lesson.progression === 'dialogue.v1' ? '查看课时记录与团队协作' : '保存表达、查看反馈与完成当前活动'}</small></summary>
    <div className={styles.content}>
      {lesson.progression !== 'dialogue.v1' ? <LessonLearningWorkspace projectId={projectId} lesson={lesson} refreshKey={refreshKey}
        disabled={disabled} onProgressChanged={onChanged} /> : <p>回答、观察和最终交付在中间学习区完成；此处查看课表、历史与团队协作。</p>}
      <LessonCollaborationCard key={`collaboration:${identity}`} projectId={projectId} lesson={lesson}
        disabled={disabled} onChanged={() => { void onChanged(); }} />
    </div>
  </details>;
}

export function LessonTeachingWorkspace({ projectId, lesson, refreshKey, disabled, onChanged, onExplain, onOpenRecords }: Parameters<typeof LessonLearningDock>[0]) {
  const identity = `${projectId}:${lesson.planId}:${lesson.planRevision}:${lesson.learningSessionId}`;
  return <section aria-label="本课学习区">
    {lesson.progression === 'dialogue.v1' ? <DialogueLessonPanel key={`dialogue:${identity}:${lesson.currentActivity?.activityId}`} projectId={projectId} lesson={lesson}
      refreshKey={refreshKey} disabled={disabled} onChanged={onChanged} onExplain={onExplain} />
      : <LessonNextStep lesson={lesson} disabled={disabled} onOpenRecords={onOpenRecords} onExplain={onExplain} />}
    {lesson.teachingMode === 'zero-base.v1' ? <LessonCoursewareCard key={`courseware:${identity}`} projectId={projectId} lesson={lesson} refreshKey={refreshKey}
      disabled={disabled} onChanged={onChanged} onExplain={onExplain} /> : null}
    <LessonAssessmentCard key={`assessment:${identity}`} projectId={projectId} lesson={lesson}
      disabled={disabled} onChanged={onChanged} onExplain={onExplain} />
  </section>;
}
