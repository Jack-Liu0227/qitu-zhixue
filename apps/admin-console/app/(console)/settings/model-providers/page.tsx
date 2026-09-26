'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type {
  AdminProvidersResponse,
  ModelApi,
  ProviderConfigPublic,
  ProviderPreset,
  UpsertProviderRequest,
} from '@qitu/contracts';
import { Badge, Button, EmptyState, Field, InfoRow, SectionCard } from '@qitu/ui';
import {
  deleteProvider,
  fetchProviders,
  refreshProvider,
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

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
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

    setSaving(true);
    try {
      const updated = await upsertProvider(trimmedId, body);
      if (apiKeyRef.current) apiKeyRef.current.value = '';
      onSaved(updated);
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

function ProviderCard({
  provider,
  onEdit,
  onDeleted,
  onUpdated,
}: {
  provider: ProviderConfigPublic;
  onEdit: () => void;
  onDeleted: () => void;
  onUpdated: (provider: ProviderConfigPublic) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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

      {provider.models.length > 0 ? (
        <div className="admin-provider-models">
          {provider.models.map((model) => (
            <span className="admin-model-chip" key={model.id} title={`${model.id} · ${model.source === 'manual' ? '手填' : '自动拉取'}`}>
              {model.name || model.id}
            </span>
          ))}
        </div>
      ) : (
        <p className="admin-provider-empty">还没有模型，点击「自动拉取」或从预置模板添加。</p>
      )}

      <div className="admin-provider-actions">
        <Button size="sm" onClick={handleRefresh} loading={refreshing}>
          自动拉取
        </Button>
        <Button size="sm" variant="secondary" onClick={onEdit}>
          编辑
        </Button>
        {confirmingDelete ? (
          <>
            <span className="admin-confirm-text">确认删除？引用它的用途会被解绑。</span>
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
        <p>配置各 LLM 供应商的网关地址与密钥，自动拉取可用模型列表。</p>
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
