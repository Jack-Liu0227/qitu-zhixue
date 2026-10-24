'use client';

import { useEffect, useState } from 'react';
import type { LearningSessionProgressView, TutorProjectContext } from '@qitu/contracts';
import { useTutorDataSource } from '../TutorDataSourceProvider';
import { LessonHistory } from './LessonHistory';
import { revealExperiment, type savedExperimentLinks } from '../lib/timelinePresentation';

export function ProjectLearningHistory({ projectId, lesson, refreshKey, experiments }: {
  projectId: string; lesson: NonNullable<TutorProjectContext['lesson']>; refreshKey: unknown;
  experiments: ReturnType<typeof savedExperimentLinks>;
}) {
  const source = useTutorDataSource();
  const [progress, setProgress] = useState<LearningSessionProgressView | null>(null);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    let current = true; setError('');
    if (!source.getLessonProgress) { setError('学习记录服务暂不可用。'); return; }
    if (!lesson.planId || !lesson.planRevision) { setError('当前项目尚无可读取的冻结课表。'); return; }
    void source.getLessonProgress(lesson.planId, projectId).then(value => {
      if (value.planRevision !== lesson.planRevision) throw new Error('学习计划版本已变化，请刷新。');
      if (current) setProgress(value);
    }).catch(cause => { if (current) setError(navigator.onLine ? String(cause.message || cause) : '网络已断开，恢复后可继续读取。'); });
    return () => { current = false; };
  }, [source, projectId, lesson.planId, lesson.planRevision, refreshKey, retry]);
  return <section className="qitu-lesson-assessment-card" aria-label="对话中的学习记录">
    <h3>已保存的学习记录</h3>
    <p>课件保留在上方原对话中；回应、观察、作品与评价可按课时回看。</p>
    {experiments.length ? <div role="group" aria-label="已保存动态实验">
      <h4>已保存动态实验</h4>
      <p>选择课时回到原来的动态仿真，可暂停、调节参数和重新演示。</p>
      <ul>{experiments.map(experiment => <li key={experiment.experimentId}>
        <button type="button" className="qitu-button qitu-button-ghost"
          onClick={() => revealExperiment(experiment.experimentId)}>第 {experiment.sessionIndex} 课 · {experiment.title}</button>
      </li>)}</ul>
    </div> : null}
    {!progress && !error ? <p role="status">正在读取学习记录…</p> : null}
    {error ? <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>重试读取学习记录</button></p> : null}
    {progress?.sessions.filter(item => item.lessonIndex <= lesson.lessonIndex).map(item => <details key={item.sessionId}
      onToggle={event => { if (event.currentTarget.open) setOpened(previous => new Set([...previous, item.sessionId])); }}>
      <summary>第 {item.lessonIndex} 课 · {item.title} · {item.status === 'completed' ? '已完成' : '学习中'}</summary>
      {opened.has(item.sessionId) ? <LessonHistory scope={{ projectId, planId: progress.planId,
        planRevision: progress.planRevision, learningSessionId: item.sessionId }} lesson={item}
        refreshKey={item.sessionId === lesson.learningSessionId ? refreshKey : undefined} /> : null}
    </details>)}
  </section>;
}
