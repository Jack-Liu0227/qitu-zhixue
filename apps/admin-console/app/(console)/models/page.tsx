'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  InfoRow,
  OfflineBanner,
  SectionCard,
  SkeletonBlock,
} from '@qitu/ui';
import type {
  AdminModelsResponse,
  ModelConfigPublic,
  ModelSlot,
  ModelSlotOption,
  ModelRuntimeResponse,
  UpdateModelConfigRequest,
} from '@qitu/contracts';

/**
 * 模型配置页：文本模型（text）与 Live 模型（live）两个插槽。
 *
 * 安全约定（见 `packages/contracts/src/settings.ts`）：
 *  - 服务端永不返回明文 API Key，只返回 `configured` 与 `keyFingerprint`；
 *  - 本页的密钥输入是「只写」的：输入值不进入 React state、不写入 URL/日志，
 *    只在提交的请求体里出现一次，保存成功后立即清空输入框。
 */

const SLOT_ORDER: ModelSlot[] = ['text', 'live'];
const SLOT_LABELS: Record<ModelSlot, string> = {
  text: '文本模型',
  live: 'Live 模型',
};

/** 当前配置不在预设选项里时使用的哨兵值。 */
const CURRENT_SENTINEL = '__current__';

function optionValue(option: ModelSlotOption): string {
  return `${option.provider}::${option.modelId}`;
}

function findOptionByConfig(
  options: ModelSlotOption[],
  config: ModelConfigPublic | undefined,
): ModelSlotOption | undefined {
  if (!config) return undefined;
  return options.find((option) => option.provider === config.provider && option.modelId === config.modelId);
}

function formatUpdatedAt(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

type LoadState = 'loading' | 'error' | 'ready';

interface ModelsData {
  slots: ModelConfigPublic[];
  options: ModelSlotOption[];
}

function ModelSlotCard({
  slot,
  config,
  options,
  onSaved,
}: {
  slot: ModelSlot;
  config: ModelConfigPublic | undefined;
  options: ModelSlotOption[];
  onSaved: (config: ModelConfigPublic) => void;
}) {
  const slotOptions = options.filter((option) => option.slot === slot);
  const initialOption = findOptionByConfig(slotOptions, config);

  const [selectedValue, setSelectedValue] = useState(
    initialOption ? optionValue(initialOption) : CURRENT_SENTINEL,
  );
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // 密钥输入完全不进入 React state：提交时读一次，成功后清空。
  const apiKeyRef = useRef<HTMLInputElement>(null);

  const selectedOption = slotOptions.find((option) => optionValue(option) === selectedValue);
  // 当前配置不在预设选项里时无法得知是否需要密钥，此时保守地允许填写密钥。
  const showApiKey = selectedOption ? selectedOption.requiresApiKey : true;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSubmitError(null);
    setSaved(false);
    setBaseUrlError(null);

    const body: UpdateModelConfigRequest = {};
    if (selectedOption) {
      body.provider = selectedOption.provider;
      body.modelId = selectedOption.modelId;
    }

    const trimmedBaseUrl = baseUrl.trim();
    if (trimmedBaseUrl) {
      if (!/^https?:\/\//i.test(trimmedBaseUrl)) {
        setBaseUrlError('自定义网关地址必须以 http:// 或 https:// 开头');
        setSaving(false);
        return;
      }
      body.baseUrl = trimmedBaseUrl;
    } else {
      body.baseUrl = null;
    }

    // 只在本次提交的请求体里携带明文密钥，且绝不打日志、不进 URL。
    const apiKey = apiKeyRef.current?.value ?? '';
    if (apiKey) {
      body.apiKey = apiKey;
    }

    try {
      const response = await fetch(`/api/v1/admin/models/${slot}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (response.status === 0) {
        setSubmitError('无法连接服务器，请检查网络后重试。');
        return;
      }

      if (!response.ok) {
        let message = `保存失败（HTTP ${response.status}）`;
        try {
          const payload = (await response.json()) as { message?: string };
          if (payload.message) message = payload.message;
        } catch {
          // 响应体不是 JSON 时保留默认错误文案。
        }
        setSubmitError(message);
        return;
      }

      const payload = (await response.json()) as { data?: ModelConfigPublic };
      if (!payload.data) {
        setSubmitError('保存成功，但响应格式不正确。');
        return;
      }

      onSaved(payload.data);
      if (apiKeyRef.current) apiKeyRef.current.value = '';
      setBaseUrl(payload.data.baseUrl ?? '');
      const savedOption = findOptionByConfig(slotOptions, payload.data);
      setSelectedValue(savedOption ? optionValue(savedOption) : CURRENT_SENTINEL);
      setSaved(true);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : '保存失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title={SLOT_LABELS[slot]}
      action={
        <Badge tone={config?.configured ? 'completed' : 'attention'}>
          {config?.configured ? '已配置密钥' : '未配置密钥'}
        </Badge>
      }
    >
      <div className="admin-models-current">
        <InfoRow label="供应商" value={config?.provider ?? '—'} />
        <InfoRow label="模型" value={config?.modelId ?? '—'} />
        <InfoRow label="自定义网关" value={config?.baseUrl ?? '默认地址'} muted={!config?.baseUrl} />
        <InfoRow
          label="密钥指纹"
          value={
            config?.keyFingerprint ? (
              <code className="admin-console-fingerprint">{config.keyFingerprint}</code>
            ) : (
              '—'
            )
          }
          muted={!config?.keyFingerprint}
        />
        <InfoRow label="最近更新" value={formatUpdatedAt(config?.updatedAt)} />
        <InfoRow label="更新人" value={config?.updatedBy ?? '—'} />
      </div>

      <form className="admin-models-form" onSubmit={submit}>
        <Field label={`${SLOT_LABELS[slot]}选项`} hint="选择服务端预设的供应商与模型组合。">
          <select
            value={selectedValue}
            onChange={(event) => setSelectedValue(event.target.value)}
            disabled={slotOptions.length === 0}
          >
            {initialOption ? null : (
              <option value={CURRENT_SENTINEL} disabled>
                当前配置：{config?.provider ?? '—'} / {config?.modelId ?? '—'}（不在预设列表中）
              </option>
            )}
            {slotOptions.map((option) => (
              <option key={optionValue(option)} value={optionValue(option)}>
                {option.label}（{option.provider} / {option.modelId}）
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="自定义网关地址（可选）"
          hint="留空表示使用供应商默认地址（保存时会清空已配置的自定义网关）。"
          error={baseUrlError}
        >
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              if (baseUrlError) setBaseUrlError(null);
            }}
            placeholder="https://gateway.example.com/v1"
          />
        </Field>

        {showApiKey ? (
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
        ) : null}

        {submitError ? (
          <p className="qitu-field-error" role="alert">
            {submitError}
          </p>
        ) : null}
        {saved ? (
          <p className="admin-models-save-ok" role="status">
            已保存
          </p>
        ) : null}

        <div className="admin-models-form-actions">
          <Button type="submit" loading={saving} disabled={slotOptions.length === 0 && !selectedOption}>
            保存配置
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

export default function AdminModelsPage() {
  const [data, setData] = useState<ModelsData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [offline, setOffline] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoadState('loading');
    setOffline(false);
    setLoadError('');

    let response: Response;
    try {
      response = await fetch('/api/v1/admin/models', {
        credentials: 'include',
        cache: 'no-store',
      });
    } catch {
      setOffline(true);
      setLoadError('无法连接服务器，请检查网络后重试。');
      setLoadState('error');
      return;
    }

    if (response.status === 0) {
      setOffline(true);
      setLoadError('无法连接服务器，请检查网络后重试。');
      setLoadState('error');
      return;
    }

    if (!response.ok) {
      setLoadError(
        response.status === 403
          ? '当前账号没有访问模型配置的权限，请使用管理员账号登录。'
          : `加载失败（HTTP ${response.status}）`,
      );
      setLoadState('error');
      return;
    }

    try {
      const payload = (await response.json()) as { data?: AdminModelsResponse };
      if (!payload.data) {
        setLoadError('响应格式不正确。');
        setLoadState('error');
        return;
      }
      setData({ slots: payload.data.slots, options: payload.data.options });
      setLoadState('ready');
    } catch {
      setLoadError('响应解析失败。');
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSaved(updated: ModelConfigPublic) {
    setData((current) =>
      current
        ? {
            ...current,
            slots: current.slots.map((slot) => (slot.slot === updated.slot ? updated : slot)),
          }
        : current,
    );
  }

  return (
    <div className="admin-models-page">
      <div className="admin-page-header">
        <h1>模型配置</h1>
        <p>管理「我的模型」与「Live 模型」的供应商、模型与网关配置。</p>
      </div>

      <p className="admin-models-note">
        提示：此处填写的 API 密钥仅保存在服务端内存中，API 服务重启后即丢失，并回退到服务端环境变量；生产环境建议接入密钥管理服务（secret manager）。
      </p>

      {offline ? <OfflineBanner readOnly onRetry={() => void load()} /> : null}

      {loadState === 'loading' ? <SkeletonBlock lines={6} /> : null}

      {loadState === 'error' && !offline ? (
        <ErrorState
          title="模型配置加载失败"
          description={loadError}
          onRetry={() => void load()}
        />
      ) : null}

      {loadState === 'ready' && data ? (
        data.options.length === 0 ? (
          <EmptyState
            title="暂无可配置的模型选项"
            description="服务端没有返回任何可配置的模型选项，请先检查模型选项的数据源。"
          />
        ) : (
          <div className="admin-models-grid">
            {SLOT_ORDER.map((slot) => (
              <ModelSlotCard
                key={slot}
                slot={slot}
                config={data.slots.find((item) => item.slot === slot)}
                options={data.options}
                onSaved={handleSaved}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
