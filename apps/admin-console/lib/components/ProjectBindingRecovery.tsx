'use client';

import { useEffect, useRef, useState } from 'react';
import type { AdminProjectBindingRecovery } from '@qitu/contracts';
import { Button } from '@qitu/ui';
import { fetchProjectBindingRecovery, reconfirmProjectBinding } from '../api/template-bindings';
import { newIdempotencyKey } from '../api/types';

export function ProjectBindingRecovery({ templateId, versionId, bindingId, ready }: {
  templateId: string; versionId: string; bindingId: string | null; ready: boolean;
}) {
  const [projects, setProjects] = useState<AdminProjectBindingRecovery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    const request = ++generation.current;
    setLoading(true); setError(''); setProjects([]); setBusy('');
    void fetchProjectBindingRecovery(templateId, versionId).then((rows) => {
      if (request === generation.current) setProjects(rows);
    }).catch((failure: unknown) => { if (request === generation.current) setError(failure instanceof Error ? failure.message : '历史项目读取失败'); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [templateId, versionId, bindingId, reload]);

  async function repair(projectId: string) {
    if (!bindingId || !ready || busy || !reason.trim()) return;
    const request = generation.current;
    const signature = JSON.stringify({ bindingId, projectId, reason: reason.trim() });
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: newIdempotencyKey() };
    setBusy(projectId); setError(''); setNotice('');
    try {
      const result = await reconfirmProjectBinding(templateId, versionId, bindingId, projectId, reason.trim(), attempt.current.key);
      const rows = await fetchProjectBindingRecovery(templateId, versionId);
      if (result.snapshot.bindingId !== bindingId || !rows.some((row) => row.projectId === projectId && row.state === 'ready')) throw new Error('修复回读未确认，请重新加载核对。');
      if (request !== generation.current) return;
      setProjects(rows); setNotice('已确认并保存该项目的教学绑定，可以返回学生端重试。'); attempt.current = null;
    } catch (failure) { if (request === generation.current) setError(failure instanceof Error ? failure.message : '修复未确认'); }
    finally { if (request === generation.current) setBusy(''); }
  }
  const pending = projects.filter((project) => project.state !== 'ready');
  return <details><summary>历史项目教学绑定修复{pending.length ? `（${pending.length} 个待处理）` : ''}</summary>
    <p>这不是恢复聊天记录，而是为缺少冻结绑定或教学快照的历史项目重新确认当前有效绑定。已有有效冻结配置保持原版本；修复不会改变阶段、掌握度和作品结果。</p>
    {loading ? <p role="status">正在读取项目绑定状态…</p> : !pending.length && !error ? <p>当前版本没有待恢复的项目。</p> : null}
    {!!pending.length && <>
      {!ready && <p>请先完成上方团队发布、教学配置与校验启用，再确认恢复具体项目。</p>}
      <label>修复原因 <input className="admin-input-text" aria-label="项目绑定修复原因" value={reason} maxLength={200} disabled={!!busy} onChange={(event) => setReason(event.target.value)} /></label>
      <ul>{pending.map((project) => <li key={project.projectId}>项目 {project.projectId} · {project.state === 'missing' ? '缺少冻结绑定' : project.state === 'legacy' ? '历史配置不完整' : '配置异常，需单独核查'}
        <Button type="button" size="sm" variant="secondary" disabled={!ready || !!busy || !reason.trim() || project.state === 'invalid'} onClick={() => void repair(project.projectId)}>
          {busy === project.projectId ? '正在确认…' : '确认恢复此项目'}</Button></li>)}</ul>
    </>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error} <button type="button" disabled={!!busy} onClick={() => setReload((value) => value + 1)}>重新加载项目</button></p>}
  </details>;
}
