'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToolBindingMigrationPlan, ToolBindingMigrationResult } from '@qitu/contracts';
import { fetchToolBindingMigrationPlan, migrateToolBindings } from '../api/toolBindingMigration';

type PreviewState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; plan: ToolBindingMigrationPlan };

export function ToolBindingMigrationPanel({ onMigrated }: { onMigrated: (result: ToolBindingMigrationResult) => Promise<void> }) {
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const writing = useRef(false);
  const load = useCallback(async () => {
    const identity = ++request.current;
    setPreview({ status: 'loading' });
    try {
      const plan = await fetchToolBindingMigrationPlan();
      if (identity === request.current) setPreview({ status: 'ready', plan });
    } catch (cause) {
      if (identity === request.current) setPreview({ status: 'error', message: cause instanceof Error ? cause.message : '迁移预览读取失败' });
    }
  }, []);
  useEffect(() => { void load(); return () => { ++request.current; }; }, [load]);

  async function apply() {
    if (preview.status !== 'ready' || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError('');
    let submitted = false;
    try {
      const result = await migrateToolBindings(preview.plan.revision);
      submitted = true;
      await onMigrated(result);
    } catch (cause) {
      setError(`${submitted ? '迁移已提交，但回读未确认，请刷新核对。' : '迁移未完成，当前绑定未确认变更。'}${cause instanceof Error ? cause.message : '请重试'}`);
      await load();
    } finally { writing.current = false; setBusy(false); }
  }

  return <section aria-label="历史工具绑定迁移" style={{ marginBottom: 16, padding: 16, background: '#fffbeb', color: '#713f12', border: '1px solid #fde68a', borderRadius: 10 }}>
    <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>历史工具绑定需要迁移</h2>
    <p style={{ fontSize: 13, margin: '0 0 12px' }}>旧占位 ID 不是可调用工具。以下预览只移除已识别的无效调用绑定，并把原绑定和处理说明写入审计；保留其他授权、业务流程、冻结团队和历史项目。</p>
    {preview.status === 'loading' ? <p role="status">正在读取迁移预览…</p> : null}
    {preview.status === 'error' ? <p role="alert">{preview.message} <button type="button" onClick={() => void load()}>重新读取</button></p> : null}
    {preview.status === 'ready' ? <>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead><tr><th>助手</th><th>历史 ID</th><th>处理方式与业务归属</th></tr></thead>
        <tbody>{preview.plan.entries.flatMap(entry => entry.retired.map(tool => <tr key={`${entry.assistantId}:${tool.id}`}>
          <td style={{ padding: '8px 12px 8px 0', verticalAlign: 'top' }}>{entry.assistantName}</td>
          <td style={{ padding: '8px 12px 8px 0', verticalAlign: 'top' }}><code>{tool.id}</code></td>
          <td style={{ padding: '8px 0' }}>{tool.status === 'workflow_owned' ? '由业务流程负责' : '通用工具尚未接入'} · {tool.owner}<br />{tool.explanation}</td>
        </tr>))}</tbody>
      </table></div>
      {preview.plan.unresolvedToolIds.length > 0 ? <p role="status">以下 ID 尚无迁移规则，继续保留且不标记为可用：{preview.plan.unresolvedToolIds.join('、')}</p> : null}
      {preview.plan.entries.length > 0 ? <button type="button" className="settings-action-btn is-primary" disabled={busy} onClick={() => void apply()}>
        {busy ? '正在迁移并回读…' : `迁移已识别绑定（${preview.plan.entries.length} 个助手）`}
      </button> : <p role="status">没有可自动迁移的绑定，请逐项核对未识别 ID。</p>}
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
