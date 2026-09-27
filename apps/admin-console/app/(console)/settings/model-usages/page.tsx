'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AdminModelUsagesResponse,
  AdminProvidersResponse,
  BindUsageRequest,
  ConnectionTestResponse,
  ModelUsageBinding,
  ModelUsageSlot,
} from '@qitu/contracts';
import { Badge, Button, EmptyState, InfoRow, SectionCard } from '@qitu/ui';
import { bindUsage, fetchProviders, fetchUsages, testUsageConnection } from '../../../../lib/api/modelRegistry';
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

/**
 * 用途级连接测试状态：只存测试结果，不存任何密钥。
 *
 * 测试用的是服务端**已保存**的绑定（含回落），不是下拉框里未保存的选择；
 * 因此它是「确认当前生效模型能通」而不是「预检准备保存的选择」。
 */
interface ConnectionTestState {
  running: boolean;
  result: ConnectionTestResponse | null;
  /** 网络/权限/未知资源等「请求本身」失败时的可重试文案。 */
  transportError: string;
}

const IDLE_CONNECTION_TEST: ConnectionTestState = {
  running: false,
  result: null,
  transportError: '',
};

function formatTestTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

/** 与供应商页一致的内联结果块：测试失败不上升为页面级错误。 */
function ConnectionTestResult({
  state,
  modelId,
}: {
  state: ConnectionTestState;
  modelId?: string | null;
}) {
  if (state.running) {
    return (
      <p className="admin-test-result admin-test-result-running" role="status">
        正在测试连通性（仅验证配置 / 鉴权 / 模型发现，不执行推理）…
      </p>
    );
  }

  const failure =
    state.transportError ||
    (state.result && !state.result.ok ? state.result.error ?? '测试未通过，请稍后重试。' : '');
  if (state.result === null && failure === '') return null;

  const ok = state.result?.ok === true;
  const text = ok ? state.result?.message : failure;
  const shownModelId = state.result?.modelId ?? modelId ?? null;

  return (
    <div className={`admin-test-result ${ok ? 'is-ok' : 'is-fail'}`} role="status">
      <div className="admin-test-result-head">
        <Badge tone={ok ? 'completed' : 'danger'} size="sm">
          {ok ? '连通' : '未通过'}
        </Badge>
        {typeof state.result?.latencyMs === 'number' ? (
          <span className="admin-test-result-meta">耗时 {state.result.latencyMs} ms</span>
        ) : null}
        {shownModelId ? (
          <span className="admin-test-result-meta">
            解析模型 <code className="admin-console-fingerprint">{shownModelId}</code>
          </span>
        ) : null}
        {state.result?.testedAt ? (
          <span className="admin-test-result-meta">测试时间 {formatTestTime(state.result.testedAt)}</span>
        ) : null}
      </div>
      {text ? <p className={ok ? 'admin-test-result-message' : 'admin-test-result-error'}>{text}</p> : null}
    </div>
  );
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
  const [testState, setTestState] = useState<ConnectionTestState>(IDLE_CONNECTION_TEST);

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

  /**
   * 用途级连接测试：按服务端保存的绑定（含 `fallbackTo`）解析实际生效模型并
   * 探测连通性。未绑定 / 无回落时服务端返回 `ok=false` 的明确文案，这里原样
   * 展示，**不**当作页面级错误。
   */
  async function handleTest() {
    setTestState({ running: true, result: null, transportError: '' });
    try {
      const result = await testUsageConnection(usage.id);
      setTestState({ running: false, result, transportError: '' });
    } catch (cause) {
      setTestState({
        running: false,
        result: null,
        transportError: cause instanceof Error ? cause.message : '测试失败，请稍后重试。',
      });
    }
  }

  const resolved = binding.resolved;
  const usageTestFailed =
    !testState.running && (testState.transportError !== '' || testState.result?.ok === false);
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

      <div className="admin-usage-test">
        <div className="admin-form-actions admin-form-actions-start">
          <Button size="sm" variant="secondary" onClick={handleTest} loading={testState.running}>
            {usageTestFailed ? '重试测试' : '测试当前模型'}
          </Button>
        </div>
        {!resolved ? (
          <p className="admin-usage-hint">
            该用途当前没有可用模型（含回落），测试会返回可恢复提示。请先在上方绑定供应商/模型，或检查回落用途
            是否已绑定，然后再测试。
          </p>
        ) : null}
        <ConnectionTestResult state={testState} modelId={resolved?.modelId ?? null} />
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
