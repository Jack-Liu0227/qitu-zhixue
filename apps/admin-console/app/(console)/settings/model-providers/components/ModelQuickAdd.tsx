'use client';

import { useState, type FormEvent } from 'react';
import type { ProviderConfigPublic } from '@qitu/contracts';
import { createManualModel, fetchProviders, newIdempotencyKey } from '../../../../../lib/api/modelRegistry';

export interface ModelQuickAddProps {
  provider: ProviderConfigPublic;
  onAdded: (provider: ProviderConfigPublic) => void;
}

export function ModelQuickAdd({ provider, onAdded }: ModelQuickAddProps) {
  const [modelId, setModelId] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modelId.trim() || !name.trim()) {
      setError('模型 ID 和展示名不能为空');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await createManualModel(provider.id, {
        modelId: modelId.trim(),
        displayName: name.trim(),
        api: provider.api,
        input: ['text'],
        output: ['text'],
        contextWindow: null,
        maxTokens: null,
        enabled: true,
        idempotencyKey: newIdempotencyKey(),
      });
      const latest = await fetchProviders();
      const updated = latest.providers.find((item: ProviderConfigPublic) => item.id === provider.id);
      if (updated) onAdded(updated);
      setModelId('');
      setName('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模型添加失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="provider-model-add" onSubmit={submit} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px' }}>
      <input
        value={modelId}
        onChange={(event) => setModelId(event.target.value)}
        placeholder="上游模型 ID (如 gpt-4o)"
        style={{ height: '32px', padding: '0 8px', borderRadius: '6px', border: '1px solid #dce4ee', fontSize: '12px', flex: 1 }}
      />
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="展示名"
        style={{ height: '32px', padding: '0 8px', borderRadius: '6px', border: '1px solid #dce4ee', fontSize: '12px', flex: 1 }}
      />
      <button type="submit" className="settings-pill-btn" disabled={saving}>
        {saving ? '添加中…' : '填入模型'}
      </button>
      {error ? <small className="qitu-field-error">{error}</small> : null}
    </form>
  );
}
