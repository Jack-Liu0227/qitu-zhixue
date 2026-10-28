'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { LearningEvidenceProof, LessonEvidenceView, TutorProjectContext } from '@qitu/contracts';
import { useTutorDataSource } from '../TutorDataSourceProvider';
import { createIdempotencyKey } from '../idempotency';
import { importLessonTextFiles } from '../data/lessonTextImport';
import { TutorDataError } from '../data/dataSource';
import styles from './DialogueLessonPanel.module.css';

/** The server owns evaluation and progression. The panel only restores receipts and confirms final delivery. */
export function DialogueLessonPanel({ projectId, lesson, refreshKey, disabled, onChanged, onExplain }: {
  projectId: string; lesson: NonNullable<TutorProjectContext['lesson']>; refreshKey: unknown; disabled: boolean;
  onChanged(): Promise<void>; onExplain?(message: string): void;
}) {
  const source = useTutorDataSource();
  const [view, setView] = useState<LessonEvidenceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [receiptPendingUntil, setReceiptPendingUntil] = useState(0);
  const contentId = useId();
  const filesId = useId();
  const generation = useRef(0), alive = useRef(true), inFlight = useRef<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const { planId, planRevision, learningSessionId } = lesson;
  const activity = lesson.currentActivity;
  const scopeKey = JSON.stringify([projectId, planId, planRevision, learningSessionId, activity?.activityId]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const isCurrent = () => alive.current && currentScope.current === scopeKey;
  const finalDelivery = activity?.evidence === 'submitted_artifact';
  const scope = { projectId, planId: planId!, planRevision: planRevision!, learningSessionId: learningSessionId! };
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const reload = useCallback(async (quiet = false) => {
    const request = ++generation.current;
    if (!quiet) setLoading(true);
    try {
      if (!planId || !planRevision || !learningSessionId || !source.getLessonEvidence) throw new Error('当前学习记录暂不可用。');
      const result = await source.getLessonEvidence({ projectId, planId, planRevision, learningSessionId });
      if (alive.current && currentScope.current === scopeKey && request === generation.current) { setView(result); setError(null); }
    } catch (cause) { if (alive.current && currentScope.current === scopeKey && request === generation.current) setError(cause instanceof Error ? cause.message : '读取失败，请重试。'); }
    finally { if (alive.current && currentScope.current === scopeKey && request === generation.current) setLoading(false); }
  }, [source, projectId, planId, planRevision, learningSessionId, scopeKey]);
  useEffect(() => { setView(null); setContent(''); setError(null); setNotice(null); setBusy(false); setReceiptPendingUntil(0); }, [scopeKey]);
  useEffect(() => { void reload(); }, [reload, refreshKey]);
  const synchronize = async () => {
    if (!isCurrent()) return;
    if (!source.reconcileLearning) throw new Error('进度同步暂不可用，已保存记录可稍后恢复。');
    await source.reconcileLearning(projectId, { planId: planId!, planRevision: planRevision! }, createIdempotencyKey());
    if (isCurrent()) await onChanged();
    if (isCurrent()) await reload();
  };
  const run = async (identity: string, action: (key: string) => Promise<void>) => {
    if (inFlight.current === scopeKey) return;
    inFlight.current = scopeKey; setBusy(true); setError(null);
    const key = keys.current.get(identity) ?? createIdempotencyKey(); keys.current.set(identity, key);
    try { await action(key); }
    catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : '处理暂未完成，请重试。'); }
    finally { if (inFlight.current === scopeKey) inFlight.current = null; if (isCurrent()) setBusy(false); }
  };
  const proofs = view ? [...view.submissions, ...view.observations, ...view.reflections].filter(proof => !activity || proof.activityId === activity.activityId) : [];
  const waiting = receiptPendingUntil > 0 || proofs.some(proof => proof.quality?.status === 'pending' && proof.quality.recovery?.status !== 'failed'
    || proof.kind === 'submitted_artifact' && proof.quality?.status === 'accepted'
      && !view?.approvedArtifacts.some(item => item.artifactVersionId === proof.artifactVersionId));
  useEffect(() => {
    if (!waiting) return;
    const refresh = async () => {
      if (currentScope.current !== scopeKey || !alive.current || !navigator.onLine) return;
      if (receiptPendingUntil && Date.now() >= receiptPendingUntil) setReceiptPendingUntil(0);
      try {
        await reload(true);
        if (currentScope.current === scopeKey && alive.current) await onChanged();
      } catch (cause) {
        if (currentScope.current === scopeKey && alive.current) setError(cause instanceof Error ? cause.message : '进度同步暂不可用。');
      }
    };
    const timer = setInterval(() => { void refresh(); }, 12_000);
    window.addEventListener('online', refresh);
    return () => { clearInterval(timer); window.removeEventListener('online', refresh); };
  }, [waiting, reload, onChanged, scopeKey, receiptPendingUntil]);
  const recover = (proof: LearningEvidenceProof) => run(`evaluate:${proof.ref}`, async key => {
    if (!source.evaluateLessonEvidence) throw new Error('评价服务暂不可用。');
    await source.evaluateLessonEvidence(scope, proof.ref, key);
    if (!isCurrent()) return;
    if (proof.kind === 'submitted_artifact' && proof.artifactId && source.publishLearningArtifact) {
      const refreshed = await source.getLessonEvidence?.(scope);
      if (refreshed?.submissions.find(item => item.ref === proof.ref)?.quality?.status === 'accepted') await source.publishLearningArtifact(projectId, proof.artifactId, key);
    }
    await synchronize();
  });
  const restoreDraft = () => run('restore-draft', async () => {
    if (!source.getLessonProgress || !source.getLessonEvidence || !source.getLearningArtifact) throw new Error('草稿恢复暂不可用。');
    const progress = await source.getLessonProgress(planId!, projectId);
    if (progress.planRevision !== planRevision) throw new Error('计划版本已变化，请刷新。');
    const parts: string[] = [];
    for (const session of progress.sessions.filter(item => item.lessonIndex <= lesson.lessonIndex)) {
      const evidence = await source.getLessonEvidence({ ...scope, learningSessionId: session.sessionId });
      const draft = evidence.submissions.filter(item => item.kind === 'session_response' && item.artifactId).slice(-1)[0];
      if (draft?.artifactId) {
        const artifact = await source.getLearningArtifact(projectId, draft.artifactId);
        if (artifact.latestVersion?.inlineText) parts.push(`第 ${session.lessonIndex} 课：${session.title}\n${artifact.latestVersion.inlineText}`);
      }
      if (evidence.observations.length) parts.push(`第 ${session.lessonIndex} 课已保存的模拟观察引用：\n${evidence.observations.map(item => item.ref).join('\n')}`);
    }
    if (isCurrent()) {
      setContent(parts.join('\n\n'));
      setNotice(parts.length ? '已汇集保存的草稿和观察引用。请补充你的结论与解释，再确认交付。' : '还没有可汇集的正文，可直接在这里整理你的成果。');
    }
  });
  if (!planId || !planRevision || !learningSessionId || lesson.status !== 'current') return null;
  return <section className={`qitu-lesson-assessment-card ${styles.panel}`} aria-label="当前学习任务">
    <strong>第 {lesson.lessonIndex} 课 · {finalDelivery ? '最终成果交付' : activity?.kind === 'reflect' ? '说说你的收获' : '继续本课探究'}</strong>
    <p>{activity?.guidance ?? '正在核对已保存的学习依据。'}</p>
    <p>{finalDelivery ? '确认后评价这个版本。已有正文可直接交付，无需导出再上传。'
      : activity?.evidence === 'experiment_observation' ? '在实验卡中预测、运行并保存真实观察。问答用于解释，观察回执由系统记录。'
        : '直接在下方对话框回答即可。也可以先提问、看例子或请求提示。'}</p>
    {onExplain ? <button type="button" className="qitu-button qitu-button-ghost" disabled={disabled || busy}
      onClick={() => onExplain(activity?.evidence === 'experiment_observation' ? '请帮我准备当前课允许的实验，并指导我进行预测、运行和观察。' : '请先用一个例子帮我理解当前任务，再让我尝试回答。')}>先帮我理解</button> : null}
    {loading ? <p role="status">正在读取学习记录…</p> : null}
    {error ? <p role="alert">{error} <button type="button" disabled={busy} onClick={() => { void reload(); }}>重新读取</button></p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {proofs.map(proof => <div key={proof.ref}>
      {proof.quality?.status === 'pending' ? <p>回答或观察已保存，{proof.quality.recovery?.status === 'failed'
        ? '自动重试暂未完成，可以稍后手动重试，无需重新提交。'
        : proof.quality.recovery ? '系统正在自动恢复评价，无需再次提交。' : '评价尚未完成。'}<button type="button" disabled={busy || disabled} onClick={() => { void recover(proof); }}>重试评价</button></p> : null}
      {proof.quality?.status === 'needs_revision' ? <p>{proof.quality.feedback.filter(item => !item.meets).map(item => item.feedback).join(' ')}</p> : null}
      {proof.quality?.status === 'accepted' && proof.quality.feedback.some(item => !item.meets) ? <p>可继续提升：{proof.quality.feedback.filter(item => !item.meets).map(item => item.feedback).join(' ')}（不影响达标）</p> : null}
      {proof.kind === 'submitted_artifact' && proof.quality?.status === 'accepted' && !view?.approvedArtifacts.some(item => item.artifactVersionId === proof.artifactVersionId)
        ? <button type="button" disabled={busy || disabled} onClick={() => { void recover(proof); }}>恢复这次交付</button> : null}
    </div>)}
    {finalDelivery ? <div className={styles.editor}>
      <button type="button" disabled={busy || disabled || !!content} onClick={() => { void restoreDraft(); }}>从已保存的学习记录整理草稿</button>
      <label htmlFor={contentId}>成果正文</label>
      <textarea id={contentId} rows={10} maxLength={10000} value={content} disabled={busy || disabled} onChange={event => setContent(event.target.value)} />
      <label htmlFor={filesId}>导入文本文件（可选，可多选）</label>
      <input id={filesId} type="file" multiple accept=".txt,.md,.csv,.json,.py,.js,.ts,.tsx,.jsx,.css,.html" disabled={busy || disabled}
        onChange={event => {
          const files = Array.from(event.target.files ?? []); event.target.value = '';
          if (!files.length) return;
          void run('import-files', async () => {
            const imported = await importLessonTextFiles(files, content);
            if (isCurrent()) { setContent(imported); setNotice('文件内容已放入正文，请检查后确认最终交付。代码尚未运行。'); }
          });
        }} />
      <p>支持文本、Markdown、代码、JSON 和 CSV，合并后最多 10000 字符。图片、PDF 和视频上传暂未开放。</p>
      <button type="button" className="qitu-button qitu-button-primary" disabled={busy || disabled || !content.trim() || loading}
        onClick={() => { void run(`deliver:${content}`, async key => {
          if (!source.submitLessonEvidence) throw new Error('成果提交暂不可用。');
          const receipt = await source.submitLessonEvidence(scope, 'artifacts', { content, title: lesson.title,
            activityId: activity!.activityId, planRevision: planRevision!, requestReview: true }, key).catch(cause => {
              if (!(cause instanceof TutorDataError) || cause.code !== 'IDEMPOTENCY_CONFLICT') throw cause;
              if (isCurrent()) {
                setNotice('相同成果正在处理中，系统会自动核对已保存的结果，无需再次提交。');
                setReceiptPendingUntil(Date.now() + 60_000);
              }
              return null;
            });
          if (!receipt) { if (isCurrent()) { await reload(true); if (isCurrent()) await onChanged(); } return; }
          if (isCurrent()) setNotice(receipt.proof.quality?.status === 'accepted' ? '这个版本已通过必要评价，正在同步交付状态。' : '成果已保存，请查看评价反馈。');
          await synchronize();
        }); }}>{busy ? '正在处理…' : '确认最终交付'}</button>
    </div> : null}
    {!activity ? <button type="button" disabled={busy || disabled} onClick={() => { void run('sync', synchronize); }}>恢复学习进度</button> : null}
  </section>;
}
