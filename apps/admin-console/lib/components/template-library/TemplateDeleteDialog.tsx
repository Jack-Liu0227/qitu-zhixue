'use client';

import { useEffect, useRef, useState } from 'react';
import { deleteTemplateWithRecords, fetchTemplateDeletionImpact, type TemplateDeletionImpact } from '../../api/content';
import { newIdempotencyKey } from '../../api/types';
import styles from './TemplateDeleteDialog.module.css';

const labels: Record<string, string> = {
  students: '受影响学生', projects: '学生项目', plans: '学习计划', artifacts: '作品',
  verification: '质量验证记录', verificationEvidence: '验证证据', explorations: '探索记录',
  sessions: '对话', turns: '对话消息', growth: '成长记录', answers: '答题记录',
  knowledge: '项目资料库', feedback: '项目反馈', versions: '课程版本', bindings: '教学配置', runs: 'AI 任务',
  objectives: '学习目标', masteryEvents: '掌握度事件', artifactVersions: '作品版本',
};

export function TemplateDeleteDialog({ templateId, onCancel, onDeleted }: {
  templateId: string; onCancel: () => void; onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const [impact, setImpact] = useState<TemplateDeletionImpact | null>(null);
  const [revision, setRevision] = useState(0);
  const [title, setTitle] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(''); setImpact(null); setTitle(''); setAcknowledged(false);
    void fetchTemplateDeletionImpact(templateId).then(value => {
      if (current) setImpact(value);
    }).catch(cause => {
      if (current) setError(cause instanceof Error ? cause.message : '无法读取删除范围，请重试。');
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [templateId, revision]);

  async function remove() {
    if (!impact || !acknowledged || title.trim() !== impact.title || inFlight.current) return;
    if (attempt.current?.fingerprint !== impact.fingerprint) {
      attempt.current = { fingerprint: impact.fingerprint, key: newIdempotencyKey() };
    }
    inFlight.current = true; setBusy(true); setError('');
    try {
      await deleteTemplateWithRecords(impact, impact.title, attempt.current.key);
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败，请重试。');
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="template-delete-title"
    onCancel={event => { event.preventDefault(); if (!inFlight.current) onCancel(); }}>
    <h2 id="template-delete-title">永久删除课程及关联记录</h2>
    {loading && <p role="status">正在核对删除范围…</p>}
    {impact && <>
      <p>将永久删除「{impact.title}」及以下关联记录，无法恢复。</p>
      <dl className={styles.counts}>{Object.entries(labels).map(([key, label]) =>
        <div key={key}><dt>{label}</dt><dd>{impact.counts[key] ?? 0}</dd></div>)}</dl>
      <p className={styles.note}>项目内的计划、掌握度、作品版本、评价和对话将一并清理。关联成长报告将失效。学生账号、其他课程和操作审计保留。</p>
      <label className={styles.check}><input type="checkbox" checked={acknowledged} disabled={busy}
        onChange={event => setAcknowledged(event.target.checked)} />我确认同时删除上述学生学习数据</label>
      <label className={styles.title}>输入完整课程名称以确认
        <input autoComplete="off" value={title} disabled={busy} placeholder={impact.title}
          onChange={event => setTitle(event.target.value)} />
      </label>
    </>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}>
      <button type="button" disabled={busy} onClick={onCancel}>取消</button>
      <button type="button" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>重新核对</button>
      <button type="button" className={styles.danger} disabled={busy || loading || !impact || !acknowledged || title.trim() !== impact.title}
        onClick={() => void remove()}>{busy ? '正在删除并核对…' : '永久删除'}</button>
    </div>
  </dialog>;
}
