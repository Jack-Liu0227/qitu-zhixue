'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { AdminSettingsIndexData, AdminSettingsPanel } from '@qitu/contracts';
import { Badge, Button, Field, InfoRow } from '@qitu/ui';
import {
  createManualModel,
  fetchProviders,
  newIdempotencyKey,
  refreshProvider,
  testModelConnection,
  upsertProvider,
} from '../../../lib/api/modelRegistry';
import { fetchSettings } from '../../../lib/api/settings';
import { fetchRuntimeSnapshot, updateRuntimeAgent } from '../../../lib/api/runtime';
import { AdminStateViews } from '../../../lib/components/AdminStateViews';
import { DataSourceBadge } from '../../../lib/components/DataSourceBadge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../lib/components/AdminCard';

const QWEN_PROVIDER_ID = 'qwen-token-plan';
const QWEN_BASE_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode';
const QWEN_TEXT_MODEL = 'qwen3.8-flash';

function QwenQuickSetup() {
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const [baseUrl, setBaseUrl] = useState(QWEN_BASE_URL);
  const [textModel, setTextModel] = useState(QWEN_TEXT_MODEL);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [runtime, setRuntime] = useState({ configured: false, agentLabel: '' });

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
    if (textModel.trim().length === 0) {
      setError('请填写 Agent 使用的模型 ID。');
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

      const snapshot = await fetchRuntimeSnapshot();
      const tutor = snapshot.agents.find((agent) => agent.id === 'qitu-learning-partner')
        ?? snapshot.agents.find((agent) => agent.role === 'tutor' || agent.capabilities.includes('teach'));
      if (!tutor) throw new Error('没有可配置的 AI 导师 Agent，请先在 AI 运行时与初始化中创建 Agent。');
      const updated = await updateRuntimeAgent(tutor.id, {
        modelProviderId: QWEN_PROVIDER_ID,
        modelId: textModel.trim(),
      }, newIdempotencyKey());
      setRuntime({ configured: updated.modelAvailable, agentLabel: updated.label });
      if (apiKeyRef.current) apiKeyRef.current.value = '';

      const tests = await Promise.all([
        testModelConnection(QWEN_PROVIDER_ID, textModel.trim()),
      ]);
      const failed = tests.filter((result) => !result.ok);
      setNotice(failed.length === 0
        ? 'Qwen 模型已保存并分配给 AI 导师 Agent，连通性测试通过。'
        : `模型已分配给 AI 导师 Agent，但有 ${failed.length} 个连通性测试未通过，请检查 Key、额度或模型权限。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '配置失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card variant="gradient" className="admin-settings-quick-card">
      <CardHeader>
        <CardTitle>Qwen Plan 快速配置</CardTitle>
        <CardDescription>安全配置 AI 搭档 Agent 使用的模型</CardDescription>
      </CardHeader>
      <CardContent>
      <p className="admin-settings-quick-description">
        在这里配置 AI 搭档 Agent 使用的模型。API Key 只写入服务端加密存储，页面不会保存或显示明文。
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
        </div>
        <div className="admin-form-actions admin-form-actions-start">
          <Button type="submit" disabled={saving}>
            {saving ? '正在保存并测试…' : '保存并启用 Qwen'}
          </Button>
          <Link className="admin-link" href="/settings/model-providers">打开高级模型配置</Link>
        </div>
        {error ? <p className="admin-error-banner" role="alert">{error}</p> : null}
        {notice ? <p className="admin-settings-quick-success" role="status">{notice}</p> : null}
        {runtime.agentLabel ? (
          <div className="admin-settings-quick-status">
            <Badge tone={runtime.configured ? 'completed' : 'danger'} size="sm">
              {runtime.agentLabel} {runtime.configured ? '模型已配置' : '模型不可用'}
            </Badge>
          </div>
        ) : null}
      </form>
      </CardContent>
    </Card>
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
        <InfoRow label="已配置 Agent 模型" value={`${data.configuredAgentModelCount} 个`} />
      </div>

      <div className="admin-settings-panels">
        {data.panels.map((panel) => (
          <SettingsPanelCard key={panel.id} panel={panel} />
        ))}
      </div>

      <Card className="admin-runtime-governance-card">
        <CardHeader>
          <CardTitle>AI 运行时治理</CardTitle>
          <CardDescription>集中管理运行时能力、Agent 配置和初始化状态</CardDescription>
        </CardHeader>
        <CardContent>
        <p className="admin-settings-panel-description">
          查看 Skills、MCP 服务器和初始化状态，并在「AI 导师 Agent」中集中编辑角色定义、Agent-local AGENTS.md、模型、能力及 Skill/Tool/MCP 配置；开发协作角色不会进入运行时。不展示密钥、凭据、完整提示词或未成年人原始对话。
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
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsPanelCard({ panel }: { panel: AdminSettingsPanel }) {
  const isAvailable = panel.status === 'available' && panel.route !== null;

  const content = (
    <Card variant={isAvailable ? 'interactive' : 'default'} className={isAvailable ? 'admin-settings-panel clickable' : 'admin-settings-panel'}>
      <CardHeader className="admin-settings-panel-header">
        <CardTitle>{panel.title}</CardTitle>
        {panel.status === 'planned' ? (
          <Badge tone="neutral" size="sm">
            未开放
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent>
        <p className="admin-settings-panel-description">{panel.description}</p>
      </CardContent>
    </Card>
  );

  if (isAvailable && panel.route) {
    return <Link href={panel.route}>{content}</Link>;
  }

  return content;
}
