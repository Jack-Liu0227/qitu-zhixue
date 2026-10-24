'use client';

import { useEffect, useRef, useState } from 'react';
import type { CoursewareInstance, TutorCoursewareView, TutorProjectContext, CoursewareFeedbackKind } from '@qitu/contracts';
import { MarkdownMathView } from './MarkdownMathView';
import { MermaidView } from './MermaidView';
import { createIdempotencyKey } from '../idempotency';
import { coursewareVisual } from '../lib/coursewareVisual';
import { retainCoursewareSelection } from '../lib/timelinePresentation';
import presentation from './CoursewarePresentation.module.css';

export function LessonCoursewareCard({ projectId, lesson, refreshKey, disabled, onChanged, onExplain }: {
  projectId: string; lesson: NonNullable<TutorProjectContext['lesson']>; refreshKey: unknown; disabled: boolean;
  onChanged(): Promise<void>; onExplain?(message: string): void;
}) {
  const [view, setView] = useState<TutorCoursewareView | null>(null);
  const lastView = useRef<TutorCoursewareView | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [reload, setReload] = useState(0), [selected, setSelected] = useState('');
  const generation = useRef(0), action = useRef<AbortController | null>(null);
  const card = useRef<HTMLElement>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const base = `/api/v1/tutor/projects/${encodeURIComponent(projectId)}/lesson/courseware`;
  useEffect(() => {
    const id = ++generation.current, controller = new AbortController();
    const previous = lastView.current;
    if (previous && (previous.planId !== lesson.planId || previous.planRevision !== lesson.planRevision
      || previous.learningSessionId !== lesson.learningSessionId)) { lastView.current = null; setView(null); setSelected(''); }
    action.current?.abort(); setBusy(false); setLoading(!lastView.current); setError('');
    void fetch(base, { credentials: 'include', signal: controller.signal }).then(async response => {
      const payload = await response.json();
      if ([401, 403].includes(response.status) && id === generation.current) {
        lastView.current = null; setView(null); setSelected('');
      }
      if (!response.ok) throw new Error(response.status === 403 ? '当前账号无权读取本课课件。' : payload.message || '课件暂不可用。');
      const next = payload.data as TutorCoursewareView | null;
      if (next && (next.planId !== lesson.planId || next.planRevision !== lesson.planRevision || next.learningSessionId !== lesson.learningSessionId)) throw new Error('课时已变化，请刷新。');
      if (id === generation.current) {
        const previous = lastView.current?.instances.map(item => item.id) ?? [];
        lastView.current = next; setView(next);
        setSelected(current => retainCoursewareSelection(current, previous, next?.instances.map(item => item.id) ?? []));
      }
    }).catch(cause => { if (!controller.signal.aborted && id === generation.current) setError(navigator.onLine ? String(cause.message || cause) : '网络已断开，恢复连接后可继续。'); })
      .finally(() => { if (id === generation.current) setLoading(false); });
    return () => { controller.abort(); action.current?.abort(); generation.current++; };
  }, [base, lesson.planId, lesson.planRevision, lesson.learningSessionId, refreshKey, reload]);
  const instance = view?.instances.find(v => v.id === selected);
  const currentInstances = view?.instances.filter(v => v.activityId === view.activityId) ?? [];
  const delivered = new Set(view?.instances.filter(v => v.activityId === view.activityId && v.acknowledgedAt).flatMap(v => v.objectiveRefs));
  const remainingConcepts = view?.teaching.concepts.filter(concept => !delivered.has(concept.objectiveId)) ?? [];
  const help = (example: boolean) => {
    if (!instance || !onExplain) return;
    const caption = instance.content.steps[instance.position]?.caption ?? '';
    onExplain(`我正在看《${instance.content.title}》第 ${instance.position + 1} 步：${caption}\n${example
      ? '请针对这一页的概念换一个简单例子，并用有来源的课件演示。'
      : '这一页我还没有理解，请针对这里的概念从基础重新解释，并给出有来源的补讲课件。'}即使我点过看完也请先帮我理解这里，不要直接转到其他概念。`);
  };
  const save = async (current: CoursewareInstance, position: number, continueLearning: boolean, feedback?: CoursewareFeedbackKind) => {
    if (disabled || busy || !view) return;
    const id = generation.current, controller = new AbortController(); action.current = controller;
    const body = { planId: view.planId, planRevision: view.planRevision, learningSessionId: view.learningSessionId,
      instanceId: current.id, position, continueLearning, ...(feedback ? { feedback } : {}) };
    const signature = JSON.stringify(body);
    if (retry.current?.signature !== signature) retry.current = { signature, key: createIdempotencyKey() };
    setBusy(true); setError('');
    try {
      const response = await fetch(`${base}/position`, { method: 'POST', credentials: 'include', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'idempotency-key': retry.current.key }, body: signature });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || '保存失败，请重试。');
      if (generation.current !== id) return;
      const updated = payload.data as CoursewareInstance;
      if (updated.id !== current.id || updated.planId !== view.planId || updated.planRevision !== view.planRevision) throw new Error('课件回执不匹配，请刷新。');
      retry.current = null;
      setView(previous => previous ? { ...previous, instances: previous.instances.map(v => v.id === updated.id ? updated : v) } : null);
      if (continueLearning) await onChanged();
    } catch (cause) { if (!controller.signal.aborted && generation.current === id) setError(navigator.onLine ? (cause instanceof Error ? cause.message : '保存失败，请重试。') : '网络已断开，恢复连接后请重试，已保存的位置会保留。'); }
    finally { if (generation.current === id) setBusy(false); }
  };
  if (!loading && !error && !view) return null;
  const step = instance?.content.steps[instance.position];
  const visual = instance ? coursewareVisual(instance.content.steps, instance.position) : null;
  const visualStep = visual?.step;
  const diagram = visualStep?.nodes ? ['flowchart LR', ...visualStep.nodes.map(node => `qitu_${node.id}["${node.label.replace(/["\[\]{}|;`\\]/gu, ' ').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')}"]`),
    ...(visualStep.edges ?? []).map(edge => `qitu_${edge.from} --> qitu_${edge.to}`)].join('\n') : null;
  return <section ref={card} className={`qitu-lesson-assessment-card ${presentation.fullscreen}`} aria-label="本课课件">
    <div className={presentation.header}><strong className={presentation.eyebrow}>先学一学 · 本课课件</strong>
      {instance ? <button type="button" className="qitu-button qitu-button-ghost" onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void card.current?.requestFullscreen().catch(() => setError('此设备暂不支持全屏，可继续在这里学习。'));
      }}>全屏看课件</button> : null}</div>
    {loading ? <p role="status">正在恢复课件并核验来源…</p> : null}
    {error ? <p role="alert">{error} <button onClick={() => setReload(v => v + 1)} disabled={disabled || busy}>重新读取</button></p> : null}
    {view?.blockedReason ? <p role="status">{view.blockedReason}</p> : null}
    {view && !loading && !error && (view.canPrepare ?? view.canContinue) && !currentInstances.length ? <div role="status">
      <p>{view.instances.length ? '已进入新的学习活动。下面可回看之前的课件，请先准备本活动的课件。' : '本活动还没有课件，请让 AI搭档读取资料并准备讲解。'}</p>
      {onExplain ? <button type="button" className="qitu-button qitu-button-primary" disabled={disabled || busy}
        onClick={() => onExplain('请依据当前课时和当前活动，读取授权资料，准备本活动尚未展示的课件，并带我从基础开始理解。')}>准备本活动课件</button> : null}
    </div> : null}
    {view && view.instances.length > 1 ? <label>课件 <select value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}>
      {view.instances.map(v => <option key={v.id} value={v.id}>{v.content.title}{v.acknowledgedAt ? ' · 已看完' : ''}</option>)}
    </select></label> : null}
    {instance && step ? <>
      <h4>{instance.content.title}</h4><p>第 {instance.position + 1} / {instance.content.steps.length} 步</p>
      <ol className={presentation.steps} aria-label="课件步骤">{instance.content.steps.map((item, index) => <li key={index}>
        <button type="button" disabled={disabled || busy} aria-label={`查看第 ${index + 1} 步：${item.caption}`}
          aria-current={index === instance.position ? 'step' : undefined} onClick={() => void save(instance, index, false)}>{String(index + 1).padStart(2, '0')}</button>
      </li>)}</ol>
      <div className={presentation.caption}><MarkdownMathView content={step.caption} /></div>
      {visual && visual.index !== instance.position ? <p className={presentation.source}>结合第 {visual.index + 1} 步图示思考</p> : null}
      {visualStep?.tex || diagram ? <div key={`${instance.id}:${visual?.index}`} className={presentation.stage}>
        {visualStep?.tex ? <div className={presentation.formula}><MarkdownMathView content={`$$${visualStep.tex}$$`} /></div> : null}
        {diagram ? <MermaidView code={diagram} /> : null}
      </div> : null}
      <p className={presentation.source}>依据：{instance.sources.map(s => s.title).join('、')}</p>
      <details><summary>反馈课件问题</summary>{([['understanding', '有点难懂'], ['science', '内容有疑问'], ['rendering', '图示显示有问题'], ['match', '与本课不匹配'], ['suggestion', '希望换一种讲法']] as const).map(([kind, label]) =>
        <button key={kind} disabled={disabled || busy || instance.feedback?.includes(kind)} onClick={() => void save(instance, instance.position, false, kind)}>
          {instance.feedback?.includes(kind) ? '已记录：' : ''}{label}</button>)}</details>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button className="qitu-button qitu-button-ghost" disabled={disabled || busy || instance.position === 0} onClick={() => void save(instance, instance.position - 1, false)}>上一步</button>
        {instance.position > 0 ? <button className="qitu-button qitu-button-ghost" disabled={disabled || busy} onClick={() => void save(instance, 0, false)}>从头再看</button> : null}
        {instance.position < instance.content.steps.length - 1 ? <button className="qitu-button qitu-button-primary" disabled={disabled || busy} onClick={() => void save(instance, instance.position + 1, false)}>下一步</button>
          : view?.canContinue && instance.activityId === view.activityId && !instance.acknowledgedAt ? <button className="qitu-button qitu-button-primary" disabled={disabled || busy} onClick={() => void save(instance, instance.position, true)}>{busy ? '正在保存…' : '看完了，继续学习'}</button> : null}
      </div>
    </> : null}
    {view && onExplain ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
      {instance?.acknowledgedAt && view.canContinue && remainingConcepts.length > 0 ? <>
        <p>本活动还有 {remainingConcepts.length} 个概念待学习。</p>
        <button className="qitu-button qitu-button-primary" disabled={disabled || busy}
          onClick={() => onExplain(`请接着讲解本活动尚未学完的概念：${remainingConcepts[0]!.introduction}。依据授权资料展示课件，等我看完后再继续。`)}>继续学习下一个概念</button>
      </> : null}
      <button className="qitu-button qitu-button-ghost" disabled={disabled || busy || !instance} onClick={() => help(false)}>再解释一下</button>
      <button className="qitu-button qitu-button-ghost" disabled={disabled || busy || !instance} onClick={() => help(true)}>看一个例子</button>
    </div> : null}
  </section>;
}
