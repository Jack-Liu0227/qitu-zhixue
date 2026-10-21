'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LessonQualityQueueItem } from '@qitu/contracts';
import { teacherApi, TeacherOfflineError, TeacherPermissionError } from '../lib/teacherApi';

export function StudentLessonQualityReviews({ studentId }: { studentId: string }) {
  const [items, setItems] = useState<LessonQualityQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const [cursors,setCursors] = useState<Array<string|undefined>>([undefined]);
  const [nextCursor,setNextCursor] = useState<string|null>(null);
  const cursor = cursors.at(-1);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError(null);
    try {
      const { data } = await teacherApi.lessonQuality(studentId,cursor);
      if (request !== generation.current) return;
      if (!data || !Array.isArray(data.items) || data.items.some(item => !item.proof?.quality
        || item.proof.scope.planId !== item.planId || item.proof.scope.planRevision !== item.planRevision
        || item.proof.scope.learningSessionId !== item.learningSessionId || !Array.isArray(item.criteria))) {
        throw new Error('课内评价列表响应不完整，请重试。');
      }
      setItems(data.items);
      setNextCursor(data.nextCursor ?? null);
      setNotice(data.unavailablePlans ? '部分课程配置尚未就绪，请联系管理员恢复；其他可用课程仍可评价。'
        : data.hasMore ? '还有其他在学课程，可翻页查看。' : null);
    } catch (cause) {
      if (request !== generation.current) return;
      setItems([]);
      setNextCursor(null);
      setError(cause instanceof TeacherPermissionError ? '无权查看该学生的课内产物。'
        : cause instanceof TeacherOfflineError ? '网络不可用，请恢复连接后重试。'
          : cause instanceof Error ? cause.message : '课内评价暂不可用。');
    } finally { if (request === generation.current) setLoading(false); }
  }, [studentId,cursor]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  return <section aria-label="课内产物质量评价" style={{ marginTop: 20 }}>
    <h3>课内产物质量评价</h3>
    <p>阅读准确版本，逐项核对本课标准。此评价不会直接授予掌握度或批准最终报告。</p>
    <button type="button" disabled={loading} onClick={() => { void load(); }}>刷新课内评价</button>
    {loading ? <p role="status">正在读取待评价产物…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <button disabled={loading || cursors.length < 2} onClick={()=>setCursors([undefined])}>返回评价首页</button>
    <button disabled={loading || !nextCursor} onClick={()=>setCursors(values=>[...values,nextCursor ?? undefined])}>下一组课程</button>
    {!loading && !error && !items.length ? <p>暂无待评价的课内产物。</p> : null}
    {!loading && items.map(item => <QualityReview key={`${studentId}:${item.proof.ref}:${item.proof.quality!.subjectDigest}`}
      item={item} onSaved={load} />)}
  </section>;
}

function QualityReview({ item, onSaved }: { item: LessonQualityQueueItem; onSaved: () => Promise<void> }) {
  const [read, setRead] = useState(false);
  const [values, setValues] = useState<Record<string, { meets?: boolean; feedback: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<{ fingerprint: string; value: string } | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const ready = read && item.criteria.every(criterion => typeof values[criterion.id]?.meets === 'boolean'
    && (values[criterion.id]!.meets || values[criterion.id]!.feedback.trim()));
  const submit = async () => {
    if (!ready || inFlight.current || !item.proof.quality) return;
    inFlight.current = true; setBusy(true); setError(null);
    const body = { planRevision: item.planRevision, evidenceRef: item.proof.ref, subjectDigest: item.proof.quality.subjectDigest,
      criteria: item.criteria.map(criterion => ({ criterionId: criterion.id, meets:values[criterion.id]!.meets!, feedback:values[criterion.id]!.feedback })) };
    const fingerprint = JSON.stringify(body);
    if (key.current?.fingerprint !== fingerprint) key.current = { fingerprint, value: `lesson-quality-${crypto.randomUUID()}` };
    try {
      const { data } = await teacherApi.reviewLessonQuality(item.planId, item.learningSessionId, body, key.current.value);
      if (!alive.current) return;
      const expected = body.criteria.every(criterion => criterion.meets) ? 'accepted' : 'needs_revision';
      if (data.quality?.subjectDigest !== body.subjectDigest || data.quality.status !== expected) throw new Error('评价回执与当前产物不一致，请刷新。');
      await onSaved();
    } catch (cause) {
      if (alive.current) setError(cause instanceof TeacherPermissionError ? '评价权限已变化，请重新读取。'
        : cause instanceof TeacherOfflineError ? '网络不可用，评价结果尚未确认，请重试。'
          : cause instanceof Error && cause.message ? cause.message : '评价未完成，请重试。');
    }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  return <details style={{ marginTop: 12 }}>
    <summary>{item.lessonTitle} · 待评价产物</summary>
    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.content}</pre>
    <label><input type="checkbox" checked={read} disabled={busy} onChange={event => setRead(event.target.checked)} />我已阅读上方待评价版本</label>
    {item.criteria.map(criterion => <fieldset key={criterion.id} disabled={busy}>
      <legend>{criterion.description}</legend>
      <select aria-label={`质量判断：${criterion.description}`} value={typeof values[criterion.id]?.meets === 'boolean' ? String(values[criterion.id]!.meets) : ''}
        onChange={event => setValues(old => ({ ...old, [criterion.id]: { meets: event.target.value === 'true', feedback: old[criterion.id]?.feedback ?? '' } }))}>
        <option value="" disabled>请选择判断</option><option value="true">达到本项要求</option><option value="false">需要补充或修改</option>
      </select>
      <textarea aria-label={`反馈：${criterion.description}`} maxLength={500} value={values[criterion.id]?.feedback ?? ''}
        onChange={event => setValues(old => ({ ...old, [criterion.id]: { meets: old[criterion.id]?.meets, feedback: event.target.value } }))} />
    </fieldset>)}
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" disabled={busy || !ready} onClick={() => { void submit(); }}>{busy ? '正在提交…' : '提交质量评价'}</button>
  </details>;
}
