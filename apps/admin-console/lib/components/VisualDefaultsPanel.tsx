'use client';

import { useEffect, useState } from 'react';
import { VisualAsset } from '@qitu/ui';
import type { VisualBinding, VisualOwner, VisualUsage } from '@qitu/contracts';
import { fetchVisualBinding } from '../api/visual-assets';
import { VisualSelector } from './VisualAssetPicker';

const DEFAULTS: { name: string; owner: VisualOwner; usage: VisualUsage }[] = [
  { name: '助手默认头像', owner: { kind: 'platform', id: 'assistant' }, usage: 'avatar' },
  { name: '团队默认图标', owner: { kind: 'platform', id: 'team' }, usage: 'icon' },
  { name: '模板默认图标', owner: { kind: 'platform', id: 'template' }, usage: 'icon' },
  { name: '模板默认封面', owner: { kind: 'platform', id: 'template' }, usage: 'cover' },
  { name: '知识库默认图标', owner: { kind: 'platform', id: 'knowledge' }, usage: 'icon' },
];

export function VisualDefaultsPanel() {
  const [bindings, setBindings] = useState<VisualBinding[]>([]);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; setError('');
    void Promise.all(DEFAULTS.map((entry) => fetchVisualBinding(entry.owner, entry.usage)))
      .then((rows) => { if (active) setBindings(rows); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : '默认素材读取失败'); });
    return () => { active = false; };
  }, [reload]);
  return <section className="qitu-visual-settings"><h2>全站素材库与默认设置</h2><p>继承默认的对象会采用这里的选择。已有单独选择保持自己的素材。</p>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setReload((value) => value + 1)}>重试</button></p> : bindings.length === 0 ? <p role="status">正在读取默认素材…</p> :
      <div className="qitu-visual-settings-grid">{DEFAULTS.map((entry, index) => <div key={entry.name}><VisualAsset assetId={bindings[index]?.effectiveAssetId} size={56} /><p>{entry.name}</p><VisualSelector owner={entry.owner} usage={entry.usage} onSaved={() => setReload((value) => value + 1)} /></div>)}</div>}
  </section>;
}
