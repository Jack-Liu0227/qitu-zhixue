'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AdminProvidersResponse,
  ModelApi,
  ModelDescriptor,
  ProviderConfigPublic,
  ProviderPreset,
  RefreshProviderResponse,
  UpsertProviderRequest,
} from '@qitu/contracts';
import {
  deleteProvider,
  discoverProviderModels,
  fetchProviders,
  newIdempotencyKey,
  refreshProvider,
  setProviderModels,
  testProviderConnection,
  upsertProvider,
} from '../../../../lib/api/modelRegistry';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { ChannelEditorModal } from './components/ChannelEditorModal';
import { ChannelModelsDrawer } from './components/ChannelModelsDrawer';
import { ModelChannelTestModal } from './components/ModelChannelTestModal';
import { ProviderPresetsTab } from './components/ProviderPresetsTab';
import { SelectModelModal } from './components/SelectModelModal';
import { API_OPTIONS, formatTime } from './components/types';

export default function AdminModelPage() {
  const [data, setData] = useState<AdminProvidersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [activeTab, setActiveTab] = useState<'channels' | 'presets'>('channels');

  // 筛选与选择
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'enabled' | 'disabled' | 'error'>('all');
  const [apiFilter, setApiFilter] = useState<'all' | ModelApi>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);

  // 弹窗与抽屉状态
  const [drawerProviderId, setDrawerProviderId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ initial?: ProviderConfigPublic; preset?: ProviderPreset; isCopy?: boolean } | null>(null);
  const [testingProvider, setTestingProvider] = useState<ProviderConfigPublic | null>(null);
  const [batchSelectProviderId, setBatchSelectProviderId] = useState<string | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<Record<string, ModelDescriptor[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchProviders());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('供应商列表加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providers = useMemo(
    () =>
      (data?.providers ?? []).filter((provider) => {
        const q = query.trim().toLowerCase();
        const matchesQuery =
          !q ||
          [provider.id, provider.name, provider.baseUrl, provider.api, ...provider.models.map((m) => m.id)]
            .join(' ')
            .toLowerCase()
            .includes(q);
        const matchesStatus =
          status === 'all' ||
          (status === 'enabled' && provider.enabled) ||
          (status === 'disabled' && !provider.enabled) ||
          (status === 'error' && Boolean(provider.lastError));
        return matchesQuery && matchesStatus && (apiFilter === 'all' || provider.api === apiFilter);
      }),
    [data, query, status, apiFilter]
  );

  function replaceProvider(provider: ProviderConfigPublic) {
    setData((current) =>
      current
        ? {
            ...current,
            providers: current.providers.map((item) => (item.id === provider.id ? provider : item)),
          }
        : current
    );
  }

  async function discover(provider: ProviderConfigPublic): Promise<ModelDescriptor[]> {
    try {
      const result = await discoverProviderModels(provider.id);
      if (!result.ok) return [];
      setDiscoveredModels((current) => ({ ...current, [provider.id]: result.models }));
      return result.models;
    } catch {
      return [];
    }
  }

  async function refresh(provider: ProviderConfigPublic): Promise<RefreshProviderResponse | null> {
    try {
      const result = await refreshProvider(provider.id);
      replaceProvider(result.provider);
      return result;
    } catch {
      return null;
    }
  }

  async function refreshAll() {
    if (!data?.providers.length) return;
    for (const p of data.providers) {
      if (p.enabled && p.auth.configured) {
        void refresh(p);
      }
    }
  }

  async function bulkSetEnabled(enabled: boolean) {
    if (selected.size === 0) return;
    setBulkSaving(true);
    try {
      await Promise.all(
        [...selected].map(async (id) => {
          const provider = data?.providers.find((item) => item.id === id);
          if (!provider) return;
          const updated = await upsertProvider(
            provider.id,
            {
              name: provider.name,
              baseUrl: provider.baseUrl,
              api: provider.api,
              authHeader: provider.authHeader,
              enabled,
            } as UpsertProviderRequest,
            newIdempotencyKey()
          );
          replaceProvider(updated);
        })
      );
      setSelected(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('批量更新失败'));
    } finally {
      setBulkSaving(false);
    }
  }

  async function bulkDeleteProviders() {
    if (selected.size === 0) return;
    if (!confirm(`确定要批量删除选中的 ${selected.size} 个模型通道吗？此操作不可逆。`)) return;
    setBulkSaving(true);
    try {
      const results = await Promise.allSettled(
        [...selected].map((id) => deleteProvider(id, newIdempotencyKey()))
      );
      const succeeded = new Set(
        [...selected].filter((_, index) => results[index]?.status === 'fulfilled')
      );
      setData((current) =>
        current
          ? { ...current, providers: current.providers.filter((item) => !succeeded.has(item.id)) }
          : current
      );
      setSelected(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('批量删除通道失败'));
    } finally {
      setBulkSaving(false);
    }
  }

  async function handleDeleteProvider(provider: ProviderConfigPublic) {
    if (!confirm(`确定要删除模型通道「${provider.name}」(${provider.id}) 吗？`)) return;
    try {
      await deleteProvider(provider.id, newIdempotencyKey());
      setData((current) =>
        current
          ? {
              ...current,
              providers: current.providers.filter((item) => item.id !== provider.id),
            }
          : current
      );
    } catch (cause) {
      alert(cause instanceof Error ? cause.message : '删除通道失败');
    }
  }

  async function handleApplyBatchModels(provider: ProviderConfigPublic, selectedModelIds: string[]) {
    try {
      const discovered = discoveredModels[provider.id] ?? [];
      const catalog = new Map([...discovered, ...provider.models].map((m) => [m.id, m] as const));
      const models = selectedModelIds.map((modelId) => {
        const existing = catalog.get(modelId);
        return {
          modelId,
          displayName: existing?.name ?? modelId,
          input: existing?.input ?? ['text'],
          output: existing?.output ?? ['text'],
          contextWindow: existing?.contextWindow ?? null,
          maxTokens: existing?.maxTokens ?? null,
          source: existing?.source === 'manual' ? ('manual' as const) : ('remote' as const),
        };
      });
      const result = await setProviderModels(provider.id, { models }, newIdempotencyKey());
      replaceProvider(result.provider);
      setDiscoveredModels((current) => ({ ...current, [provider.id]: [] }));
    } catch (err) {
      alert('保存模型选择失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) return <div className="admin-settings-page">{stateView}</div>;
  if (!data) return null;

  const presets = data.presets;
  const drawerProvider = data.providers.find((p) => p.id === drawerProviderId) ?? null;
  const batchSelectProvider = data.providers.find((p) => p.id === batchSelectProviderId) ?? null;
  const batchCandidates = batchSelectProvider
    ? Array.from(
        new Map([
          ...batchSelectProvider.models.map((m) => [m.id, m] as const),
          ...(discoveredModels[batchSelectProvider.id] ?? []).map((m) => [m.id, m] as const),
        ]).values()
      )
    : [];
  const allSelected = providers.length > 0 && providers.every((p) => selected.has(p.id));

  return (
    <div className="admin-settings-page">
      {/* 顶部标题与主要操作 */}
      <div className="admin-page-header">
        <div className="admin-page-header-title">
          <div>
            <h1>模型接入与网关资产</h1>
            <p>
              负责底层模型通道网关（API 密钥、网关协议、Base URL）与可用模型资产池的同步与测速。智能体与团队的模型配置在助手与团队中设置。
            </p>
          </div>
        </div>
        <div className="admin-page-header-actions" style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="settings-action-btn" onClick={() => void refreshAll()}>
            🔄 批量同步上游目录
          </button>
          <button type="button" className="settings-action-btn is-primary" onClick={() => setEditing({})}>
            + 新建通道
          </button>
        </div>
      </div>

      {/* KPI 统计指标栏 */}
      <div className="provider-stats">
        <div>
          <strong>{data.providers.length}</strong>
          <span>总通道数</span>
        </div>
        <div>
          <strong>{data.providers.filter((p) => p.enabled).length}</strong>
          <span>已启用通道</span>
        </div>
        <div>
          <strong>{data.providers.reduce((count, p) => count + p.models.length, 0)}</strong>
          <span>已挂载模型</span>
        </div>
        <div>
          <strong>{data.providers.filter((p) => p.lastError).length}</strong>
          <span>同步异常</span>
        </div>
      </div>

      {/* 统一 Tabs 导航 */}
      <div className="settings-tabs-row" role="tablist" style={{ marginTop: '16px' }}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'channels'}
          className={`settings-tab-btn ${activeTab === 'channels' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('channels')}
        >
          <span>🔌 通道与已挂载模型</span>
          <span className="settings-tab-cnt">{data.providers.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'presets'}
          className={`settings-tab-btn ${activeTab === 'presets' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('presets')}
        >
          <span>📦 预置供应商市场</span>
          <span className="settings-tab-cnt">{presets.length}</span>
        </button>
      </div>

      {/* Tab 1: 通道与模型资产 */}
      {activeTab === 'channels' && (
        <div style={{ marginTop: '16px' }}>
          {/* 工具栏 */}
          <div className="provider-toolbar" style={{ marginBottom: '14px' }}>
            <input
              className="admin-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索通道 ID、名称、网关地址或模型"
              style={{ minWidth: '280px' }}
            />
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="all">全部通道状态</option>
              <option value="enabled">运行中通道</option>
              <option value="disabled">已停用通道</option>
              <option value="error">异常通道</option>
            </select>
            <select value={apiFilter} onChange={(e) => setApiFilter(e.target.value as typeof apiFilter)}>
              <option value="all">全部协议</option>
              {API_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {selected.size > 0 && (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="settings-pill-btn"
                  disabled={bulkSaving}
                  onClick={() => void bulkSetEnabled(true)}
                >
                  批量启用
                </button>
                <button
                  type="button"
                  className="settings-pill-btn"
                  disabled={bulkSaving}
                  onClick={() => void bulkSetEnabled(false)}
                >
                  批量停用
                </button>
                <button
                  type="button"
                  className="settings-pill-btn"
                  style={{ color: '#ef4444' }}
                  disabled={bulkSaving}
                  onClick={() => void bulkDeleteProviders()}
                >
                  批量删除 ({selected.size})
                </button>
              </div>
            )}
          </div>

          {/* 通道表格（去除了导致纵向无限撑开的行内嵌套，改由侧边抽屉承载模型明细） */}
          {providers.length === 0 ? (
            <div className="admin-empty-state">
              没有符合筛选条件的模型通道。你可以点击右上角新建一个 OpenAI / Gemini / Anthropic 兼容网关。
            </div>
          ) : (
            <div className="admin-data-table admin-table-compact provider-table">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '44px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(providers.map((p) => p.id)) : new Set())
                        }
                        aria-label="全选通道"
                      />
                    </th>
                    <th style={{ minWidth: '200px' }}>通道名称</th>
                    <th style={{ minWidth: '240px' }}>网关地址</th>
                    <th style={{ minWidth: '110px' }}>协议</th>
                    <th style={{ minWidth: '90px' }}>状态</th>
                    <th style={{ minWidth: '100px' }}>已挂载模型</th>
                    <th style={{ minWidth: '150px' }}>最近同步</th>
                    <th style={{ minWidth: '280px', textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((provider) => (
                    <tr key={provider.id}>
                      <td style={{ width: '44px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selected.has(provider.id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(provider.id);
                            else next.delete(provider.id);
                            setSelected(next);
                          }}
                          aria-label={`选择 ${provider.name}`}
                        />
                      </td>
                      <td>
                        <div className="provider-name-cell">
                          <span className="provider-logo">{provider.name.slice(0, 1).toUpperCase()}</span>
                          <div>
                            <strong>{provider.name}</strong>
                            <code>{provider.id}</code>
                          </div>
                        </div>
                      </td>
                      <td>
                        <code className="provider-url" style={{ maxWidth: '300px' }}>
                          {provider.baseUrl}
                        </code>
                      </td>
                      <td>
                        <span className="protocol-chip">
                          {provider.api.replace('openai-', '').replace('anthropic-', 'Anthropic ')}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`runtime-status ${
                            provider.enabled && provider.auth.configured
                              ? 'is-ready'
                              : provider.enabled
                              ? 'is-warning'
                              : 'is-off'
                          }`}
                        >
                          {provider.enabled
                            ? provider.auth.configured
                              ? '就绪'
                              : '缺少密钥'
                            : '已停用'}
                        </span>
                        {provider.lastError && (
                          <small className="provider-error-dot" title={provider.lastError}>
                            异常
                          </small>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="settings-pill-btn"
                          style={{
                            background: '#eff6ff',
                            borderColor: '#bfdbfe',
                            color: '#1d4ed8',
                            fontWeight: 600,
                            padding: '3px 10px',
                            cursor: 'pointer',
                          }}
                          onClick={() => setDrawerProviderId(provider.id)}
                        >
                          {provider.models.length} 个模型 ⚙️
                        </button>
                      </td>
                      <td>
                        <span>{formatTime(provider.modelsFetchedAt)}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div
                          className="runtime-actions"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                          <button
                            type="button"
                            className="settings-pill-btn"
                            onClick={() => setDrawerProviderId(provider.id)}
                            style={{ fontWeight: 600 }}
                          >
                            模型管理
                          </button>
                          <button
                            type="button"
                            className="settings-pill-btn"
                            onClick={() => setEditing({ initial: provider })}
                          >
                            配置
                          </button>
                          <button
                            type="button"
                            className="settings-pill-btn"
                            onClick={() => setEditing({ initial: provider, isCopy: true })}
                            title="复制并新建通道"
                          >
                            复制
                          </button>
                          <button
                            type="button"
                            className="settings-pill-btn"
                            style={{ color: '#ef4444' }}
                            onClick={() => void handleDeleteProvider(provider)}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: 预置供应商市场 */}
      {activeTab === 'presets' && (
        <ProviderPresetsTab
          presets={presets}
          onCreateFromPreset={(preset) => setEditing({ preset })}
        />
      )}

      {/* 模型管理侧边抽屉 (Drawer) */}
      <ChannelModelsDrawer
        provider={drawerProvider}
        onClose={() => setDrawerProviderId(null)}
        onUpdated={replaceProvider}
        onOpenSelectModal={(p) => setBatchSelectProviderId(p.id)}
        onOpenTestModal={(p) => setTestingProvider(p)}
      />

      {/* 渠道编辑 / 新建模态弹窗 */}
      {editing && (
        <ChannelEditorModal
          initial={editing.initial}
          preset={editing.preset}
          isCopy={editing.isCopy}
          onSaved={(provider) => {
            replaceProvider(provider);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {/* 选择模型模态弹窗 */}
      {batchSelectProvider && (
        <SelectModelModal
          isOpen={Boolean(batchSelectProvider)}
          onClose={() => setBatchSelectProviderId(null)}
          currentModelIds={batchSelectProvider.models.map((m) => m.id)}
          candidateModels={batchCandidates}
          onConfirm={(selectedModelIds) => {
            void handleApplyBatchModels(batchSelectProvider, selectedModelIds);
          }}
          onFetchModels={async () => {
            const models = await discover(batchSelectProvider);
            return models.map((m) => m.id);
          }}
          providerId={batchSelectProvider.id}
          channelName={batchSelectProvider.name}
          baseUrl={batchSelectProvider.baseUrl}
          api={batchSelectProvider.api}
        />
      )}

      {/* 渠道模型测试模态弹窗 */}
      {testingProvider && (
        <ModelChannelTestModal
          isOpen={Boolean(testingProvider)}
          onClose={() => setTestingProvider(null)}
          channelName={testingProvider.name}
          baseUrl={testingProvider.baseUrl}
          api={testingProvider.api}
          providerId={testingProvider.id}
          models={testingProvider.models.map((m) => m.id)}
        />
      )}
    </div>
  );
}
