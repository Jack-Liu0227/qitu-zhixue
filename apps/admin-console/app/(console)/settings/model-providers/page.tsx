'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type {
  AdminModelResponse,
  AdminProvidersResponse,
  ConnectionTestResponse,
  CreateManualModelRequest,
  ModelApi,
  ModelDescriptor,
  ModelModality,
  ProviderConfigPublic,
  ProviderPreset,
  UpdateManualModelRequest,
  UpsertProviderRequest,
} from '@qitu/contracts';
import { Badge, Button, EmptyState, Field, InfoRow, SectionCard } from '@qitu/ui';
import {
  createManualModel,
  deleteManualModel,
  deleteProvider,
  fetchProviders,
  newIdempotencyKey,
  refreshProvider,
  testModelConnection,
  testProviderConnection,
  updateManualModel,
  upsertProvider,
} from '../../../../lib/api/modelRegistry';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { SettingsSubNav } from '../../../../lib/components/SettingsSubNav';

/**
 * 模型供应商管理。
 *
 * 安全约定（`packages/contracts/src/models.ts`）：
 *  - 密钥只在写请求里出现一次，对外只回指纹；本页密钥输入为「只写」，
 *    不进入 React state、不打日志、不进 URL。
 *  - 自动拉取失败不报错，而是写进 `provider.lastError`，管理员看到的是
 *    「已保存配置 + 失败原因」，而不是整页崩掉。
 */

const API_OPTIONS: ReadonlyArray<{ value: ModelApi; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];

const MODALITY_OPTIONS: ReadonlyArray<{ value: ModelModality; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'audio', label: '语音' },
];

function modalityLabel(modality: ModelModality): string {
  return MODALITY_OPTIONS.find((option) => option.value === modality)?.label ?? modality;
}

function formatModalities(modalities: ReadonlyArray<ModelModality>): string {
  return modalities.length > 0 ? modalities.map(modalityLabel).join('、') : '—';
}

/** 把输入框里的可选数字解析为 `number | null`；空串表示「未声明」。 */
function parseOptionalCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 连接测试结果的内联展示状态。
 *
 * 只保存**测试结果**：不保存也不展示任何密钥；测试请求是空 body 的 `POST`，
 * 密钥只存在于服务端已保存配置里。
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

/**
 * 连接测试结果内联块。
 *
 * 刻意不复用 `AdminStateViews`：测试失败**不是**页面级错误，展示在卡片内即可，
 * 管理员可留在当前页直接重试，不用整页重载。
 */
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
  const shownModelId = modelId ?? state.result?.modelId ?? null;

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
            模型 <code className="admin-console-fingerprint">{shownModelId}</code>
          </span>
        ) : null}
        {state.result?.testedAt ? (
          <span className="admin-test-result-meta">测试时间 {formatTime(state.result.testedAt)}</span>
        ) : null}
      </div>
      {text ? <p className={ok ? 'admin-test-result-message' : 'admin-test-result-error'}>{text}</p> : null}
    </div>
  );
}

interface ProviderFormProps {
  /** 编辑已有供应商时传入。 */
  initial?: ProviderConfigPublic;
  /** 从预置模板新建时传入。 */
  preset?: ProviderPreset;
  onSaved: (provider: ProviderConfigPublic) => void;
  onCancel: () => void;
}

function ProviderForm({ initial, preset, onSaved, onCancel }: ProviderFormProps) {
  const editing = initial !== undefined;
  const idFixed = editing || preset !== undefined;

  const [id, setId] = useState(initial?.id ?? preset?.id ?? '');
  const [name, setName] = useState(initial?.name ?? preset?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? preset?.baseUrl ?? '');
  const [api, setApi] = useState<ModelApi>(initial?.api ?? preset?.api ?? 'openai-completions');
  const [authHeader, setAuthHeader] = useState(initial?.authHeader ?? preset?.authHeader ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // 密钥输入完全不进入 React state：提交时读一次，成功后清空。
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const pendingSaveRef = useRef<{ signature: string; key: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    const trimmedId = id.trim();
    if (trimmedId.length === 0) {
      setError('请填写供应商 ID（稳定的机器名，如 openai / deepseek）');
      return;
    }
    if (!/^[a-z0-9._-]+$/i.test(trimmedId)) {
      setError('供应商 ID 只能包含字母、数字、点、下划线与连字符');
      return;
    }
    if (name.trim().length === 0) {
      setError('请填写供应商名称');
      return;
    }
    const trimmedBaseUrl = baseUrl.trim();
    if (trimmedBaseUrl.length === 0) {
      setError('请填写网关地址');
      return;
    }
    if (!/^https?:\/\//i.test(trimmedBaseUrl)) {
      setError('网关地址必须以 http:// 或 https:// 开头');
      return;
    }

    const body: UpsertProviderRequest = {
      name: name.trim(),
      baseUrl: trimmedBaseUrl,
      api,
      authHeader,
    };
    // 密钥只在本次提交的请求体里出现一次；留空表示不修改已保存的密钥。
    const apiKey = apiKeyRef.current?.value ?? '';
    if (apiKey.length > 0) body.apiKey = apiKey;
    const signature = JSON.stringify({ ...body, apiKey: apiKey.length > 0 ? apiKey : null });
    if (pendingSaveRef.current?.signature !== signature) {
      pendingSaveRef.current = { signature, key: newIdempotencyKey() };
    }
    const idempotencyKey = pendingSaveRef.current.key;

    setSaving(true);
    try {
      const updated = await upsertProvider(trimmedId, body, idempotencyKey);
      pendingSaveRef.current = null;
      if (apiKeyRef.current) apiKeyRef.current.value = '';
      let provider = updated;
      try {
        const refreshed = await refreshProvider(updated.id);
        provider = refreshed.provider;
      } catch {
        // Provider configuration is already saved; an unsupported / failed
        // catalog endpoint must not hide the provider or block manual models.
      }
      onSaved(provider);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title={editing ? `编辑供应商：${initial.id}` : preset ? `新建供应商：${preset.id}` : '新建供应商'}
    >
      <form className="admin-provider-form" onSubmit={submit}>
        <Field
          label="供应商 ID"
          hint={idFixed ? '已由模板 / 已有配置确定，不可修改。' : '稳定的机器名，保存后不可修改。'}
          required={!idFixed}
        >
          <input
            value={id}
            onChange={(event) => setId(event.target.value)}
            disabled={idFixed}
            placeholder="例如 openai / deepseek / my-gateway"
            autoComplete="off"
          />
        </Field>

        <Field label="名称" required>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如 OpenAI、DeepSeek"
          />
        </Field>

        <Field label="网关地址" required hint="填供应商网关根地址，留空无效；保存时自动去掉结尾斜杠。">
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.example.com/v1"
          />
        </Field>

        <Field label="协议" hint="决定拉取模型列表与发起对话的请求形状。">
          <select value={api} onChange={(event) => setApi(event.target.value as ModelApi)}>
            {API_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="密钥传输方式"
          hint="开启后密钥作为 Authorization: Bearer 头发送；关闭则按供应商约定放入请求体。"
        >
          <label className="admin-checkbox-row">
            <input
              type="checkbox"
              checked={authHeader}
              onChange={(event) => setAuthHeader(event.target.checked)}
            />
            使用 Bearer 头传输密钥
          </label>
        </Field>

        <Field
          label="API 密钥（只写，可选）"
          hint="密钥只写不回显：服务端只保存不可逆指纹，本页面无法查看已存密钥。留空表示不修改已保存的密钥。"
        >
          <input
            ref={apiKeyRef}
            type="password"
            autoComplete="off"
            placeholder="仅本次提交时使用，保存后立即清空"
          />
        </Field>

        {error ? (
          <p className="qitu-field-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="admin-form-actions">
          <Button type="submit" loading={saving}>
            保存
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            取消
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

/**
 * 手工模型表单：新增与编辑复用同一个组件。
 *
 * `modelId` 是上游真实 ID，创建后不可变（契约 `UpdateManualModelRequest`
 * 故意不含它），因此编辑态只读。协议默认沿用供应商协议，改到不一致时给出
 * 不阻断的提示。提交时生成一次性 `Idempotency-Key`。
 */
function ManualModelForm({
  provider,
  initial,
  onSaved,
  onCancel,
}: {
  provider: ProviderConfigPublic;
  initial?: ModelDescriptor;
  onSaved: (result: AdminModelResponse, mode: 'create' | 'update') => void;
  onCancel: () => void;
}) {
  const editing = initial !== undefined;
  const [modelId, setModelId] = useState(initial?.id ?? '');
  const [displayName, setDisplayName] = useState(initial?.name ?? '');
  const [api, setApi] = useState<ModelApi>(initial?.api ?? provider.api);
  const [input, setInput] = useState<ModelModality[]>(initial?.input ?? ['text']);
  const [output, setOutput] = useState<ModelModality[]>(initial?.output ?? ['text']);
  const [contextWindow, setContextWindow] = useState(
    initial?.contextWindow !== null && initial?.contextWindow !== undefined
      ? String(initial.contextWindow)
      : '',
  );
  const [maxTokens, setMaxTokens] = useState(
    initial?.maxTokens !== null && initial?.maxTokens !== undefined ? String(initial.maxTokens) : '',
  );
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 供应商列表只返回启用中的模型，因此编辑态未知时按「启用」处理。
  const apiMismatch = api !== provider.api;

  function toggleModality(channel: 'input' | 'output', modality: ModelModality) {
    const setter = channel === 'input' ? setInput : setOutput;
    setter((current) =>
      current.includes(modality) ? current.filter((item) => item !== modality) : [...current, modality],
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    const trimmedId = modelId.trim();
    if (!editing) {
      if (trimmedId.length === 0) {
        setError('请填写上游模型 ID（实际请求用的 model 名称，如 gpt-4o-mini）');
        return;
      }
      if (/\s/.test(trimmedId)) {
        setError('上游模型 ID 不能包含空格');
        return;
      }
    }
    if (displayName.trim().length === 0) {
      setError('请填写展示名');
      return;
    }
    if (input.length === 0) {
      setError('请至少勾选一种输入模态');
      return;
    }
    if (output.length === 0) {
      setError('请至少勾选一种输出模态');
      return;
    }

    const parsedContext = parseOptionalCount(contextWindow);
    if (Number.isNaN(parsedContext)) {
      setError('上下文长度必须是数字，或留空表示未声明');
      return;
    }
    if (parsedContext !== null && parsedContext <= 0) {
      setError('上下文长度必须为正整数');
      return;
    }
    const parsedMaxTokens = parseOptionalCount(maxTokens);
    if (Number.isNaN(parsedMaxTokens)) {
      setError('最大输出 token 必须是数字，或留空表示未声明');
      return;
    }
    if (parsedMaxTokens !== null && parsedMaxTokens <= 0) {
      setError('最大输出 token 必须为正整数');
      return;
    }

    // 每次提交生成一把新键；失败重试请再次提交（服务端按 provider+model 隔离）。
    const idempotencyKey = newIdempotencyKey();
    setSaving(true);
    try {
      if (editing) {
        const body: UpdateManualModelRequest = {
          displayName: displayName.trim(),
          api,
          input,
          output,
          contextWindow: parsedContext,
          maxTokens: parsedMaxTokens,
          enabled,
          idempotencyKey,
        };
        onSaved(await updateManualModel(provider.id, initial.id, body), 'update');
      } else {
        const body: CreateManualModelRequest = {
          modelId: trimmedId,
          displayName: displayName.trim(),
          api,
          input,
          output,
          contextWindow: parsedContext,
          maxTokens: parsedMaxTokens,
          enabled,
          idempotencyKey,
        };
        onSaved(await createManualModel(provider.id, body), 'create');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请检查填写内容后重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title={editing ? `编辑模型：${initial.id}` : '手工添加模型'}>
      <form className="admin-provider-form" onSubmit={submit}>
        <Field
          label="上游模型 ID"
          required={!editing}
          hint={
            editing
              ? '上游真实 ID，不可修改；需要更换模型请停用或删除后新建。'
              : '实际发给上游的 model 名称，创建后不可修改。'
          }
        >
          <input
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            disabled={editing}
            placeholder="例如 gpt-4o-mini"
            autoComplete="off"
          />
        </Field>

        <Field label="展示名" required hint="平台内显示用，可随时修改，不影响实际请求。">
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="例如 GPT-4o mini"
          />
        </Field>

        <Field label="协议" hint="默认沿用供应商协议；只有确认上游按其他协议提供该模型时才改。">
          <select value={api} onChange={(event) => setApi(event.target.value as ModelApi)}>
            {API_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        {apiMismatch ? (
          <p className="admin-provider-note" role="status">
            该模型协议（{api}）与供应商默认协议（{provider.api}）不同，请确认上游确实支持，否则调用会失败。
          </p>
        ) : null}

        <Field label="输入模态" hint="能接收的内容类型；上游不返回能力时保守只勾「文本」。">
          <div className="admin-modality-grid">
            {MODALITY_OPTIONS.map((option) => (
              <label className="admin-checkbox-row" key={option.value}>
                <input
                  type="checkbox"
                  checked={input.includes(option.value)}
                  onChange={() => toggleModality('input', option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </Field>

        <Field label="输出模态" hint="能产出的内容类型；不确定时只勾「文本」。">
          <div className="admin-modality-grid">
            {MODALITY_OPTIONS.map((option) => (
              <label className="admin-checkbox-row" key={option.value}>
                <input
                  type="checkbox"
                  checked={output.includes(option.value)}
                  onChange={() => toggleModality('output', option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </Field>

        <Field label="上下文长度（tokens，可选）" hint="留空表示未声明；不确定时留空，不要猜测。">
          <input
            type="number"
            min={1}
            step={1}
            value={contextWindow}
            onChange={(event) => setContextWindow(event.target.value)}
            placeholder="例如 128000"
            inputMode="numeric"
          />
        </Field>

        <Field label="最大输出 tokens（可选）" hint="留空表示未声明。">
          <input
            type="number"
            min={1}
            step={1}
            value={maxTokens}
            onChange={(event) => setMaxTokens(event.target.value)}
            placeholder="例如 4096"
            inputMode="numeric"
          />
        </Field>

        <Field label="启用状态" hint="停用后该模型会从启用列表移除，不再参与 Agent 运行时。">
          <label className="admin-checkbox-row">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            启用该模型
          </label>
        </Field>

        {error ? (
          <p className="qitu-field-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="admin-form-actions">
          <Button type="submit" loading={saving}>
            {editing ? '保存修改' : '添加模型'}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            取消
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function ProviderCard({
  provider,
  onEdit,
  onDeleted,
  onUpdated,
  onReload,
}: {
  provider: ProviderConfigPublic;
  onEdit: () => void;
  onDeleted: () => void;
  onUpdated: (provider: ProviderConfigPublic) => void;
  onReload: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [modelForm, setModelForm] = useState<{ initial?: ModelDescriptor } | null>(null);
  const [confirmingModelId, setConfirmingModelId] = useState<string | null>(null);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [modelError, setModelError] = useState('');
  const [modelNotice, setModelNotice] = useState('');
  const [testState, setTestState] = useState<ConnectionTestState>(IDLE_CONNECTION_TEST);
  const [modelTests, setModelTests] = useState<Record<string, ConnectionTestState>>({});

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshNote('');
    try {
      const result = await refreshProvider(provider.id);
      onUpdated(result.provider);
      setRefreshNote(
        result.fetched > 0
          ? `已拉取 ${result.fetched} 个模型。`
          : result.provider.lastError
            ? `拉取失败：${result.provider.lastError}`
            : '上游未返回模型。',
      );
    } catch (cause) {
      setRefreshNote(cause instanceof Error ? cause.message : '拉取失败，请稍后重试。');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteProvider(provider.id);
      onDeleted();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : '删除失败，请稍后重试。');
      setDeleting(false);
    }
  }

  /**
   * Provider 级连接测试。
   *
   * 上游不可达 / 鉴权失败由服务端归一为 `ok=false`；请求本身失败（离线、权限、
   * 未知供应商）在这里被捕获成内联可重试文案，**不**升级为页面级错误。
   */
  async function handleTestConnection() {
    setTestState({ running: true, result: null, transportError: '' });
    try {
      const result = await testProviderConnection(provider.id);
      setTestState({ running: false, result, transportError: '' });
    } catch (cause) {
      setTestState({
        running: false,
        result: null,
        transportError: cause instanceof Error ? cause.message : '测试失败，请稍后重试。',
      });
    }
  }

  /** Model 级连接测试；每个模型行独立维护结果，互不影响。 */
  async function handleTestModel(model: ModelDescriptor) {
    setModelTests((current) => ({
      ...current,
      [model.id]: { running: true, result: null, transportError: '' },
    }));
    try {
      const result = await testModelConnection(provider.id, model.id);
      setModelTests((current) => ({
        ...current,
        [model.id]: { running: false, result, transportError: '' },
      }));
    } catch (cause) {
      setModelTests((current) => ({
        ...current,
        [model.id]: {
          running: false,
          result: null,
          transportError: cause instanceof Error ? cause.message : '测试失败，请稍后重试。',
        },
      }));
    }
  }

  const providerTestFailed =
    !testState.running && (testState.transportError !== '' || testState.result?.ok === false);

  /**
   * 手工模型新增 / 编辑成功后的本地合并 + 静默刷新。
   * 后端只把启用中的模型放进列表，所以停用成功后本地也把它移出。
   */
  function handleModelSaved(result: AdminModelResponse, mode: 'create' | 'update') {
    const label = result.model.name || result.model.id;
    setModelForm(null);
    setModelError('');
    const others = provider.models.filter((model) => model.id !== result.model.id);
    onUpdated({ ...provider, models: result.enabled ? [...others, result.model] : others });
    setModelNotice(
      mode === 'create'
        ? `已添加模型「${label}」。`
        : result.enabled
          ? `已保存模型「${label}」。`
          : `已停用模型「${label}」，它已从启用列表移除。`,
    );
    onReload();
  }

  /** 删除**未绑定**的手工模型；已绑定模型由服务端 409 拒绝，这里展示可恢复文案。 */
  async function handleDeleteModel(model: ModelDescriptor) {
    setDeletingModelId(model.id);
    setModelError('');
    setModelNotice('');
    try {
      await deleteManualModel(provider.id, model.id, newIdempotencyKey());
      setConfirmingModelId(null);
      onUpdated({ ...provider, models: provider.models.filter((item) => item.id !== model.id) });
      setModelNotice(`已删除手工模型「${model.name || model.id}」。`);
      onReload();
    } catch (cause) {
      setModelError(cause instanceof Error ? cause.message : '删除失败，请稍后重试。');
    } finally {
      setDeletingModelId(null);
    }
  }

  return (
    <SectionCard
      title={provider.name}
      action={
        <Badge tone={provider.auth.configured ? 'completed' : 'attention'}>
          {provider.auth.configured ? '已配置密钥' : '未配置密钥'}
        </Badge>
      }
    >
      <div className="admin-provider-info">
        <InfoRow label="ID" value={<code className="admin-console-fingerprint">{provider.id}</code>} />
        <InfoRow label="网关地址" value={provider.baseUrl || '—'} />
        <InfoRow label="协议" value={provider.api} />
        <InfoRow label="密钥指纹" value={provider.auth.keyFingerprint ? <code className="admin-console-fingerprint">{provider.auth.keyFingerprint}</code> : '—'} muted={!provider.auth.keyFingerprint} />
        <InfoRow label="模型数" value={`${provider.models.length} 个`} />
        <InfoRow label="最近拉取" value={formatTime(provider.modelsFetchedAt)} />
        <InfoRow label="最近更新" value={`${formatTime(provider.updatedAt)}${provider.updatedBy ? ` · ${provider.updatedBy}` : ''}`} />
      </div>

      {provider.lastError ? (
        <p className="admin-provider-lasterror">
          最近一次拉取失败：{provider.lastError}
        </p>
      ) : null}

      <div className="admin-models-block">
        <div className="admin-models-block-head">
          <h3 className="admin-models-block-title">模型（{provider.models.length}）</h3>
          {modelForm ? null : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setModelForm({});
                setModelNotice('');
                setModelError('');
              }}
            >
              手工添加模型
            </Button>
          )}
        </div>
        <p className="admin-provider-note admin-models-block-hint">
          仅列出启用中的模型；远程模型随「自动拉取」更新，手工模型可编辑或删除。密钥不会在此展示。
        </p>

        {provider.models.length > 0 ? (
          <ul className="admin-model-list">
            {provider.models.map((model) => {
              const isManual = model.source === 'manual';
              const test = modelTests[model.id];
              return (
                <li className="admin-model-row" key={model.id}>
                  <div className="admin-model-row-head">
                    <span className="admin-model-name">{model.name || model.id}</span>
                    <span className="admin-model-badges">
                      <Badge tone={isManual ? 'primary' : 'neutral'} size="sm">
                        {isManual ? '手工模型' : '由上游拉取'}
                      </Badge>
                      <Badge tone="completed" size="sm">
                        已启用
                      </Badge>
                    </span>
                  </div>
                  <div className="admin-model-row-meta">
                    <span className="admin-model-meta-item">
                      <span className="admin-model-meta-label">模型 ID</span>
                      <code className="admin-console-fingerprint">{model.id}</code>
                    </span>
                    <span className="admin-model-meta-item">
                      <span className="admin-model-meta-label">输入</span>
                      <span>{formatModalities(model.input)}</span>
                    </span>
                    <span className="admin-model-meta-item">
                      <span className="admin-model-meta-label">输出</span>
                      <span>{formatModalities(model.output)}</span>
                    </span>
                    <span className="admin-model-meta-item">
                      <span className="admin-model-meta-label">上下文</span>
                      <span>{model.contextWindow ?? '—'}</span>
                    </span>
                    <span className="admin-model-meta-item">
                      <span className="admin-model-meta-label">最大输出</span>
                      <span>{model.maxTokens ?? '—'}</span>
                    </span>
                  </div>
                  <div className="admin-model-row-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={test?.running ?? false}
                      onClick={() => handleTestModel(model)}
                    >
                      {test && !test.running && (test.transportError !== '' || test.result?.ok === false)
                        ? '重试测试'
                        : '测试模型'}
                    </Button>
                    {isManual ? (
                      confirmingModelId === model.id ? (
                        <>
                          <span className="admin-confirm-text">确认删除？仍被 Agent 运行时引用的模型无法删除。</span>
                          <Button
                            size="sm"
                            variant="danger"
                            loading={deletingModelId === model.id}
                            onClick={() => handleDeleteModel(model)}
                          >
                            确认删除
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmingModelId(null)}
                            disabled={deletingModelId === model.id}
                          >
                            取消
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setModelForm({ initial: model });
                              setModelNotice('');
                              setModelError('');
                            }}
                          >
                            编辑
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmingModelId(model.id)}>
                            删除
                          </Button>
                        </>
                      )
                    ) : (
                      <span className="admin-model-row-note">远程模型由上游管理，不能在此编辑或删除。</span>
                    )}
                  </div>
                  <ConnectionTestResult state={test ?? IDLE_CONNECTION_TEST} modelId={model.id} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="admin-provider-empty">还没有模型，点击「自动拉取」或手工添加。</p>
        )}

        {modelForm ? (
          <div className="admin-provider-form-wrap admin-model-form-wrap">
            <ManualModelForm
              provider={provider}
              initial={modelForm.initial}
              onSaved={handleModelSaved}
              onCancel={() => setModelForm(null)}
            />
          </div>
        ) : null}

        {modelNotice ? (
          <p className="admin-provider-note" role="status">
            {modelNotice}
          </p>
        ) : null}
        {modelError ? (
          <p className="qitu-field-error" role="alert">
            {modelError}
          </p>
        ) : null}
      </div>

      <div className="admin-provider-actions">
        <Button size="sm" onClick={handleRefresh} loading={refreshing}>
          自动拉取
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleTestConnection}
          loading={testState.running}
        >
          {providerTestFailed ? '重试测试' : '测试连接'}
        </Button>
        <Button size="sm" variant="secondary" onClick={onEdit}>
          编辑
        </Button>
        {confirmingDelete ? (
          <>
            <span className="admin-confirm-text">确认删除？引用它的 Agent 配置会被拒绝，需先清理配置。</span>
            <Button size="sm" variant="danger" onClick={handleDelete} loading={deleting}>
              确认删除
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
              取消
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)}>
            删除
          </Button>
        )}
      </div>

      <ConnectionTestResult state={testState} />

      {refreshNote ? (
        <p className="admin-provider-note" role="status">
          {refreshNote}
        </p>
      ) : null}
      {deleteError ? (
        <p className="qitu-field-error" role="alert">
          {deleteError}
        </p>
      ) : null}
    </SectionCard>
  );
}

export default function AdminModelProvidersPage() {
  const [data, setData] = useState<AdminProvidersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [form, setForm] = useState<{ initial?: ProviderConfigPublic; preset?: ProviderPreset } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchProviders());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('未知错误'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 静默刷新：模型增删改后保持列表最新，但不触发整页骨架屏。 */
  const reloadProviders = useCallback(async () => {
    try {
      setData(await fetchProviders());
    } catch {
      // 静默刷新失败时保留现有数据；用户下次操作或点击重试即可恢复。
    }
  }, []);

  const presets = useMemo(() => data?.presets ?? [], [data]);
  const configuredIds = useMemo(() => new Set((data?.providers ?? []).map((p) => p.id)), [data]);

  function handleSaved(provider: ProviderConfigPublic) {
    setData((current) =>
      current
        ? {
            ...current,
            providers: [
              ...current.providers.filter((p) => p.id !== provider.id),
              provider,
            ],
          }
        : current,
    );
    setForm(null);
  }

  function handleDeleted() {
    setForm(null);
    void load();
  }

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) {
    return (
      <div className="admin-settings-page">
        <SettingsSubNav />
        {stateView}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="admin-settings-page">
      <SettingsSubNav />

      <div className="admin-page-header">
        <h1>模型供应商</h1>
        <p>配置各 LLM 供应商的网关地址与密钥，自动拉取可用模型列表，并可手工补充模型。</p>
      </div>

      {form ? (
        <div className="admin-provider-form-wrap">
          <ProviderForm
            initial={form.initial}
            preset={form.preset}
            onSaved={handleSaved}
            onCancel={() => setForm(null)}
          />
        </div>
      ) : (
        <div className="admin-form-actions admin-form-actions-start">
          <Button onClick={() => setForm({})}>新建供应商</Button>
        </div>
      )}

      {data.providers.length === 0 ? (
        <div className="admin-provider-empty-block">
          <EmptyState
            title="还没有配置供应商"
            description="从下方预置模板快速添加，或点击「新建供应商」手动填写网关地址。"
          />
        </div>
      ) : (
        <div className="admin-settings-panels">
          {data.providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onEdit={() => setForm({ initial: provider })}
              onDeleted={handleDeleted}
              onUpdated={(updated) =>
                setData((current) =>
                  current
                    ? {
                        ...current,
                        providers: current.providers.map((p) => (p.id === updated.id ? updated : p)),
                      }
                    : current,
                )
              }
              onReload={reloadProviders}
            />
          ))}
        </div>
      )}

      <section className="admin-presets-section">
        <h2>预置模板</h2>
        <p className="admin-presets-hint">点击「使用模板」预填网关地址、协议与建议模型，保存后再配置密钥。</p>
        <div className="admin-settings-panels">
          {presets.map((preset) => (
            <SectionCard
              key={preset.id}
              title={preset.name}
              action={
                configuredIds.has(preset.id) ? (
                  <Badge tone="neutral" size="sm">
                    已配置
                  </Badge>
                ) : null
              }
            >
              <div className="admin-provider-info">
                <InfoRow label="ID" value={<code className="admin-console-fingerprint">{preset.id}</code>} />
                <InfoRow label="网关地址" value={preset.baseUrl} />
                <InfoRow label="协议" value={preset.api} />
                <InfoRow label="建议模型" value={preset.suggestedModels.map((m) => m.name || m.id).join('、') || '—'} />
              </div>
              <div className="admin-form-actions admin-form-actions-start">
                <Button size="sm" variant="secondary" onClick={() => setForm({ preset })}>
                  使用模板
                </Button>
              </div>
            </SectionCard>
          ))}
        </div>
      </section>
    </div>
  );
}
