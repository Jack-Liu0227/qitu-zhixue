'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdminModelUsagesResponse,
  AdminProvidersResponse,
  BindUsageRequest,
  ConnectionTestResponse,
  ModelUsageBinding,
  ModelUsageSlot,
  ProviderConfigPublic,
} from '@qitu/contracts';
import { Badge, Button, EmptyState, InfoRow, SectionCard } from '@qitu/ui';
import { bindUsage, fetchProviders, fetchUsages, testUsageConnection } from '../../../../lib/api/modelRegistry';
import { AdminPermissionError } from '../../../../lib/api/types';
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

/** 供应商下拉选项：只带用途页需要的字段，密钥状态与启用状态单独透出。 */
interface ProviderOption {
  id: string;
  name: string;
  models: { id: string; name: string }[];
  /** 服务端是否已持有可用密钥（`auth.configured`）。 */
  authConfigured: boolean;
  /** 供应商是否启用。契约当前未透出该字段，后端一旦返回 `enabled=false` 即生效。 */
  enabled: boolean;
}

/**
 * 供应商是否处于启用状态。
 *
 * `ProviderConfigPublic` 目前没有 `enabled`，但后端 `resolveRuntimeTarget` 会用
 * `MODEL_PROVIDER_DISABLED` 拒绝停用的供应商。这里做兼容读取：字段缺失视为启用，
 * 只有显式 `enabled === false` 才判停用，避免把正常供应商误判为停用。
 */
function isProviderEnabled(provider: ProviderConfigPublic): boolean {
  return (provider as ProviderConfigPublic & { enabled?: boolean }).enabled !== false;
}

/**
 * 模型下拉的禁用原因；返回 `null` 表示可以正常选模型。
 *
 * 覆盖「没有供应商 / 未选择供应商 / 供应商不存在 / 已停用 / 未配置密钥 / 没有模型」
 * 六类阻塞，每种都给出「请先配置并保存服务提供方/模型」的可执行提示，而不是渲染一个
 * 看似可选、实则没有数据的下拉框。
 */
function modelSelectionBlocker(
  providerId: string,
  provider: ProviderOption | null,
  providerCount: number,
): string | null {
  if (providerCount === 0) {
    return '还没有可用的服务提供方，请先到「模型供应商」配置并保存服务提供方/模型，再回来绑定。';
  }
  if (providerId === UNBOUND) {
    return '请先选择服务提供方并配置保存模型；若该用途需要解绑，保持「不绑定」直接保存即可。';
  }
  if (provider === null) {
    return '所选服务提供方已不存在，请先配置并保存服务提供方/模型。';
  }
  if (!provider.enabled) {
    return '该服务提供方已停用，请先在「模型供应商」启用并保存服务提供方/模型。';
  }
  if (!provider.authConfigured) {
    return '该服务提供方尚未配置密钥，请先在「模型供应商」配置并保存服务提供方/模型。';
  }
  if (provider.models.length === 0) {
    return '该服务提供方还没有可用模型，请先拉取或添加模型并保存，再选择模型。';
  }
  return null;
}

/** 把写操作的异常归类为「权限失败」与普通错误；权限失败需要在按钮区显式呈现。 */
function classifyActionError(
  cause: unknown,
  fallback: string,
): { message: string; permissionDenied: boolean } {
  if (cause instanceof AdminPermissionError) {
    return {
      message: '当前账号没有修改模型绑定的权限，请使用管理员账号登录后重试。',
      permissionDenied: true,
    };
  }
  if (cause instanceof Error) return { message: cause.message, permissionDenied: false };
  return { message: fallback, permissionDenied: false };
}

function UsageCard({
  usage,
  binding,
  providers,
  onSaved,
}: {
  usage: ModelUsageSlot;
  binding: ModelUsageBinding;
  providers: ProviderOption[];
  onSaved: (binding: ModelUsageBinding) => void;
}) {
  const [providerId, setProviderId] = useState(binding.providerId ?? UNBOUND);
  const [modelId, setModelId] = useState(binding.modelId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testState, setTestState] = useState<ConnectionTestState>(IDLE_CONNECTION_TEST);
  // 递增令牌：切换供应商或保存后作废仍在飞的测试，避免旧结果覆盖新状态。
  const testRunRef = useRef(0);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === providerId) ?? null,
    [providers, providerId],
  );
  const providerModels = selectedProvider?.models ?? [];
  // 禁用原因；null 才表示「当前供应商可正常选模型」。
  const blocker = modelSelectionBlocker(providerId, selectedProvider, providers.length);
  // 只承认当前供应商 `models` 数组里真实存在的模型对象，绝不只凭字符串相等。
  const selectedModel =
    modelId === '' ? null : (providerModels.find((model) => model.id === modelId) ?? null);
  const canSave =
    providerId === UNBOUND
      ? true
      : selectedProvider !== null && blocker === null && selectedModel !== null;

  /** 清空测试结果，并让仍在飞的测试请求作废。 */
  function clearTestResult() {
    testRunRef.current += 1;
    setTestState(IDLE_CONNECTION_TEST);
  }

  /**
   * 供应商 / 模型清单变化后收敛本地选择：供应商被删除或模型被下线时立即回退，
   * 避免带着失效的字符串去提交。缺少密钥、无模型仍保留供应商，让用户就地看到原因。
   */
  useEffect(() => {
    if (providerId === UNBOUND) return;
    const provider = providers.find((item) => item.id === providerId);
    if (provider === undefined) {
      setProviderId(UNBOUND);
      setModelId('');
      clearTestResult();
      return;
    }
    if (modelId !== '' && !provider.models.some((model) => model.id === modelId)) {
      setModelId('');
      clearTestResult();
    }
  }, [providers, providerId, modelId]);

  function selectProvider(id: string) {
    setProviderId(id);
    setModelId('');
    setSaved(false);
    setError('');
    clearTestResult();
  }

  function selectModel(id: string) {
    // 只接受当前供应商模型清单里的 id，下拉之外的字符串一律拒绝。
    const model = providerModels.find((candidate) => candidate.id === id) ?? null;
    if (id !== '' && model === null) {
      setModelId('');
      setError('所选模型不属于当前服务提供方，请重新选择。');
      return;
    }
    setModelId(model?.id ?? '');
    setSaved(false);
    setError('');
  }

  async function save() {
    if (saving) return;
    setError('');
    setSaved(false);

    // 解绑：显式提交 null，仍是幂等写操作。
    if (providerId === UNBOUND) {
      setSaving(true);
      try {
        const updated = await bindUsage(usage.id, { providerId: null, modelId: null });
        onSaved(updated);
        setSaved(true);
        clearTestResult();
      } catch (cause) {
        const failure = classifyActionError(cause, '保存失败，请稍后重试。');
        setPermissionDenied(failure.permissionDenied);
        setError(failure.permissionDenied ? '' : failure.message);
      } finally {
        setSaving(false);
      }
      return;
    }

    // 保存前的前端二次校验：命中的必须是真实存在的 provider 对象与其 models 成员。
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) {
      setError('所选服务提供方已不存在，请刷新后重新配置并保存服务提供方/模型。');
      return;
    }
    const model = provider.models.find((item) => item.id === modelId);
    if (!model) {
      setError('请选择该服务提供方下的可用模型，或先配置并保存服务提供方/模型。');
      return;
    }
    if (!provider.enabled) {
      setError('该服务提供方已停用，请先启用并保存服务提供方/模型。');
      return;
    }
    if (!provider.authConfigured) {
      setError('该服务提供方尚未配置密钥，请先配置并保存服务提供方/模型。');
      return;
    }

    const body: BindUsageRequest = { providerId: provider.id, modelId: model.id };
    setSaving(true);
    try {
      const updated = await bindUsage(usage.id, body);
      onSaved(updated);
      setSaved(true);
      clearTestResult();
    } catch (cause) {
      const failure = classifyActionError(cause, '保存失败，请稍后重试。');
      setPermissionDenied(failure.permissionDenied);
      setError(failure.permissionDenied ? '' : failure.message);
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
    const runId = testRunRef.current + 1;
    testRunRef.current = runId;
    setTestState({ running: true, result: null, transportError: '' });
    try {
      const result = await testUsageConnection(usage.id);
      if (testRunRef.current !== runId) return; // 已被切换供应商 / 保存等操作作废
      setTestState({ running: false, result, transportError: '' });
    } catch (cause) {
      if (testRunRef.current !== runId) return;
      const failure = classifyActionError(cause, '测试失败，请稍后重试。');
      setPermissionDenied(failure.permissionDenied);
      setTestState({ running: false, result: null, transportError: failure.message });
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
          <select
            value={providerId}
            onChange={(event) => selectProvider(event.target.value)}
            disabled={saving || providers.length === 0}
          >
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
            onChange={(event) => selectModel(event.target.value)}
            disabled={saving || blocker !== null}
            aria-describedby={blocker ? `${usage.id}-model-blocker` : undefined}
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
          <Button
            size="sm"
            onClick={save}
            loading={saving}
            disabled={saving || permissionDenied || !canSave}
          >
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
                clearTestResult();
              }}
              disabled={saving}
            >
              清空为不绑定
            </Button>
          ) : null}
        </div>
      </div>

      {blocker ? (
        <p id={`${usage.id}-model-blocker`} className="admin-usage-hint" role="status">
          {blocker}
        </p>
      ) : null}

      <div className="admin-usage-test">
        <div className="admin-form-actions admin-form-actions-start">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleTest}
            loading={testState.running}
            disabled={saving || permissionDenied}
          >
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
      {permissionDenied ? (
        <p className="qitu-field-error" role="alert">
          当前账号没有修改模型绑定的权限，请使用管理员账号登录后重试。
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

  const providerOptions: ProviderOption[] = providers.providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    models: provider.models.map((model) => ({ id: model.id, name: model.name })),
    authConfigured: provider.auth.configured,
    enabled: isProviderEnabled(provider),
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
