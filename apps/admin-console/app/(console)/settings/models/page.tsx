'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AdminModelUsagesResponse,
  AdminProvidersResponse,
  ConnectionTestResponse,
  ModelDescriptor,
  ProviderConfigPublic,
} from '@qitu/contracts';
import { useRouter } from 'next/navigation';
import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { fetchProviders, fetchUsages, testModelConnection } from '../../../../lib/api/modelRegistry';

type ModelStatus = 'ready' | 'pending';

interface RegisteredModel {
  key: string;
  providerId: string;
  providerName: string;
  model: ModelDescriptor;
  status: ModelStatus;
  statusReason: string;
  associatedAgents: string[];
}

interface ModelRegistryData {
  providers: AdminProvidersResponse;
  usages: AdminModelUsagesResponse;
}

interface TestState {
  running: boolean;
  result: ConnectionTestResponse | null;
  error: string;
}

function providerStatus(provider: ProviderConfigPublic): Pick<RegisteredModel, 'status' | 'statusReason'> {
  if (!provider.enabled) return { status: 'pending', statusReason: '供应商已停用' };
  if (!provider.baseUrl.trim()) return { status: 'pending', statusReason: '未配置 API 地址' };
  if (!provider.auth.configured) return { status: 'pending', statusReason: '未配置 API 密钥' };
  return { status: 'ready', statusReason: '已配置，可测试连接' };
}

function buildModels(data: ModelRegistryData): RegisteredModel[] {
  const usageLabels = new Map(data.usages.usages.map((usage) => [usage.id, usage.label]));
  const associations = new Map<string, string[]>();

  for (const binding of data.usages.bindings) {
    if (!binding.resolved) continue;
    const key = binding.resolved.providerId + '/' + binding.resolved.modelId;
    const labels = associations.get(key) ?? [];
    labels.push(usageLabels.get(binding.usageId) ?? binding.usageId);
    associations.set(key, labels);
  }

  return data.providers.providers.flatMap((provider) => {
    const status = providerStatus(provider);
    return provider.models.map((model) => ({
      key: provider.id + '/' + model.id,
      providerId: provider.id,
      providerName: provider.name,
      model,
      ...status,
      associatedAgents: associations.get(provider.id + '/' + model.id) ?? [],
    }));
  });
}

function formatContextLength(model: ModelDescriptor): string {
  if (model.contextWindow === null || model.contextWindow === undefined) return '未声明';
  if (model.contextWindow >= 1000) return Math.round(model.contextWindow / 1000) + 'k';
  return String(model.contextWindow);
}

function testMessage(state: TestState | undefined): string | null {
  if (!state || state.running) return null;
  if (state.result?.ok) return state.result.message ?? '连接测试通过';
  return state.error || state.result?.error || null;
}

export default function ModelsSettingsPage() {
  const router = useRouter();
  const [data, setData] = useState<ModelRegistryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [providers, usages] = await Promise.all([fetchProviders(), fetchUsages()]);
      setData({ providers, usages });
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('模型注册表加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const models = useMemo(() => (data ? buildModels(data) : []), [data]);
  const tabs = useMemo(() => {
    const readyCount = models.filter((model) => model.status === 'ready').length;
    const pendingCount = models.length - readyCount;
    return [
      { id: 'all', label: '全部', count: models.length },
      { id: 'ready', label: '可用', count: readyCount },
      { id: 'pending', label: '待配置', count: pendingCount },
    ];
  }, [models]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return models.filter((item) => {
      if (activeTab === 'ready' && item.status !== 'ready') return false;
      if (activeTab === 'pending' && item.status !== 'pending') return false;
      if (!query) return true;
      return [item.model.id, item.model.name, item.providerId, item.providerName]
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [activeTab, models, search]);

  async function handleTest(item: RegisteredModel): Promise<void> {
    setTestingKey(item.key);
    setTestStates((current) => ({
      ...current,
      [item.key]: { running: true, result: null, error: '' },
    }));
    try {
      const result = await testModelConnection(item.providerId, item.model.id);
      setTestStates((current) => ({ ...current, [item.key]: { running: false, result, error: '' } }));
    } catch (cause) {
      setTestStates((current) => ({
        ...current,
        [item.key]: {
          running: false,
          result: null,
          error: cause instanceof Error ? cause.message : '连接测试失败',
        },
      }));
    } finally {
      setTestingKey(null);
    }
  }

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) {
    return <div className="admin-settings-page">{stateView}</div>;
  }

  const empty = models.length === 0;

  return (
    <AionSettingsParadigm
      title="模型"
      description={
        <span>
          模型列表与模型供应商页面使用同一份注册表数据。只有供应商已启用、地址和密钥齐全的模型才标记为可用。{' '}
          <a href="/admin/settings/model-providers">管理供应商配置</a>
        </span>
      }
      searchPlaceholder="搜索模型或供应商..."
      searchQuery={search}
      onSearchChange={setSearch}
      primaryActionLabel="添加模型供应商"
      onPrimaryAction={() => router.push('/settings/model-providers')}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {empty ? (
        <div className="settings-empty">
          <div>暂无已登记模型</div>
          <button type="button" className="settings-pill-btn" onClick={() => router.push('/settings/model-providers')}>
            添加供应商并拉取模型
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="settings-empty">暂无匹配的模型</div>
      ) : (
        filtered.map((item) => {
          const test = testStates[item.key];
          const message = testMessage(test);
          return (
            <div key={item.key}>
              <RowCard
                avatarText={item.model.name.slice(0, 1) || item.model.id.slice(0, 1)}
                avatarBg={item.status === 'ready' ? '#165dff' : '#86909c'}
                name={item.model.name || item.model.id}
                statusText={item.status === 'ready' ? '可用' : '待配置'}
                statusType={item.status === 'ready' ? 'ok' : 'off'}
                description={
                  item.providerName +
                  ' · ' +
                  item.model.id +
                  ' · 上下文 ' +
                  formatContextLength(item.model) +
                  ' · ' +
                  item.statusReason
                }
                avatarStack={item.associatedAgents.map((agent) => agent.slice(0, 1))}
                testLabel={test?.result?.ok === false || test?.error ? '重试测试' : '测试连接'}
                testLoading={testingKey === item.key}
                onTestConnection={() => void handleTest(item)}
                editLabel="供应商配置"
                onEdit={() => router.push('/settings/model-providers')}
              />
              {message ? (
                <div
                  role="status"
                  style={{
                    color: test?.result?.ok ? 'var(--aion-success)' : 'var(--aion-danger)',
                    fontSize: 12,
                    padding: '0 16px 8px 72px',
                  }}
                >
                  {message}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </AionSettingsParadigm>
  );
}
