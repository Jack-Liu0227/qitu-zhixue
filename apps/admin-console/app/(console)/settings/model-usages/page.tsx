'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AdminModelUsagesResponse,
  AdminProvidersResponse,
  BindUsageRequest,
  ModelUsageBinding,
  ModelUsageSlot,
} from '@qitu/contracts';
import { Badge, Button, EmptyState, InfoRow, SectionCard } from '@qitu/ui';
import { bindUsage, fetchProviders, fetchUsages } from '../../../../lib/api/modelRegistry';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { SettingsSubNav } from '../../../../lib/components/SettingsSubNav';

/**
 * 模型用途绑定。
 *
 * 「凭证属于供应商、能力属于模型、选择属于用途」——本页只负责第三层：
 * 为每个用途选「哪个供应商的哪个模型」。供应商与模型清单来自
 * `model-providers`，未配供应商时本页明确提示而不是给出假的选项。
 */

/** 空串 = 「不绑定」；其余为供应商 id。 */
const UNBOUND = '';

function modalityLabel(modality: string): string {
  const labels: Record<string, string> = {
    text: '文本',
    image: '图片',
    audio: '语音',
  };
  return labels[modality] ?? modality;
}

function UsageCard({
  usage,
  binding,
  providers,
  onSaved,
}: {
  usage: ModelUsageSlot;
  binding: ModelUsageBinding;
  providers: { id: string; name: string; models: { id: string; name: string }[] }[];
  onSaved: (binding: ModelUsageBinding) => void;
}) {
  const [providerId, setProviderId] = useState(binding.providerId ?? UNBOUND);
  const [modelId, setModelId] = useState(binding.modelId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const providerModels = useMemo(
    () => providers.find((provider) => provider.id === providerId)?.models ?? [],
    [providers, providerId],
  );

  function selectProvider(id: string) {
    setProviderId(id);
    setModelId('');
    setSaved(false);
  }

  async function save() {
    setError('');
    setSaved(false);

    const body: BindUsageRequest =
      providerId === UNBOUND
        ? { providerId: null, modelId: null }
        : { providerId, modelId: modelId || null };

    if (providerId !== UNBOUND && !modelId) {
      setError('请先选择模型，或切换为「不绑定」。');
      return;
    }

    setSaving(true);
    try {
      const updated = await bindUsage(usage.id, body);
      onSaved(updated);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }

  const resolved = binding.resolved;
  const fallbackText =
    usage.fallbackTo !== null
      ? `未绑定或不可用时回落到「${usage.fallbackTo}」`
      : '必须显式绑定，否则该功能不可用';

  return (
    <SectionCard
      title={usage.label}
      action={
        resolved ? (
          <Badge tone="completed">已生效</Badge>
        ) : (
          <Badge tone="attention">未生效</Badge>
        )
      }
    >
      <p className="admin-usage-description">{usage.description}</p>

      <div className="admin-usage-meta">
        <InfoRow
          label="需要的输出"
          value={usage.requiresOutput.map(modalityLabel).join('、')}
        />
        <InfoRow label="回落策略" value={fallbackText} />
        <InfoRow
          label="当前生效"
          value={
            binding.providerId && binding.modelId
              ? `${binding.providerId} / ${binding.modelId}`
              : resolved
                ? `${resolved.providerId} / ${resolved.modelId}（回落）`
                : '不可用'
          }
          muted={!resolved}
        />
      </div>

      <div className="admin-usage-bind">
        <label className="admin-usage-select">
          <span>供应商</span>
          <select value={providerId} onChange={(event) => selectProvider(event.target.value)}>
            <option value={UNBOUND}>不绑定</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}（{provider.id}）
              </option>
            ))}
          </select>
        </label>

        <label className="admin-usage-select">
          <span>模型</span>
          <select
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            disabled={providerId === UNBOUND || providerModels.length === 0}
          >
            <option value="">选择模型</option>
            {providerModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name || model.id}
              </option>
            ))}
          </select>
        </label>

        <div className="admin-form-actions">
          <Button size="sm" onClick={save} loading={saving} disabled={providers.length === 0 && providerId !== UNBOUND}>
            保存绑定
          </Button>
          {binding.providerId || binding.modelId ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setProviderId(UNBOUND);
                setModelId('');
                setSaved(false);
                setError('');
              }}
              disabled={saving}
            >
              清空为不绑定
            </Button>
          ) : null}
        </div>
      </div>

      {saved ? (
        <p className="admin-usage-saved" role="status">
          已保存
        </p>
      ) : null}
      {error ? (
        <p className="qitu-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </SectionCard>
  );
}

export default function AdminModelUsagesPage() {
  const [usages, setUsages] = useState<AdminModelUsagesResponse | null>(null);
  const [providers, setProviders] = useState<AdminProvidersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usagesData, providersData] = await Promise.all([fetchUsages(), fetchProviders()]);
      setUsages(usagesData);
      setProviders(providersData);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('未知错误'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) {
    return (
      <div className="admin-settings-page">
        <SettingsSubNav />
        {stateView}
      </div>
    );
  }

  if (!usages || !providers) return null;

  const providerOptions = providers.providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    models: provider.models.map((model) => ({ id: model.id, name: model.name })),
  }));

  const bindingMap = new Map(usages.bindings.map((binding) => [binding.usageId, binding]));

  return (
    <div className="admin-settings-page">
      <SettingsSubNav />

      <div className="admin-page-header">
        <h1>模型用途绑定</h1>
        <p>为 AI搭档、灵感推荐、成长总结等用途指定「哪个供应商的哪个模型」。</p>
      </div>

      {providers.providers.length === 0 ? (
        <EmptyState
          title="还没有配置供应商"
          description="请先在「模型供应商」中接入至少一个供应商，再回来绑定用途。"
        />
      ) : (
        <div className="admin-settings-panels">
          {usages.usages.map((usage) => (
            <UsageCard
              key={usage.id}
              usage={usage}
              binding={
                bindingMap.get(usage.id) ?? {
                  usageId: usage.id,
                  providerId: null,
                  modelId: null,
                  resolved: null,
                }
              }
              providers={providerOptions}
              onSaved={(updated) =>
                setUsages((current) =>
                  current
                    ? {
                        ...current,
                        bindings: current.bindings.map((b) => (b.usageId === updated.usageId ? updated : b)),
                      }
                    : current,
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
