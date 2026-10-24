'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TutorLessonCollaborationView, TutorProjectContext } from '@qitu/contracts';
import { createIdempotencyKey } from '../idempotency';
import { AsideAdvisorCard } from './AsideAdvisorCard';

export function LessonCollaborationCard({ projectId, lesson, disabled, onChanged }: {
  projectId: string; lesson: NonNullable<TutorProjectContext['lesson']>; disabled: boolean; onChanged(): void;
}) {
  const scope = useMemo(() => ({ planId: lesson.planId ?? '', planRevision: lesson.planRevision ?? 0, learningSessionId: lesson.learningSessionId ?? '' }),
    [lesson.planId, lesson.planRevision, lesson.learningSessionId]);
  const [view, setView] = useState<TutorLessonCollaborationView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef<string | null>(null);
  const changed = useRef(onChanged); changed.current = onChanged;
  const base = `/api/v1/tutor/projects/${encodeURIComponent(projectId)}/lesson/collaboration`;
  async function fetchView(method: 'GET' | 'POST', signal: AbortSignal) {
    const query = new URLSearchParams({ planId: scope.planId, planRevision: String(scope.planRevision), learningSessionId: scope.learningSessionId });
    const response = await fetch(method === 'GET' ? `${base}?${query}` : base, { method, credentials: 'include', signal,
      ...(method === 'POST' ? { headers: { 'content-type': 'application/json', 'idempotency-key': attempt.current! }, body: JSON.stringify(scope) } : {}) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(response.status === 403 ? '当前账号没有本课协作权限。'
      : typeof payload?.message === 'string' ? payload.message : '协作状态暂时无法读取，请重试。');
    const next = payload?.data as TutorLessonCollaborationView | undefined;
    if (!next || !next.scope || next.projectId !== projectId || next.scope.planId !== scope.planId || next.scope.planRevision !== scope.planRevision
      || next.scope.learningSessionId !== scope.learningSessionId || !Array.isArray(next.blocks)) throw new Error('协作回执与当前课时不一致，请刷新。');
    return next;
  }
  const refresh = useRef<() => void>(() => undefined);
  useEffect(() => {
    const identity = ++generation.current; const abort = new AbortController(); controller.current = abort;
    let polls = 0; setError(''); setView(null);
    async function read() {
      try {
        const next = await fetchView('GET', abort.signal);
        if (identity !== generation.current) return;
        setView(next);
        if (['queued', 'running'].includes(next.status) && polls++ < 50) timer.current = setTimeout(() => void read(), 1500);
        else if (next.status === 'ready' || next.status === 'failed') changed.current();
      } catch (failure) { if (!abort.signal.aborted && identity === generation.current) setError(failure instanceof Error ? failure.message : '协作状态读取失败'); }
    }
    refresh.current = () => { if (timer.current) clearTimeout(timer.current); void read(); };
    void read();
    return () => { generation.current++; abort.abort(); if (timer.current) clearTimeout(timer.current); };
  }, [base, scope, reload]);
  async function request() {
    if (disabled || busy) return;
    const signal = controller.current?.signal;
    if (!signal) return;
    attempt.current ??= createIdempotencyKey();
    setBusy(true); setError(''); const identity = generation.current;
    try {
      const next = await fetchView('POST', signal);
      if (identity !== generation.current) return;
      attempt.current = null; setView(next); changed.current(); refresh.current();
    } catch (failure) { if (identity === generation.current && !controller.current?.signal.aborted) setError(failure instanceof Error ? failure.message : '导师协作未确认，请重试。'); }
    finally { if (identity === generation.current) setBusy(false); }
  }
  return <section className="qitu-lesson-assessment-card" aria-label="本课导师协作">
    <strong>让另一位导师帮你看看</strong><p>围绕本课已有的观察和作品，补充一个解释或改进建议。</p>
    {error ? <p role="alert">{error}</p> : null}
    {!view && !error ? <p role="status">正在读取本课协作状态…</p> : null}
    {view?.status === 'queued' || view?.status === 'running' ? <p role="status">协作导师正在准备建议。你可以继续阅读或整理本课证据。</p> : null}
    {view?.status === 'unavailable' ? <p role="status">{lesson.collaborationAvailable === false
      ? '本活动暂未开放协作导师，请跟随当前主讲导师完成学习任务。'
      : '本课协作暂不可用，请查看当前活动和待答题状态，完成后刷新。'}</p> : null}
    {view?.blocks.map((block, index) => block.kind === 'aside' ? <AsideAdvisorCard key={`${block.proposalRef ?? block.evidenceRef}:${index}`} {...block} /> : null)}
    {view?.status === 'ready' && !view.blocks.length ? <p role="status">协作建议已在对话中展示。</p> : null}
    {view && ['idle', 'failed'].includes(view.status) ? <button type="button" className="qitu-button qitu-button-ghost" disabled={disabled || busy}
      onClick={() => void request()}>{busy ? '正在邀请…' : view?.status === 'failed' ? '重新邀请协作导师' : '邀请本课协作导师'}</button> : null}
    <button type="button" className="qitu-button qitu-button-ghost" disabled={disabled || busy} onClick={() => setReload(value => value + 1)}>刷新建议</button>
  </section>;
}
