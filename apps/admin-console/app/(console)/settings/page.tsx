'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { AdminSettingsIndexData, AdminSettingsPanel } from '@qitu/contracts';
import { Badge, Button, Field } from '@qitu/ui';
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
import { AdminMetricIcon } from '../../../lib/components/AdminMetricIcon';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../lib/components/AdminCard';

const QWEN_PROVIDER_ID = 'qwen-token-plan';
const QWEN_BASE_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode';
const QWEN_TEXT_MODEL = 'qwen3.8-flash';

type SettingsToast = { tone: 'success' | 'error'; message: string } | null;

function QwenQuickSetup({ onToast }: { onToast: (toast: SettingsToast) => void }) {
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const [baseUrl, setBaseUrl] = useState(QWEN_BASE_URL);
  const [textModel, setTextModel] = useState(QWEN_TEXT_MODEL);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
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
    setConfirmOpen(true);
  }

  async function confirmSubmit() {
    setConfirmOpen(false);
    setSaving(true);
    setError('');
    setNotice('');
    onToast(null);
    const apiKey = apiKeyRef.current?.value.trim() ?? '';
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
      const message = failed.length === 0
        ? 'Qwen 模型已保存并分配给 AI 导师 Agent，连通性测试通过。'
        : `模型已分配给 AI 导师 Agent，但有 ${failed.length} 个连通性测试未通过，请检查 Key、额度或模型权限。`;
      setNotice(message);
      onToast({ tone: failed.length === 0 ? 'success' : 'error', message });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '配置失败，请重试。';
      setError(message);
      onToast({ tone: 'error', message });
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
        <CardFooter className="admin-settings-quick-actions">
          <Button type="submit" variant="primary" loading={saving} disabled={saving}>
            保存并启用 Qwen
          </Button>
          <Link className="admin-settings-secondary-link" href="/settings/model-providers">打开高级模型配置 <span aria-hidden="true">→</span></Link>
        </CardFooter>
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
      {confirmOpen ? (
        <div className="admin-dialog-backdrop" role="presentation" onClick={() => setConfirmOpen(false)}>
          <section className="admin-dialog admin-settings-confirm" role="alertdialog" aria-modal="true" aria-labelledby="qwen-confirm-title" onClick={(event) => event.stopPropagation()}>
            <span className="admin-settings-confirm-icon" aria-hidden="true">Q</span>
            <h3 id="qwen-confirm-title">确认启用 Qwen 模型？</h3>
            <p>将保存供应商凭证、注册模型，并分配给 AI 导师 Agent。已保存的 API Key 不会回显。</p>
            <div className="admin-dialog-actions">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>返回检查</Button>
              <Button variant="primary" loading={saving} onClick={() => void confirmSubmit()}>确认并启用</Button>
            </div>
          </section>
        </div>
      ) : null}
    </Card>
  );
}

export default function AdminSettingsPage() {
  const [data, setData] = useState<AdminSettingsIndexData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [toast, setToast] = useState<SettingsToast>(null);

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

      <QwenQuickSetup onToast={setToast} />

      {toast ? (
        <div className={`admin-settings-toast is-${toast.tone}`} role="status">
          <span className="admin-settings-toast-dot" aria-hidden="true" />
          <span>{toast.message}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setToast(null)}>×</button>
        </div>
      ) : null}

      <div className="admin-settings-overview admin-settings-metrics">
        <Card variant="soft" className="admin-settings-metric-card">
          <span className="admin-settings-metric-icon is-blue"><AdminMetricIcon name="project" /></span>
          <span className="admin-settings-metric-copy"><small>模型供应商</small><strong>{data.configuredProviderCount}</strong><em>个已配置</em></span>
        </Card>
        <Card variant="soft" className="admin-settings-metric-card">
          <span className="admin-settings-metric-icon is-teal"><AdminMetricIcon name="coverage" /></span>
          <span className="admin-settings-metric-copy"><small>Agent 模型</small><strong>{data.configuredAgentModelCount}</strong><em className={data.configuredAgentModelCount === 0 ? 'is-pending' : ''}>{data.configuredAgentModelCount === 0 ? '待配置' : '个已配置'}</em></span>
          <Link className="admin-settings-metric-link" href="/settings/ai-runtime">去配置 <span aria-hidden="true">→</span></Link>
        </Card>
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

  const statusLabel = panel.status === 'available' ? '已开放' : '未开放';
  const content = (
    <Card variant={isAvailable ? 'interactive' : 'default'} className={isAvailable ? 'admin-settings-panel clickable' : 'admin-settings-panel is-disabled'}>
      <CardHeader className="admin-settings-panel-header">
        <div className="admin-settings-panel-title-row"><CardTitle>{panel.title}</CardTitle><span className={`admin-settings-status is-${panel.status}`}>{statusLabel}</span></div>
      </CardHeader>
      <CardContent>
        <p className="admin-settings-panel-description">{panel.description}</p>
      </CardContent>
      {isAvailable ? <CardFooter className="admin-settings-panel-footer"><span>进入配置</span><span aria-hidden="true">→</span></CardFooter> : null}
    </Card>
  );

  if (isAvailable && panel.route) {
    return <Link href={panel.route}>{content}</Link>;
  }

  return content;
}
