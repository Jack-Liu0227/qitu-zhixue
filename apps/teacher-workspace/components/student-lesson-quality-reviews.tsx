'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LessonQualityQueueItem } from '@qitu/contracts';
import { Button, SkeletonBlock } from '@qitu/ui';
import { teacherApi, TeacherOfflineError, TeacherPermissionError } from '../lib/teacherApi';

export function StudentLessonQualityReviews({ studentId }: { studentId: string }) {
  const [items, setItems] = useState<LessonQualityQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const cursor = cursors.at(-1);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const { data } = await teacherApi.lessonQuality(studentId, cursor);
      if (request !== generation.current) return;
      if (!data || !Array.isArray(data.items) || data.items.some(item => !item.proof?.quality
        || item.proof.scope.planId !== item.planId || item.proof.scope.planRevision !== item.planRevision
        || item.proof.scope.learningSessionId !== item.learningSessionId || !Array.isArray(item.criteria))) {
        throw new Error('课内评价列表响应不完整，请重试。');
      }
      setItems(data.items);
      setNextCursor(data.nextCursor ?? null);
      setNotice(data.unavailablePlans ? '部分课程配置尚未就绪，请联系管理员恢复；其他可用课程仍可查看。'
        : data.hasMore ? '还有其他在学课程，可翻页查看。' : null);
    } catch (cause) {
      if (request !== generation.current) return;
      setItems([]);
      setNextCursor(null);
      setError(cause instanceof TeacherPermissionError ? '无权查看该学生的课内产物。'
        : cause instanceof TeacherOfflineError ? '网络不可用，请恢复连接后重试。'
          : cause instanceof Error ? cause.message : '课内评价暂不可用。');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [studentId, cursor]);

  useEffect(() => {
    void load();
    return () => { generation.current++; };
  }, [load]);

  return (
    <section className="qtx-card qtx-panel" style={{ marginTop: 16 }} aria-label="学习记录与自动评价">
      <div className="qtx-panel-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="qtx-panel-title">
            <span className="dot" style={{ background: '#7c3aed' }} />
            学习记录与自动评价
          </div>
          <p className="qtx-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
            只读查看学生表达、学习证据和自动评价；学生进度无需等待教师。
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {cursors.length > 1 ? (
            <Button variant="ghost" size="sm" onClick={() => setCursors([undefined])} disabled={loading}>
              返回首页
            </Button>
          ) : null}
          {nextCursor ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCursors(values => [...values, nextCursor ?? undefined])}
              disabled={loading}
            >
              下一组课程
            </Button>
          ) : null}
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
      </div>

      {loading ? (
        <div style={{ padding: '12px 0' }}>
          <p className="qtx-muted" style={{ fontSize: 13, marginBottom: 8 }}>正在读取学习记录…</p>
          <SkeletonBlock lines={3} />
        </div>
      ) : null}

      {notice ? (
        <div style={{ padding: '8px 12px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, color: '#0369a1', fontSize: 12, marginBottom: 10 }}>
          ℹ️ {notice}
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, color: '#991b1b', fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      {!loading && !error && !items.length ? (
        <div style={{ padding: '28px 16px', textAlign: 'center', background: '#f8fafc', borderRadius: 12, border: '1px dashed #e2e8f0' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🎯</div>
          <div style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>暂无已保存的课内学习记录</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            学生保存的表达、实验证据和自动评价将在此显示
          </div>
        </div>
      ) : null}

      {!loading && items.length > 0 ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {items.map(item => (
            <QualityReview
              key={`${studentId}:${item.proof.ref}:${item.proof.quality!.subjectDigest}`}
              item={item}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function QualityReview({ item }: { item: LessonQualityQueueItem }) {
  const quality = item.proof.quality;
  const label = quality ? ({ pending: '自动评价未完成', accepted: '已达标', needs_revision: '学生需补充', stale: '版本已变化' })[quality.status] : '暂无评价';
  return <details className="qtx-card" style={{ padding: 12 }}>
    <summary>{item.lessonTitle} · {label}</summary>
    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.content}</pre>
    <ul>{item.criteria.map(criterion => <li key={criterion.id}>
      {criterion.description}
      <p>{quality?.feedback.find(entry => entry.criterionId === criterion.id)?.feedback ?? '自动评价尚未完成，学生可自行重试。'}</p>
    </li>)}</ul>
  </details>;
}
