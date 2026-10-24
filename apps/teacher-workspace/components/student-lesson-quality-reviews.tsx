'use client';
import { createIdempotencyKey } from '@qitu/api-client';

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
      setNotice(data.unavailablePlans ? '部分课程配置尚未就绪，请联系管理员恢复；其他可用课程仍可评价。'
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
    <section className="qtx-card qtx-panel" style={{ marginTop: 16 }} aria-label="课内产物质量评价">
      <div className="qtx-panel-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="qtx-panel-title">
            <span className="dot" style={{ background: '#7c3aed' }} />
            课内产物质量评价
          </div>
          <p className="qtx-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
            阅读准确版本，逐项核对本课标准（过程性质量评价，不直接授予掌握度）。
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
          <p className="qtx-muted" style={{ fontSize: 13, marginBottom: 8 }}>正在读取待评价产物…</p>
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
          <div style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>暂无待评价的课内产物</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            学生在课内探究中生成的实验证据与论证产物将在此流转
          </div>
        </div>
      ) : null}

      {!loading && items.length > 0 ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {items.map(item => (
            <QualityReview
              key={`${studentId}:${item.proof.ref}:${item.proof.quality!.subjectDigest}`}
              item={item}
              onSaved={load}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function QualityReview({ item, onSaved }: { item: LessonQualityQueueItem; onSaved: () => Promise<void> }) {
  const [read, setRead] = useState(false);
  const [values, setValues] = useState<Record<string, { meets?: boolean; feedback: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<{ fingerprint: string; value: string } | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const ready = read && item.criteria.every(criterion => typeof values[criterion.id]?.meets === 'boolean'
    && (values[criterion.id]!.meets || values[criterion.id]!.feedback.trim()));

  const submit = async () => {
    if (!ready || inFlight.current || !item.proof.quality) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const body = {
      planRevision: item.planRevision,
      evidenceRef: item.proof.ref,
      subjectDigest: item.proof.quality.subjectDigest,
      criteria: item.criteria.map(criterion => ({
        criterionId: criterion.id,
        meets: values[criterion.id]!.meets!,
        feedback: values[criterion.id]!.feedback,
      })),
    };
    const fingerprint = JSON.stringify(body);
    if (key.current?.fingerprint !== fingerprint) {
      key.current = { fingerprint, value: `lesson-quality-${createIdempotencyKey()}` };
    }
    try {
      const { data } = await teacherApi.reviewLessonQuality(item.planId, item.learningSessionId, body, key.current.value);
      if (!alive.current) return;
      const expected = body.criteria.every(criterion => criterion.meets) ? 'accepted' : 'needs_revision';
      if (data.quality?.subjectDigest !== body.subjectDigest || data.quality.status !== expected) {
        throw new Error('评价回执与当前产物不一致，请刷新。');
      }
      await onSaved();
    } catch (cause) {
      if (alive.current) {
        setError(cause instanceof TeacherPermissionError ? '评价权限已变化，请重新读取。'
          : cause instanceof TeacherOfflineError ? '网络不可用，评价结果尚未确认，请重试。'
            : cause instanceof Error && cause.message ? cause.message : '评价未完成，请重试。');
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <details style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#fcfcfd' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{item.lessonTitle} · 待评价产物</span>
        <span className="qtx-badge qtx-badge-purple">待核验</span>
      </summary>

      <div style={{ marginTop: 12, padding: 12, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, lineHeight: 1.6, color: '#334155' }}>
          {item.content}
        </pre>
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: '#334155', cursor: 'pointer' }}>
          <input type="checkbox" checked={read} disabled={busy} onChange={event => setRead(event.target.checked)} />
          我已阅读上方待评价版本
        </label>
      </div>

      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {item.criteria.map(criterion => (
          <fieldset
            key={criterion.id}
            disabled={busy}
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '10px 12px',
              background: '#f8fafc',
              margin: 0,
            }}
          >
            <legend style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', padding: '0 4px' }}>
              {criterion.description}
            </legend>
            <div style={{ display: 'grid', gap: 6 }}>
              <select
                aria-label={`质量判断：${criterion.description}`}
                value={typeof values[criterion.id]?.meets === 'boolean' ? String(values[criterion.id]!.meets) : ''}
                onChange={event => setValues(old => ({
                  ...old,
                  [criterion.id]: { meets: event.target.value === 'true', feedback: old[criterion.id]?.feedback ?? '' },
                }))}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  fontSize: 12,
                }}
              >
                <option value="" disabled>请选择判断</option>
                <option value="true">达到本项要求</option>
                <option value="false">需要补充或修改</option>
              </select>
              <textarea
                aria-label={`反馈：${criterion.description}`}
                maxLength={500}
                placeholder="评价反馈或补充建议 (选填)..."
                rows={2}
                value={values[criterion.id]?.feedback ?? ''}
                onChange={event => setValues(old => ({
                  ...old,
                  [criterion.id]: { meets: old[criterion.id]?.meets, feedback: event.target.value },
                }))}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              />
            </div>
          </fieldset>
        ))}
      </div>

      {error ? (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 12 }}>
          {error}
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !ready}
          onClick={() => { void submit(); }}
          loading={busy}
        >
          {busy ? '正在提交…' : '提交质量评价'}
        </Button>
      </div>
    </details>
  );
}
