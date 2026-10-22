'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  TeacherArtifactReviewItem,
  TeacherArtifactReviewPage,
  TeacherArtifactVersionView,
  TeacherReviewDecision,
} from '@qitu/contracts';
import { Button, SkeletonBlock } from '@qitu/ui';
import { teacherApi, TeacherOfflineError, TeacherPermissionError } from '../lib/teacherApi';
import { reviewVersion } from '../lib/review-version';
import { StudentLessonQualityReviews } from './student-lesson-quality-reviews';

const statusLabels: Record<string, string> = {
  requested: '待审核',
  in_review: '审核中',
  approved: '已通过',
  changes_requested: '需要修改',
  rejected: '未通过',
};

const statusToneMap: Record<string, string> = {
  requested: 'amber',
  in_review: 'blue',
  approved: 'emerald',
  changes_requested: 'blue',
  rejected: 'rose',
};

function errorMessage(error: unknown) {
  if (error instanceof TeacherPermissionError) return '当前账号无权查看或审核该学生的作品，请确认班主任分配。';
  if (error instanceof TeacherOfflineError) return '网络不可用，请恢复连接后重试。';
  return error instanceof Error ? error.message : '作品审核服务暂不可用。';
}

export function StudentArtifactReviews({ studentId }: { studentId: string }) {
  return (
    <>
      <StudentReviewList key={studentId} studentId={studentId} />
      <StudentLessonQualityReviews key={`quality:${studentId}`} studentId={studentId} />
    </>
  );
}

function StudentReviewList({ studentId }: { studentId: string }) {
  const [page, setPage] = useState<TeacherArtifactReviewPage | null>(null);
  const [selected, setSelected] = useState<TeacherArtifactReviewItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current += 1;
    };
  }, []);

  const load = useCallback(async (offset = 0) => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const { data } = await teacherApi.artifactReviews(studentId, offset);
      if (!alive.current || request !== generation.current) return;
      if (!data || !Array.isArray(data.items) || !(data.nextOffset === null || Number.isSafeInteger(data.nextOffset))) {
        throw new Error('审核列表响应不完整，请刷新。');
      }
      setPage((old) => ({
        ...data,
        items: offset > 0 && old
          ? [...old.items, ...data.items.filter((item) => !old.items.some((prior) => prior.reviewId === item.reviewId))]
          : data.items,
      }));
      if (offset === 0) setSelected((old) => data.items.find((item) => item.reviewId === old?.reviewId) ?? null);
    } catch (cause) {
      if (alive.current && request === generation.current) setError(errorMessage(cause));
    } finally {
      if (alive.current && request === generation.current) setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="qtx-card qtx-panel" style={{ marginTop: 16 }} aria-label="学生作品审核">
      <div className="qtx-panel-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="qtx-panel-title">
            <span className="dot" style={{ background: 'var(--qtx-blue)' }} />
            作品审核
          </div>
          <p className="qtx-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
            先阅读送审版本正文，再提交审核结论与修改反馈。
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="qtx-agent-refresh-btn"
          disabled={loading}
          onClick={() => { void load(); }}
          loading={loading}
        >
          刷新
        </Button>
      </div>

      {loading ? (
        <div style={{ padding: '12px 0' }}>
          <p className="qtx-muted" style={{ fontSize: 13, marginBottom: 8 }}>正在读取送审记录…</p>
          <SkeletonBlock lines={3} />
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, color: '#991b1b', fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      {!loading && !error && page?.items.length === 0 ? (
        <div style={{ padding: '28px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '1px dashed #e2e8f0' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📑</div>
          <div style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>暂无已送审作品</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            学生在灵感空间或项目各阶段提交的作品将在此处进入送审列表
          </div>
        </div>
      ) : null}

      {page && page.items.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {page.items.map((item) => {
            const isSelected = selected?.reviewId === item.reviewId;
            const tone = statusToneMap[item.status] ?? 'amber';
            return (
              <div
                key={item.reviewId}
                onClick={() => setSelected(item)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 14px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: isSelected ? 'linear-gradient(135deg, #eff6ff, #f0fdf4)' : '#f8fafc',
                  border: `1px solid ${isSelected ? '#93c5fd' : '#e2e8f0'}`,
                  transition: 'all 0.15s ease',
                  boxShadow: isSelected ? '0 2px 8px rgba(37,99,235,0.08)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 18 }}>📄</span>
                  <strong style={{ fontSize: 13, color: isSelected ? '#1d4ed8' : '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.artifactTitle}
                  </strong>
                </div>
                <span className={`qtx-badge qtx-badge-${tone}`}>
                  {statusLabels[item.status]}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {page?.nextOffset !== null && page?.nextOffset !== undefined ? (
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <Button variant="secondary" size="sm" disabled={loading} onClick={() => { void load(page.nextOffset!); }}>
            加载更多送审作品
          </Button>
        </div>
      ) : null}

      {selected ? (
        <ReviewDetail
          key={selected.reviewId}
          review={selected}
          studentId={studentId}
          disabled={loading || error !== null}
          onSaved={async () => { await load(); }}
        />
      ) : null}
    </section>
  );
}

function ReviewDetail({ review, studentId, disabled, onSaved }: {
  review: TeacherArtifactReviewItem;
  studentId: string;
  disabled: boolean;
  onSaved: () => Promise<void>;
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

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setVersion(null);
    setRead(false);
    setLoading(true);
    setError(null);
    if (!review.versionAvailable || !review.artifactVersionId) {
      setError('该审核记录无法定位原始送审版本，请学生重新送审。');
      setLoading(false);
      return;
    }
    void teacherApi.artifactVersions(review.artifactId).then(({ data }) => {
      if (!active) return;
      setVersion(reviewVersion(review, data));
    }).catch((cause) => {
      if (active) setError(errorMessage(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [review.artifactId, review.artifactVersionId, review.artifactVersionOrdinal, review.versionAvailable, reload]);

  const submit = async () => {
    if (inFlight.current || !version || !read) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const body = { decision, comment: comment.trim() };
    const fingerprint = JSON.stringify([review.reviewId, version.id, body]);
    if (keyRef.current?.fingerprint !== fingerprint) {
      keyRef.current = { fingerprint, key: `review-${globalThis.crypto.randomUUID()}` };
    }
    try {
      const { data } = await teacherApi.decideArtifactReview(review.reviewId, body, keyRef.current.key);
      if (!alive.current) return;
      if (data.reviewId !== review.reviewId || data.studentUserId !== studentId || data.status !== decision) {
        throw new Error('审核回执不一致，请刷新确认结果。');
      }
      setSaved(true);
      await onSaved();
    } catch (cause) {
      if (alive.current) setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      if (alive.current) setPending(false);
    }
  };

  const decidable = ['requested', 'in_review', 'changes_requested'].includes(review.status);

  return (
    <div style={{ display: 'grid', gap: 12, padding: 16, marginTop: 14, background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 14, color: '#1e293b' }}>{review.artifactTitle}</strong>
        {version ? (
          <span className="qtx-badge qtx-badge-blue">版本 {version.ordinal}</span>
        ) : null}
      </div>

      {loading ? <p className="qtx-muted" style={{ fontSize: 13 }}>正在读取送审版本…</p> : null}

      {error ? (
        <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 12 }}>
          <p style={{ margin: '0 0 6px' }}>{error}</p>
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setReload((old) => old + 1)}>
            重新读取版本
          </Button>
        </div>
      ) : null}

      {saved ? (
        <div style={{ padding: '8px 12px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, color: '#065f46', fontSize: 12 }}>
          ✓ 审核结论已由服务端安全保存。
        </div>
      ) : null}

      {version ? (
        <>
          <div style={{ maxHeight: 320, overflow: 'auto', padding: 12, background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 8 }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, lineHeight: 1.6, color: '#334155' }}>
              {version.inlineText}
            </pre>
          </div>

          {decidable && !saved ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: '#334155', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={read}
                  disabled={pending || disabled}
                  onChange={(event) => setRead(event.target.checked)}
                />
                我已完整阅读上述送审版本正文
              </label>

              <div style={{ display: 'grid', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>审核结论</label>
                <select
                  value={decision}
                  disabled={pending || disabled}
                  onChange={(event) => setDecision(event.target.value as TeacherReviewDecision)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#fff',
                    fontSize: 13,
                    color: '#1e293b',
                  }}
                >
                  <option value="changes_requested">需要修改 (退回继续完善)</option>
                  <option value="approved">审核通过 (批准发布)</option>
                  <option value="rejected">未通过 (不符合标准)</option>
                </select>
              </div>

              <div style={{ display: 'grid', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>给学生的反馈建议</label>
                <textarea
                  rows={3}
                  maxLength={2000}
                  placeholder="在此输入指导反馈与论证修正建议..."
                  value={comment}
                  disabled={pending || disabled}
                  onChange={(event) => setComment(event.target.value)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#fff',
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                />
              </div>

              <Button
                variant="primary"
                size="md"
                disabled={pending || disabled || loading || !read || error !== null}
                onClick={() => { void submit(); }}
                loading={pending}
              >
                提交审核结论
              </Button>
            </div>
          ) : (
            <p className="qtx-muted" style={{ fontSize: 12, margin: 0 }}>
              该审核记录已处于终态，结论：<strong>{statusLabels[review.status]}</strong>
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
