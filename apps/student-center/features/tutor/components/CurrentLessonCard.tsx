'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearningSessionProgressView, TutorProjectContext } from '@qitu/contracts';
import { useTutorDataSource } from '../TutorDataSourceProvider';
import { LessonWorkPanel } from './LessonWorkPanel';
import { lessonBlockerLabel } from './lessonBlockers';
import { LessonHistory } from './LessonHistory';
import { createIdempotencyKey } from '../idempotency';

interface CurrentLessonCardProps {
  projectId: string;
  lesson: TutorProjectContext['lesson'];
  refreshKey?: unknown;
  onProgressChanged: () => Promise<void>;
  disabled?: boolean;
}

export function CurrentLessonCard(props: CurrentLessonCardProps) {
  const planId = props.lesson?.planId;
  return (
    <section className="qitu-tutor-phase-tree qitu-tutor-current-lesson" aria-label="课时安排">
      <div className="qitu-tutor-phase-tree-heading"><div><span>LESSON PLAN</span><h3>课时安排</h3></div></div>
      {planId ? <LessonProgressPanel key={`${props.projectId}:${planId}`} {...props} planId={planId} mode="schedule" />
        : <div className="qitu-tutor-phase-details"><p>当前项目尚无可读取的冻结课表，请刷新项目或联系老师。</p></div>}
    </section>
  );
}

export function LessonLearningWorkspace(props: CurrentLessonCardProps) {
  const planId = props.lesson?.planId;
  if (!planId) return null;
  return <section className="qitu-tutor-lesson-workspace" aria-label="当前课时学习任务">
    <LessonProgressPanel key={`${props.projectId}:${planId}`} {...props} planId={planId} mode="work" />
  </section>;
}

function LessonProgressPanel({ projectId, planId, refreshKey, onProgressChanged, disabled, mode }: CurrentLessonCardProps & { planId: string; mode: 'schedule' | 'work' }) {
  const source = useTutorDataSource();
  const [progress, setProgress] = useState<LearningSessionProgressView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [syncPending, setSyncPending] = useState<{ planRevision: number; key: string } | null>(null);
  const [historySessionId, setHistorySessionId] = useState<string | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; generation.current += 1; };
  }, []);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setStatus('loading');
    setError(null);
    try {
      if (!source.getLessonProgress) throw new Error('当前数据源暂不支持课时进度，请使用已接通的项目教学服务。');
      const result = await source.getLessonProgress(planId, projectId);
      if (!alive.current || request !== generation.current) return;
      setProgress(result);
      setStatus('ready');
    } catch (cause) {
      if (!alive.current || request !== generation.current) return;
      setError(cause instanceof Error ? cause.message : '课时进度读取失败');
      setStatus('error');
    }
  }, [planId, projectId, source]);
  useEffect(() => { void reload(); }, [reload, refreshKey]);

  const refreshWithContext = async () => {
    setStatus('loading');
    setError(null);
    try {
      if (progress?.contractReady && source.reconcileLearning) {
        await source.reconcileLearning(projectId, { planId, planRevision: progress.planRevision }, createIdempotencyKey());
      }
      await onProgressChanged();
      if (alive.current) await reload();
    } catch (cause) {
      if (!alive.current) return;
      setError(cause instanceof Error ? cause.message : '课时与评价刷新失败，请重试。');
      setStatus('error');
    }
  };

  const synchronize = async (planRevision: number, key: string) => {
    const pending = { planRevision, key };
    setSyncPending(pending);
    try {
      if (!source.reconcileLearning) throw new Error('项目进度同步服务暂不可用，请稍后重试。');
      await source.reconcileLearning(projectId, { planId, planRevision }, key);
      if (!alive.current) return;
      setSyncPending(null);
      await onProgressChanged();
      await reload();
    } catch (cause) {
      if (!alive.current) return;
      setError(`学习记录已保存，项目进度尚未同步：${cause instanceof Error ? cause.message : '请重试'}`);
    }
  };
  const current = progress?.sessions.find((item) => item.sessionId === progress.currentSessionId) ?? null;
  return (
    <div className="qitu-tutor-phase-details">
      {mode === 'work' ? <button type="button" disabled={disabled || status === 'loading'} onClick={() => { void refreshWithContext(); }}>刷新课时与评价</button> : null}
      {status === 'loading' ? <p role="status" aria-busy="true">正在读取课时进度…</p> : null}
      {error ? <div role="alert"><p>{error}</p><button type="button" disabled={disabled} onClick={() => {
        if (syncPending) void synchronize(syncPending.planRevision, syncPending.key);
        else if (mode === 'work') void refreshWithContext(); else void reload();
      }}>{syncPending ? '重试同步进度' : '重新读取课表'}</button></div> : null}
      {progress ? <>
        {mode === 'schedule' ? <><p>已完成 {progress.completedCount} / {progress.totalCount} 课时</p>
          <progress aria-label="已完成课时" max={progress.totalCount || 1} value={progress.completedCount} />
          {current ? <p><strong>当前：第 {current.lessonIndex} 课 · {current.title}</strong></p> : null}
          {current?.activities?.length ? <ol className="qitu-lesson-activities" aria-label="本课活动">
            {current.activities.map(activity => <li key={activity.activityId} aria-current={activity.status === 'current' ? 'step' : undefined}>
              <strong>{({ review: '回顾与观察', theory: '概念与示例', check: '检查与补救', practice: '探究任务', reflect: '表达与反思' })[activity.kind]}</strong>
              <span> · {activity.status === 'completed' ? '已完成' : activity.status === 'current' ? '当前活动' : '待解锁'}</span>
              {activity.status === 'current' ? <p>{activity.guidance}</p> : null}
            </li>)}
          </ol> : null}</> : null}
        {!progress.contractReady ? <p role="status">课时任务尚未准备完整，请联系老师检查项目配置。</p> : null}
        {mode === 'schedule' ? <ol className="qitu-lesson-schedule">
          {progress.sessions.map((item) => <li key={item.sessionId} aria-current={item.status === 'current' ? 'step' : undefined}>
            <strong>第 {item.lessonIndex} 课 · {item.title}</strong>
            <span> · {item.status === 'completed' ? '已完成' : item.status === 'current' ? '当前课时' : '待解锁'}</span>
            {item.status !== 'locked' ? <button type="button" aria-expanded={historySessionId === item.sessionId}
              onClick={() => setHistorySessionId(value => value === item.sessionId ? null : item.sessionId)}>
              {historySessionId === item.sessionId ? '收起本课记录' : '查看本课记录'}
            </button> : null}
            {historySessionId === item.sessionId && item.status !== 'locked' ? <LessonHistory
              key={`${projectId}:${planId}:${progress.planRevision}:${item.sessionId}`}
              scope={{ projectId, planId, planRevision: progress.planRevision, learningSessionId: item.sessionId }} lesson={item} /> : null}
            {item.status === 'current' && item.blockers.length ? <ul>{item.blockers.map((reason) => <li key={reason}>{lessonBlockerLabel(reason)}</li>)}</ul> : null}
          </li>)}
        </ol> : null}
        {current && mode === 'work' ? <LessonWorkPanel
          key={`${current.sessionId}:${progress.planRevision}:${current.activities?.find(activity => activity.status === 'current')?.activityId ?? ''}`}
          scope={{ projectId, planId, planRevision: progress.planRevision, learningSessionId: current.sessionId }}
          lesson={current}
          refreshKey={progress}
          disabled={disabled || status !== 'ready' || !progress.contractReady || syncPending !== null}
          onSaved={async (key, reconcile) => {
            if (reconcile) await synchronize(progress.planRevision, `${key}:reconcile`);
            else { await onProgressChanged(); await reload(); }
          }}
          onComplete={async (evidenceRefs, key) => {
            if (!source.completeLesson) throw new Error('课时完成服务暂不可用。');
            const result = await source.completeLesson(planId, current.sessionId,
              { projectId, planRevision: progress.planRevision, evidenceRefs }, key);
            if (!alive.current) return;
            setProgress(result.progress);
            await onProgressChanged();
            await reload();
          }}
        /> : !current && progress.contractReady ? <p role="status">课时安排已完成，项目成果状态仍以服务端审核结果为准。</p> : null}
      </> : status === 'ready' ? <p>暂无课时安排。</p> : null}
    </div>
  );
}
