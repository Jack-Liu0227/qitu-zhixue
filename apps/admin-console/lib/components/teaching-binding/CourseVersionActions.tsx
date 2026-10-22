'use client';

import { useRef, useState } from 'react';
import { fetchAdminTemplateVersions, runAdminCourseTransition, type AdminCourseVerification } from '../../api/content';
import { newIdempotencyKey } from '../../api/types';
import styles from './LessonDraftEditor.module.css';

export function CourseVersionActions({ templateId, versionId, status, disabled, onChanged }: {
  templateId: string; versionId: string; status: string; disabled: boolean; onChanged(): void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<AdminCourseVerification | null>(null);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  async function act(action: 'pilot' | 'verify' | 'publish') {
    if (busy || disabled) return;
    const signature = JSON.stringify({ templateId, versionId, action, reason });
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: newIdempotencyKey() };
    setBusy(true); setError('');
    try {
      const result = await runAdminCourseTransition(templateId, versionId, action, reason, attempt.current.key);
      if (action === 'verify') {
        if (!result.report || result.report.templateVersionId !== versionId) throw new Error('发布检查结果未确认，请重试。');
        setReport(result.report);
      } else {
        const saved = (await fetchAdminTemplateVersions(templateId)).find(entry => entry.id === versionId);
        if (saved?.status !== (action === 'pilot' ? 'piloting' : 'published')) throw new Error('课程状态回读未确认，请重新加载核对。');
        onChanged();
      }
      attempt.current = null;
    } catch (failure) { setError(failure instanceof Error ? failure.message : '课程操作未确认，请重试。'); }
    finally { setBusy(false); }
  }
  return <section className={styles.editor} aria-label="课程版本发布">
    <h3>课程版本发布</h3><p className={styles.note}>草稿进入试点后可配置教学绑定。正式发布依据服务端收集的真实试点与教师审批证据。</p>
    {status !== 'published' ? <label>试点或发布原因<input value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} disabled={busy || disabled} /></label> : null}
    <div className={styles.grid}>
      {status === 'draft' ? <button type="button" disabled={disabled || busy || !reason.trim()} onClick={() => void act('pilot')}>进入试点</button> : null}
      <button type="button" disabled={disabled || busy} onClick={() => void act('verify')}>{busy ? '正在检查…' : '检查发布条件'}</button>
      {status !== 'published' ? <button type="button" disabled={disabled || busy || !reason.trim() || !report?.passed} onClick={() => void act('publish')}>正式发布</button> : null}
    </div>
    {report ? <div role="status"><strong>{report.passed ? '发布条件已满足，提交时仍会重新核验' : '发布条件尚未满足'}</strong>
      <ul>{report.checks.map(check => <li key={check.key}>{check.passed ? '✓' : '待补充'} {check.label}：{check.detail}</li>)}</ul></div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
