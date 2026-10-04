'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { AdminSettingsIndexData, AdminSettingsPanel, ModelConfigPublic } from '@qitu/contracts';
import { Badge, Button, Field, InfoRow, SectionCard } from '@qitu/ui';
import {
  bindUsage,
  createManualModel,
  fetchProviders,
  newIdempotencyKey,
  refreshProvider,
  testModelConnection,
  upsertProvider,
} from '../../../lib/api/modelRegistry';
import { updateModelConfig, fetchSettings } from '../../../lib/api/settings';
import { AdminStateViews } from '../../../lib/components/AdminStateViews';
import { DataSourceBadge } from '../../../lib/components/DataSourceBadge';

const QWEN_PROVIDER_ID = 'qwen-token-plan';
const QWEN_BASE_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode';
const QWEN_TEXT_MODEL = 'qwen3.8-flash';
const QWEN_VOICE_MODEL = 'qwen-audio-3.0-realtime-plus';

function QwenQuickSetup() {
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const [baseUrl, setBaseUrl] = useState(QWEN_BASE_URL);
  const [textModel, setTextModel] = useState(QWEN_TEXT_MODEL);
  const [voiceModel, setVoiceModel] = useState(QWEN_VOICE_MODEL);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [runtime, setRuntime] = useState<{ text: ModelConfigPublic | null; live: ModelConfigPublic | null }>({
    text: null,
    live: null,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const apiKey = apiKeyRef.current?.value.trim() ?? '';
    if (apiKey.length === 0) {
      setError('请输入 Qwen 百炼 API Key。Key 只会提交给服务端一次，不会回显。');
      return;
    }
    if (!/^https?:\/\//i.test(baseUrl.trim())) {
      setError('网关地址必须以 http:// 或 https:// 开头。');
      return;
    }
    if (textModel.trim().length === 0 || voiceModel.trim().length === 0) {
      setError('请填写文本模型和语音模型 ID。');
      return;
    }

    setSaving(true);
    try {
      await upsertProvider(QWEN_PROVIDER_ID, {
        name: '通义千问（百炼 Token Plan）',
        baseUrl: baseUrl.trim(),
        api: 'openai-completions',
        authHeader: true,
        apiKey,
      });

      // 先尝试拉取真实目录；上游不返回语音模型时，用已知能力声明补齐。
      try {
        await refreshProvider(QWEN_PROVIDER_ID);
      } catch {
        // 手工模型仍可继续创建，管理员之后可以在供应商页重试拉取。
      }
      let providers = await fetchProviders();
      let provider = providers.providers.find((item) => item.id === QWEN_PROVIDER_ID);
      if (provider === undefined) throw new Error('Qwen 服务提供方保存后未能读取，请刷新页面重试。');

      const models = [
        { id: textModel.trim(), name: 'Qwen 文本搭档', input: ['text'], output: ['text'] },
        {
          id: voiceModel.trim(),
          name: 'Qwen 实时语音搭档',
          input: ['text', 'audio'],
          output: ['text', 'audio'],
        },
      ] as const;
      for (const model of models) {
        if (!provider.models.some((item) => item.id === model.id)) {
          try {
            await createManualModel(QWEN_PROVIDER_ID, {
              modelId: model.id,
              displayName: model.name,
              input: [...model.input],
              output: [...model.output],
              contextWindow: null,
              maxTokens: null,
              enabled: true,
              idempotencyKey: newIdempotencyKey(),
            });
          } catch (cause) {
            // 并发提交可能已经创建同一模型；重新读取后只在仍不存在时失败。
            providers = await fetchProviders();
            provider = providers.providers.find((item) => item.id === QWEN_PROVIDER_ID);
            if (provider === undefined || !provider.models.some((item) => item.id === model.id)) {
              throw cause;
            }
          }
        }
      }

      await bindUsage('tutor.chat', { providerId: QWEN_PROVIDER_ID, modelId: textModel.trim() });
      await bindUsage('tutor.live', { providerId: QWEN_PROVIDER_ID, modelId: voiceModel.trim() });

      // 同步旧的 Live 能力入口；AI 搭档主体走上面的持久化用途绑定。
      const [textConfig, liveConfig] = await Promise.all([
        updateModelConfig('text', {
          provider: 'qwen',
          modelId: textModel.trim(),
          baseUrl: baseUrl.trim(),
          apiKey,
        }),
        updateModelConfig('live', {
          provider: 'qwen',
          modelId: voiceModel.trim(),
          baseUrl: baseUrl.trim(),
          apiKey,
        }),
      ]);
      setRuntime({ text: textConfig, live: liveConfig });
      if (apiKeyRef.current) apiKeyRef.current.value = '';

      const tests = await Promise.all([
        testModelConnection(QWEN_PROVIDER_ID, textModel.trim()),
        testModelConnection(QWEN_PROVIDER_ID, voiceModel.trim()),
      ]);
      const failed = tests.filter((result) => !result.ok);
      setNotice(
        failed.length === 0
          ? 'Qwen 文本和语音模型已保存、绑定并通过连通性测试。'
          : `配置已保存并绑定；${failed.length} 个模型连通性测试未通过，请检查 Key、额度或模型权限。`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '配置失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="Qwen Plan 快速配置">
      <p className="admin-settings-quick-description">
        在这里一次配置 AI 搭档的文本和实时语音模型。API Key 只写入服务端加密存储，页面不会保存或显示明文。
      </p>
      <form className="admin-settings-quick-form" onSubmit={submit}>
        <div className="admin-settings-quick-grid">
          <Field label="百炼兼容网关地址">
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} autoComplete="url" />
          </Field>
          <Field label="Qwen API Key" hint="从百炼控制台复制 API Key；已保存的 Key 不会回显。">
            <input ref={apiKeyRef} type="password" autoComplete="new-password" placeholder="sk-..." />
          </Field>
          <Field label="文本模型 ID">
            <input value={textModel} onChange={(event) => setTextModel(event.target.value)} />
          </Field>
          <Field label="语音模型 ID">
            <input value={voiceModel} onChange={(event) => setVoiceModel(event.target.value)} />
          </Field>
        </div>
        <div className="admin-form-actions admin-form-actions-start">
          <Button type="submit" disabled={saving}>
            {saving ? '正在保存并测试…' : '保存并启用 Qwen'}
          </Button>
          <Link className="admin-link" href="/settings/model-providers">打开高级模型配置</Link>
        </div>
        {error ? <p className="admin-error-banner" role="alert">{error}</p> : null}
        {notice ? <p className="admin-settings-quick-success" role="status">{notice}</p> : null}
        {runtime.text || runtime.live ? (
          <div className="admin-settings-quick-status">
            <Badge tone={runtime.text?.configured ? 'completed' : 'danger'} size="sm">
              文本 {runtime.text?.configured ? '已配置' : '未配置'}
            </Badge>
            <Badge tone={runtime.live?.configured ? 'completed' : 'danger'} size="sm">
              语音 {runtime.live?.configured ? '已配置' : '未配置'}
            </Badge>
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}

export default function AdminSettingsPage() {
  const [data, setData] = useState<AdminSettingsIndexData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSettings();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('未知错误'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) return <div className="admin-settings-page">{stateView}</div>;

  if (!data) return null;

  return (
    <div className="admin-settings-page">
      <div className="admin-page-header">
        <div className="admin-page-header-title">
          <h1>设置</h1>
          <DataSourceBadge dataSource={data.dataSource} />
        </div>
        <p>管理平台配置与模型接入</p>
      </div>

      <QwenQuickSetup />

      <div className="admin-settings-overview">
        <InfoRow label="已配置的模型供应商" value={`${data.configuredProviderCount} 个`} />
        <InfoRow label="已绑定的模型用途" value={`${data.configuredUsageCount} 个`} />
      </div>

      <div className="admin-settings-panels">
        {data.panels.map((panel) => (
          <SettingsPanelCard key={panel.id} panel={panel} />
        ))}
      </div>

      <SectionCard title="AI 运行时治理">
        <p className="admin-settings-panel-description">
          只读查看 skills、MCP 服务器、项目 Agent 角色与设置、内置工具，以及数据库 / 知识库 / 模板 /
          Tutor 的初始化状态。不展示密钥、凭据、完整提示词或未成年人原始对话。
        </p>
        <div className="admin-form-actions admin-form-actions-start">
          <Link className="admin-link" href="/settings/knowledge">
            管理知识库
          </Link>
          <Link className="admin-link" href="/settings/templates">
            管理模板库
          </Link>
          <Link className="admin-link" href="/settings/database">
            查看数据库状态
          </Link>
          <Link className="admin-link" href="/settings/ai-runtime">
            打开 AI 运行时与初始化
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}

function SettingsPanelCard({ panel }: { panel: AdminSettingsPanel }) {
  const isAvailable = panel.status === 'available' && panel.route !== null;

  const content = (
    <div className={isAvailable ? 'admin-settings-panel clickable' : 'admin-settings-panel'}>
      <div className="admin-settings-panel-header">
        <h3>{panel.title}</h3>
        {panel.status === 'planned' ? (
          <Badge tone="neutral" size="sm">
            未开放
          </Badge>
        ) : null}
      </div>
      <p className="admin-settings-panel-description">{panel.description}</p>
    </div>
  );

  if (isAvailable && panel.route) {
    return <Link href={panel.route}>{content}</Link>;
  }

  return content;
}
