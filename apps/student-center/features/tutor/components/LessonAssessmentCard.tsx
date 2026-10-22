'use client';

import { useEffect, useRef, useState } from 'react';
import type { TutorLearningScope, TutorLessonAssessmentView, TutorLessonAssessmentResult, TutorProjectContext } from '@qitu/contracts';
import { createIdempotencyKey } from '../idempotency';
import { MarkdownMathView } from './MarkdownMathView';

async function request<T>(url: string, body: unknown, signal: AbortSignal, key?: string): Promise<T> {
  const response = await fetch(url, { method: 'POST', credentials: 'include', signal,
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 403 ? '当前账号无权完成这次考核。' :
    typeof payload?.message === 'string' ? payload.message : typeof payload?.detail === 'string' ? payload.detail : '考核暂时无法完成，请重试。');
  return payload?.data as T;
}

/** Uses owner-issued questions; formative chat questions continue through their existing adapter. */
export function LessonAssessmentCard({ projectId, lesson, disabled, onChanged }: {
  projectId: string;
  lesson: NonNullable<TutorProjectContext['lesson']>;
  disabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const [view, setView] = useState<TutorLessonAssessmentView | null>(null);
  const [result, setResult] = useState<TutorLessonAssessmentResult | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const controllers = useRef(new Set<AbortController>());
  const answerKey = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; for (const controller of controllers.current) controller.abort(); };
  }, []);
  if (!lesson.planId || !lesson.planRevision || !lesson.learningSessionId || lesson.status !== 'current') return null;
  if (!lesson.assessmentAvailable && !result) return null;
  const scope: TutorLearningScope = { planId: lesson.planId, planRevision: lesson.planRevision, learningSessionId: lesson.learningSessionId };
  const matches = (value: TutorLearningScope | undefined) => value?.planId === scope.planId &&
    value.planRevision === scope.planRevision && value.learningSessionId === scope.learningSessionId;
  const base = `/api/v1/tutor/projects/${encodeURIComponent(projectId)}/lesson/assessment`;
  const question = view?.nextStep?.question;

  const run = async (work: (controller: AbortController) => Promise<void>) => {
    const controller = new AbortController();
    controllers.current.add(controller); setBusy(true); setError(null);
    try { await work(controller); }
    catch (cause) { if (active.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '考核暂时不可用'); }
    finally { controllers.current.delete(controller); if (active.current) setBusy(false); }
  };
  const start = () => run(async controller => {
    const next = await request<TutorLessonAssessmentView>(base, scope, controller.signal);
    if (next.projectId !== projectId || !matches(next.scope)) throw new Error('考核响应与当前课时不一致，请刷新。');
    if (!active.current) return;
    setView(next); setResult(null); setAnswer(''); answerKey.current = null;
  });
  const submit = () => run(async controller => {
    if (!question) return;
    const signature = `${question.questionId}:${answer}`;
    if (answerKey.current?.signature !== signature) answerKey.current = { signature, key: createIdempotencyKey() };
    const accepted = await request<TutorLessonAssessmentResult>(`${base}/answers`, { ...scope, questionId: question.questionId, answer }, controller.signal, answerKey.current.key);
    if (accepted.projectId !== projectId || !matches(accepted.scope) || accepted.answer.questionId !== question.questionId) throw new Error('作答回执与当前题目不一致，请重试。');
    if (!active.current) return;
    setResult(accepted);
    await onChanged();
  });

  return <section className="qitu-lesson-assessment-card" aria-label="本课目标考核">
    <strong>第 {lesson.lessonIndex} 课 · 检查我的理解</strong>
    <p>解释你的思路，导师会依据目标考核结果继续引导。</p>
    {error ? <p role="alert">{error}</p> : null}
    {lesson.assessmentAvailable !== false && (!view || result) ? <button type="button" className="qitu-button qitu-button-ghost" disabled={disabled || busy} onClick={() => { void start(); }}>
      {busy ? '正在读取…' : result ? '继续检查当前目标' : '开始检查本课理解'}
    </button> : null}
    {view?.blockedReason ? <p role="status">{view.blockedReason}</p> : null}
    {view?.nextStep && !question ? <p role="status">{view.nextStep.action === 'complete'
      ? '当前目标已有掌握证据。请继续提交本课学习产物，完成课时任务。' : view.nextStep.reason}</p> : null}
    {question && !result ? <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <MarkdownMathView content={question.prompt} />
      {question.options.length ? <fieldset disabled={disabled || busy}>
        <legend>选择后说明你的判断，或直接提交所选答案</legend>
        {question.options.map(option => <label key={option.id} style={{ display: 'block', margin: '8px 0' }}>
          <input type="radio" name={`lesson-${question.questionId}`} value={option.id} checked={answer === option.id} onChange={() => setAnswer(option.id)} /> {option.label} {option.body}
        </label>)}
      </fieldset> : <label style={{ display: 'grid', gap: 8 }}>我的解释
        <textarea rows={4} maxLength={8000} value={answer} disabled={disabled || busy} onChange={event => setAnswer(event.target.value)} />
      </label>}
      <button type="submit" className="qitu-button qitu-button-primary" disabled={disabled || busy || !answer.trim()}>{busy ? '正在评阅…' : '提交并查看解析'}</button>
    </form> : null}
    {result ? <div role="status">
      <strong>{result.answer.isCorrect ? '这次解释符合要求' : '这里还可以继续改进'}</strong>
      <MarkdownMathView content={result.answer.explanation} />
      {result.answer.remediation ? <p>{result.answer.remediation}</p> : null}
      <p>{result.answer.theoryMastered ? '本课涉及的理论目标已有有效掌握证据。' : '继续结合反馈检查当前目标。'}</p>
    </div> : null}
  </section>;
}
