'use client';

import { useEffect, useRef, useState } from 'react';
import { centerRequest, type Base } from '../api/knowledge-center';
import { newIdempotencyKey } from '../api/modelRegistry';

/** File bytes stay in memory and go straight to the existing governed upload owner, never to the model/history. */
export function KnowledgeUpload({ enabled, onSaved }: { enabled: boolean; onSaved: (message: string) => void }) {
  const [bases, setBases] = useState<Base[]>([]);
  const [baseId, setBaseId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const key = useRef(newIdempotencyKey());
  const inFlight = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setLoading(true); setError('');
    centerRequest<Base[]>('knowledge/bases').then(rows => {
      if (!current) return;
      setBases(rows.filter(base => base.kind === 'platform' && base.lifecycle === 'active'));
    }).catch(reason => { if (current) { setBases([]); setError(reason instanceof Error ? reason.message : '知识库读取失败'); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [enabled, reload]);
  async function upload() {
    if (!file || !baseId || !enabled || inFlight.current) return;
    if (file.size > 10 * 1024 * 1024) { setError('文件不能超过 10 MiB，请拆分后导入'); return; }
    inFlight.current = true; setBusy(true); setError('');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsDataURL(file);
      });
      await centerRequest<Base>(`knowledge/bases/${encodeURIComponent(baseId)}/uploads`, 'POST', { fileName: file.name, base64 }, key.current);
      const saved = await centerRequest<Base>(`knowledge/bases/${encodeURIComponent(baseId)}`);
      onSaved(`已将文件“${file.name}”导入知识库 ${baseId}。已回读当前构建状态：${saved.build_state}。仅 ready 表示当前索引可用。`);
      setFile(null); key.current = newIdempotencyKey();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导入未完成，可重试同一文件'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <details style={{ padding: '6px 24px' }}>
    <summary>导入知识库资料</summary>
    {!enabled ? <p>在全局配置中开启完整权限后可导入资料。</p> : <>
      {loading ? <p role="status">正在读取知识库…</p> : !bases.length && !error ? <p>暂无可用知识库，可先让管家创建。</p> : null}
      <select aria-label="导入到知识库" value={baseId} disabled={busy || loading} onChange={event => { setBaseId(event.target.value); key.current = newIdempotencyKey(); }}>
        <option value="">选择知识库</option>{bases.map(base => <option key={base.id} value={base.id}>{base.name}</option>)}
      </select>
      <input type="file" aria-label="选择知识资料" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); key.current = newIdempotencyKey(); }} />
      <button type="button" disabled={busy || loading || !file || !bases.some(base => base.id === baseId)} onClick={() => void upload()}>{busy ? '正在导入…' : '导入并构建索引'}</button>
      <button type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>刷新知识库</button>
      {error && <p role="alert">{error}</p>}
    </>}
  </details>;
}
