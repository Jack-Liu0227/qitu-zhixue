'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TeacherArtifactReviewItem, TeacherArtifactReviewPage, TeacherArtifactVersionView, TeacherReviewDecision } from '@qitu/contracts';
import { teacherApi, TeacherOfflineError, TeacherPermissionError } from '../lib/teacherApi';
import { reviewVersion } from '../lib/review-version';

const statusLabels = { requested: '待审核', in_review: '审核中', approved: '已通过', changes_requested: '需要修改', rejected: '未通过' };
function errorMessage(error: unknown) {
  if (error instanceof TeacherPermissionError) return '当前账号无权查看或审核该学生的作品，请确认班主任分配。';
  if (error instanceof TeacherOfflineError) return '网络不可用，请恢复连接后重试。';
  return error instanceof Error ? error.message : '作品审核服务暂不可用。';
}

export function StudentArtifactReviews({ studentId }: { studentId: string }) {
  return <StudentReviewList key={studentId} studentId={studentId} />;
}

function StudentReviewList({ studentId }: { studentId: string }) {
  const [page, setPage] = useState<TeacherArtifactReviewPage | null>(null);
  const [selected, setSelected] = useState<TeacherArtifactReviewItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current += 1; }; }, []);
  const load = useCallback(async (offset = 0) => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const { data } = await teacherApi.artifactReviews(studentId, offset);
      if (!alive.current || request !== generation.current) return;
      if (!data || !Array.isArray(data.items) || !(data.nextOffset === null || Number.isSafeInteger(data.nextOffset))) throw new Error('审核列表响应不完整，请刷新。');
      setPage((old) => ({ ...data, items: offset > 0 && old
        ? [...old.items, ...data.items.filter((item) => !old.items.some((prior) => prior.reviewId === item.reviewId))] : data.items }));
      if (offset === 0) setSelected((old) => data.items.find((item) => item.reviewId === old?.reviewId) ?? null);
    } catch (cause) {
      if (alive.current && request === generation.current) setError(errorMessage(cause));
    } finally {
      if (alive.current && request === generation.current) setLoading(false);
    }
  }, [studentId]);
  useEffect(() => { void load(); }, [load]);
  return <section style={{ marginTop: 20, borderTop: '1px solid #e2e8f0', paddingTop: 16 }} aria-label="学生作品审核">
    <h3 style={{ fontSize: 14 }}>作品审核</h3>
    <p style={{ fontSize: 12, color: '#64748b' }}>先阅读送审版本正文，再提交审核结论。</p>
    {loading ? <p role="status" aria-busy="true">正在读取审核记录…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" className="qtx-btn" disabled={loading} onClick={() => { void load(); }}>刷新审核记录</button>
    {!loading && page?.items.length === 0 ? <p>暂无已送审作品。</p> : null}
    <ul style={{ paddingLeft: 18 }}>{page?.items.map((item) => <li key={item.reviewId}>
      <button type="button" className="qtx-btn" disabled={loading} onClick={() => setSelected(item)}>{item.artifactTitle} · {statusLabels[item.status]}</button>
    </li>)}</ul>
    {page?.nextOffset !== null && page?.nextOffset !== undefined ? <button type="button" className="qtx-btn" disabled={loading}
      onClick={() => { void load(page.nextOffset!); }}>加载更多</button> : null}
    {selected ? <ReviewDetail key={selected.reviewId} review={selected} studentId={studentId}
      disabled={loading || error !== null} onSaved={async () => { await load(); }} /> : null}
  </section>;
}

function ReviewDetail({ review, studentId, disabled, onSaved }: {
  review: TeacherArtifactReviewItem; studentId: string; disabled: boolean; onSaved: () => Promise<void>;
}) {
  const [version, setVersion] = useState<TeacherArtifactVersionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<TeacherReviewDecision>('changes_requested');
  const [comment, setComment] = useState('');
  const [read, setRead] = useState(false);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  const keyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setVersion(null); setRead(false); setLoading(true); setError(null);
    if (!review.versionAvailable || !review.artifactVersionId) {
      setError('该审核记录无法定位原始送审版本，请学生重新送审。'); setLoading(false); return;
    }
    void teacherApi.artifactVersions(review.artifactId).then(({ data }) => {
      if (!active) return;
      setVersion(reviewVersion(review, data));
    }).catch((cause) => { if (active) setError(errorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [review.artifactId, review.artifactVersionId, review.artifactVersionOrdinal, review.versionAvailable, reload]);
  const submit = async () => {
    if (inFlight.current || !version || !read) return;
    inFlight.current = true; setPending(true); setError(null);
    const body = { decision, comment: comment.trim() };
    const fingerprint = JSON.stringify([review.reviewId, version.id, body]);
    if (keyRef.current?.fingerprint !== fingerprint) keyRef.current = { fingerprint, key: `review-${globalThis.crypto.randomUUID()}` };
    try {
      const { data } = await teacherApi.decideArtifactReview(review.reviewId, body, keyRef.current.key);
      if (!alive.current) return;
      if (data.reviewId !== review.reviewId || data.studentUserId !== studentId || data.status !== decision) throw new Error('审核回执不一致，请刷新确认结果。');
      setSaved(true);
      await onSaved();
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { inFlight.current = false; if (alive.current) setPending(false); }
  };
  const decidable = ['requested', 'in_review', 'changes_requested'].includes(review.status);
  return <div style={{ display: 'grid', gap: 10, padding: 12, marginTop: 12, background: '#f8fafc', borderRadius: 10 }}>
    <strong>{review.artifactTitle}</strong>
    {loading ? <p role="status">正在读取送审版本…</p> : null}
    {error ? <div role="alert"><p>{error}</p><button type="button" disabled={pending} onClick={() => setReload((old) => old + 1)}>重新读取版本</button></div> : null}
    {saved ? <p role="status">审核结论已由服务端保存。</p> : null}
    {version ? <>
      <p>送审版本 {version.ordinal}</p>
      <pre style={{ margin: 0, maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit' }}>{version.inlineText}</pre>
      {decidable && !saved ? <>
        <label><input type="checkbox" checked={read} disabled={pending || disabled} onChange={(event) => setRead(event.target.checked)} /> 我已阅读以上送审版本</label>
        <label>审核结论<select value={decision} disabled={pending || disabled} onChange={(event) => setDecision(event.target.value as TeacherReviewDecision)}>
          <option value="changes_requested">需要修改</option><option value="approved">通过</option><option value="rejected">不通过</option>
        </select></label>
        <label>给学生的反馈<textarea rows={3} maxLength={2000} value={comment} disabled={pending || disabled} onChange={(event) => setComment(event.target.value)} /></label>
        <button type="button" className="qtx-btn" disabled={pending || disabled || loading || !read || error !== null} onClick={() => { void submit(); }}>
          {pending ? '正在保存…' : '提交审核结论'}
        </button>
      </> : <p>该审核记录已处理，结论：{statusLabels[review.status]}</p>}
    </> : null}
  </div>;
}
