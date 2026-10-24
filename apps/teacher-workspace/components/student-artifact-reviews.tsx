'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  TeacherArtifactReviewItem,
  TeacherArtifactReviewPage,
  TeacherArtifactVersionView,
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
  if (error instanceof TeacherPermissionError) return '当前账号无权查看该学生的作品，请确认班主任分配。';
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
            只读查看历史作品记录；学生作品由服务端自动评价，无需教师审批。
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
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>
          {page.items.map((item) => {
            const isSelected = selected?.reviewId === item.reviewId;
            const tone = statusToneMap[item.status] ?? 'amber';
            return (
              <button
                type="button"
                aria-pressed={isSelected}
                key={item.reviewId}
                onClick={() => setSelected(item)}
                style={{
                  display: 'flex',
                  width: '100%',
                  minWidth: 0,
                  textAlign: 'left',
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 18 }}>📄</span>
                  <strong style={{ fontSize: 13, color: isSelected ? '#1d4ed8' : '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.artifactTitle}
                  </strong>
                </div>
                <span className={`qtx-badge qtx-badge-${tone}`} style={{ flexShrink: 0 }}>
                  {statusLabels[item.status]}
                </span>
              </button>
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

function ReviewDetail({ review }: {
  review: TeacherArtifactReviewItem; studentId: string; disabled: boolean; onSaved: () => Promise<void>;
}) {
  const [version, setVersion] = useState<TeacherArtifactVersionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setVersion(null);
    void teacherApi.artifactVersions(review.artifactId).then(({ data }) => {
      if (active) setVersion(reviewVersion(review, data));
    }).catch(cause => { if (active) setError(errorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [review, reload]);
  return <section className="qtx-card" style={{ padding: 16 }}>
    <strong>{review.artifactTitle}</strong>
    <p>历史作品记录（只读）。当前学习进度由服务端自动评价，不等待教师审批。</p>
    {loading ? <p role="status">正在读取版本…</p> : null}
    {error ? <p role="alert">{error} <button onClick={() => setReload(value => value + 1)}>重新读取</button></p> : null}
    {version ? <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{version.inlineText ?? '该版本没有可显示的正文。'}</pre> : null}
  </section>;
}
