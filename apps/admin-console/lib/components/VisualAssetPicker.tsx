'use client';

import { useEffect, useRef, useState } from 'react';
import { VISUAL_CATEGORY_LABELS, type VisualAssetSummary, type VisualBinding, type VisualBindingResult, type VisualOwner, type VisualSelection, type VisualUsage } from '@qitu/contracts';
import { VisualAsset } from '@qitu/ui';
import { fetchVisualAssets, fetchVisualBinding, saveVisualBindings } from '../api/visual-assets';
import { newIdempotencyKey } from '../api/types';

export function VisualAssetPicker({ usage, owners, onClose, onSaved, onSelect }: {
  usage: VisualUsage; owners?: VisualOwner[]; onClose: () => void; onSaved?: () => void; onSelect?: (selection: VisualSelection) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [assets, setAssets] = useState<VisualAssetSummary[]>([]);
  const [bindings, setBindings] = useState<VisualBinding[]>([]);
  const [selection, setSelection] = useState<VisualSelection>({ kind: 'inherit' });
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [online, setOnline] = useState(true);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const ownerSignature = JSON.stringify(owners ?? []);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void Promise.all([fetchVisualAssets(usage), Promise.all((owners ?? []).map((owner) => fetchVisualBinding(owner, usage)))])
      .then(([catalog, current]) => { if (active) { setAssets(catalog); setBindings(current); if (current.length === 1 && current[0]) setSelection(current[0].selection); } })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : '素材库读取失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [usage, ownerSignature, reload]);

  async function save() {
    if (loading || error || saving || !online) return;
    if (!owners?.length) { onSelect?.(selection); onClose(); return; }
    setSaving(true); setNotice('');
    const inputs = bindings.map((binding) => ({ owner: binding.owner, usage, selection, expectedRevision: binding.revision }));
    const signature = JSON.stringify(inputs);
    if (retry.current?.signature !== signature) retry.current = { signature, key: newIdempotencyKey() };
    try {
      const results = await saveVisualBindings(inputs, retry.current.key);
      const failures = results.filter((result): result is Extract<VisualBindingResult, { kind: 'failed' }> => result.kind === 'failed');
      const successful = results.filter((result): result is Extract<VisualBindingResult, { kind: 'saved' }> => result.kind === 'saved');
      const readbacks = await Promise.all(successful.map((result) => fetchVisualBinding(result.binding.owner, usage)));
      const mismatch = readbacks.some((binding, index) => {
        const saved = successful[index]?.binding;
        return !saved || binding.revision !== saved.revision || JSON.stringify(binding.selection) !== JSON.stringify(saved.selection);
      });
      if (mismatch) throw new Error('保存后的回读结果已变化，请重新载入核对');
      onSaved?.();
      if (!failures.length) { onClose(); return; }
      setBindings(bindings.filter((binding) => failures.some((result) => result.owner.kind === binding.owner.kind && result.owner.id === binding.owner.id)));
      retry.current = null;
      setNotice(`已确认保存 ${successful.length} 项；${failures.length} 项失败：${failures.map((result) => `${result.owner.id}：${result.message}`).join('；')}。再次保存仅处理失败项。`);
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : '保存结果未确认，请重试或重新载入'); }
    finally { setSaving(false); }
  }

  const visible = assets.filter((asset) => (!category || asset.category === category) && `${asset.name} ${VISUAL_CATEGORY_LABELS[asset.category]}`.includes(query.trim()));
  return <dialog ref={dialog} className="qitu-asset-picker" aria-labelledby="visual-picker-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
    <div className="qitu-asset-picker-head"><h2 id="visual-picker-title">选择素材{owners && owners.length > 1 ? ` · ${owners.length} 个对象` : ''}</h2><button type="button" disabled={saving} onClick={onClose}>关闭</button></div>
    <p>素材可以反复选择使用。继承默认后，将采用平台为此用途设置的素材。</p>
    {!online && <p role="status" className="qitu-asset-picker-status">当前离线，可以预览已读取的素材；恢复连接后才能保存。</p>}
    {loading ? <p className="qitu-asset-picker-status" role="status">正在读取素材库与当前选择…</p> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setReload((value) => value + 1)}>重新加载</button></div> : <>
      <div className="qitu-asset-picker-filters"><input aria-label="搜索素材" placeholder="搜索素材" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="素材分类" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">全部分类</option>{[...new Set(assets.map((asset) => asset.category))].map((key) => <option key={key} value={key}>{VISUAL_CATEGORY_LABELS[key]}</option>)}</select></div>
      <div className="qitu-asset-grid"><button type="button" className="qitu-asset-option" aria-pressed={selection.kind === 'inherit'} onClick={() => setSelection({ kind: 'inherit' })}><span>继承默认</span><small>自动采用平台设置</small></button>
        {visible.map((asset) => <button type="button" key={asset.id} className="qitu-asset-option" aria-pressed={selection.kind === 'asset' && selection.assetId === asset.id} onClick={() => setSelection({ kind: 'asset', assetId: asset.id })}><VisualAsset assetId={asset.id} size={64} /><span>{asset.name}</span></button>)}
      </div>{!visible.length && <p role="status">没有匹配的素材，请调整筛选条件。</p>}
    </>}
    {notice && <p role="status" className="qitu-asset-picker-status">{notice}</p>}
    <div className="qitu-asset-picker-foot"><button type="button" disabled={saving || !online} onClick={() => setReload((value) => value + 1)}>重新载入</button><button type="button" disabled={saving} onClick={onClose}>取消</button><button type="button" className="qitu-button qitu-button-primary" disabled={loading || !!error || saving || !online || assets.length === 0} onClick={() => void save()}>{saving ? '保存并回读…' : owners?.length ? '保存选择' : '使用此素材'}</button></div>
  </dialog>;
}

export function VisualSelector({ owner, owners, usage = 'icon', label = '选择素材', onSaved }: {
  owner?: VisualOwner; owners?: VisualOwner[]; usage?: VisualUsage; label?: string; onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <span className="qitu-visual-control"><button type="button" className="settings-action-btn" onClick={(event) => { event.stopPropagation(); setOpen(true); }}>{label}</button>{open && <VisualAssetPicker owners={owners ?? (owner ? [owner] : [])} usage={usage} onClose={() => setOpen(false)} onSaved={onSaved} />}</span>;
}

export function VisualBoundIcon({ owner, usage = 'icon', size = 40 }: { owner: VisualOwner; usage?: VisualUsage; size?: number }) {
  const [assetId, setAssetId] = useState<string | null>(null);
  const signature = JSON.stringify(owner);
  useEffect(() => {
    let active = true;
    void fetchVisualBinding(owner, usage).then((binding) => { if (active) setAssetId(binding.effectiveAssetId); }).catch(() => { if (active) setAssetId(null); });
    return () => { active = false; };
  }, [signature, usage]);
  return <VisualAsset assetId={assetId ?? 'capability-knowledge-v1'} size={size} />;
}

export function VisualObjectControl({ owner, usage = 'icon', label = '选择素材' }: { owner: VisualOwner; usage?: VisualUsage; label?: string }) {
  const [revision, setRevision] = useState(0);
  return <span className="qitu-visual-control"><VisualBoundIcon key={revision} owner={owner} usage={usage} /><VisualSelector owner={owner} usage={usage} label={label} onSaved={() => setRevision((value) => value + 1)} /></span>;
}
