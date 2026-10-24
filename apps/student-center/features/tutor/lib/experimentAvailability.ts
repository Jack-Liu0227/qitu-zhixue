import type { TutorProjectContext, TutorReplyBlock } from '@qitu/contracts';

type Experiment = Extract<TutorReplyBlock, { kind: 'optics_experiment' }>;
type Lesson = NonNullable<TutorProjectContext['lesson']>;
type Context = {
  project?: Pick<NonNullable<TutorProjectContext['project']>, 'stage'> | null;
  lesson?: Pick<Lesson, 'status' | 'planId' | 'planRevision' | 'learningSessionId' | 'currentActivity'> | null;
};

/** Display availability only. Every write still goes through the experiment owner. */
export function experimentReadOnlyReason(block: Experiment, context?: Context): string | null {
  const stage = context?.project?.stage;
  if (stage && ['artifact_review', 'reflection', 'published', 'completed'].includes(stage)) {
    return '项目已进入作品审核或完成阶段。这里保留实验图样与已保存的记录，供你回看；已运行的课件可以重复演示。';
  }
  if (!block.allowedActions.length) return '这张实验卡片当前仅供回看；已运行的课件可以重复演示。新的观察请在当前课时提交。';
  if (!stage) return '正在核对当前课时，核对完成后再操作实验。';
  if (!['practice_ready', 'practice_building'].includes(stage)) {
    return '请先完成当前理论课的检查、学习记录与课时确认，再进入实验探究。';
  }
  const lesson = context?.lesson;
  if (!lesson || lesson.status !== 'current' || !block.scope || lesson.planId !== block.scope.planId
    || lesson.planRevision !== block.scope.planRevision || lesson.learningSessionId !== block.scope.learningSessionId
    || block.specVersion === '2.0.0' && (lesson.currentActivity?.kind !== 'practice'
      || lesson.currentActivity.activityId !== block.scope.activityId)) {
    return '这张实验卡片属于已经结束或切换的活动。已运行的课件可以重复演示，新的观察请在当前课时提交。';
  }
  return null;
}
