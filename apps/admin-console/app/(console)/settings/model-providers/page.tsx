'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AdminProvidersResponse, ConnectionTestResponse, ModelApi, ModelDescriptor, ProviderConfigPublic, ProviderPreset, UpsertProviderRequest } from '@qitu/contracts';
import { createManualModel, fetchProviders, newIdempotencyKey, refreshProvider, testModelConnection, testProviderConnection, upsertProvider } from '../../../../lib/api/modelRegistry';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

const API_OPTIONS: Array<{ value: ModelApi; label: string }> = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];

function formatTime(value: string | null | undefined): string {
  if (!value) return '未同步';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未同步' : date.toLocaleString('zh-CN', { hour12: false });
}

function ProviderEditor({ initial, preset, onSaved, onClose }: { initial?: ProviderConfigPublic; preset?: ProviderPreset; onSaved: (provider: ProviderConfigPublic) => void; onClose: () => void }) {
  const [id, setId] = useState(initial?.id ?? preset?.id ?? '');
  const [name, setName] = useState(initial?.name ?? preset?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? preset?.baseUrl ?? '');
  const [api, setApi] = useState<ModelApi>(initial?.api ?? preset?.api ?? 'openai-completions');
  const [authHeader, setAuthHeader] = useState(initial?.authHeader ?? preset?.authHeader ?? true);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const keyRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const providerId = id.trim();
    const url = baseUrl.trim().replace(/\/$/u, '');
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/iu.test(providerId)) return setError('ID 需要 2-80 位字母、数字、点、下划线或连字符');
    if (!name.trim() || !/^https?:\/\//iu.test(url)) return setError('名称不能为空，网关地址必须以 http:// 或 https:// 开头');
    const body: UpsertProviderRequest & { enabled?: boolean } = { name: name.trim(), baseUrl: url, api, authHeader, enabled };
    const key = keyRef.current?.value ?? '';
    if (key) body.apiKey = key;
    setSaving(true);
    setError('');
    try {
      const provider = await upsertProvider(providerId, body, newIdempotencyKey());
      if (keyRef.current) keyRef.current.value = '';
      onSaved(provider);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally { setSaving(false); }
  }

  return <aside className="provider-editor" role="dialog" aria-modal="true"><div className="provider-editor-head"><div><span className="provider-kicker">MODEL PROVIDER</span><h2>{initial ? `编辑 ${initial.id}` : '新建供应商'}</h2><p>兼容 OpenAI / NewAPI 的网关使用 OpenAI Chat Completions 协议。</p></div><button type="button" className="settings-pill-btn" onClick={onClose}>关闭</button></div><form className="runtime-form-grid" onSubmit={submit}>
    <label>供应商 ID<input value={id} disabled={Boolean(initial || preset)} onChange={(event) => setId(event.target.value)} placeholder="newapi-prod" /></label>
    <label>显示名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="NewAPI 生产网关" /></label>
    <label className="runtime-form-wide">API 地址<input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://gateway.example.com/v1" /></label>
    <label>协议<select value={api} onChange={(event) => setApi(event.target.value as ModelApi)}>{API_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    <label>请求认证<select value={authHeader ? 'bearer' : 'body'} onChange={(event) => setAuthHeader(event.target.value === 'bearer')}><option value="bearer">Authorization: Bearer</option><option value="body">供应商自定义</option></select></label>
    <label className="runtime-form-wide">API 密钥（只写）<input ref={keyRef} type="password" autoComplete="off" placeholder={initial?.auth.configured ? `已配置 · 指纹 ${initial.auth.keyFingerprint ?? '不可用'}，留空不修改` : '仅本次提交发送，服务端加密保存'} /></label>
    <label className="runtime-checkbox"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />允许运行时使用</label>
    {error ? <p className="qitu-field-error runtime-form-wide" role="alert">{error}</p> : null}
    <div className="admin-form-actions runtime-form-wide"><button type="submit" className="settings-action-btn is-primary" disabled={saving}>{saving ? '保存中…' : '保存供应商'}</button><button type="button" className="settings-action-btn" disabled={saving} onClick={onClose}>取消</button></div>
  </form></aside>;
}

function ModelQuickAdd({ provider, onAdded }: { provider: ProviderConfigPublic; onAdded: (provider: ProviderConfigPublic) => void }) {
  const [modelId, setModelId] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modelId.trim() || !name.trim()) { setError('模型 ID 和展示名不能为空'); return; }
    setSaving(true); setError('');
    try {
      await createManualModel(provider.id, { modelId: modelId.trim(), displayName: name.trim(), api: provider.api, input: ['text'], output: ['text'], contextWindow: null, maxTokens: null, enabled: true, idempotencyKey: newIdempotencyKey() });
      const refreshed = await refreshProvider(provider.id).catch(() => null);
      onAdded(refreshed?.provider ?? provider);
      setModelId(''); setName('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '模型添加失败'); }
    finally { setSaving(false); }
  }
  return <form className="provider-model-add" onSubmit={submit}><input value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="上游模型 ID" /><input value={name} onChange={(event) => setName(event.target.value)} placeholder="展示名" /><button type="submit" className="settings-pill-btn" disabled={saving}>{saving ? '添加中…' : '添加模型'}</button>{error ? <small className="qitu-field-error">{error}</small> : null}</form>;
}

export default function AdminModelPage() {
  const [data, setData] = useState<AdminProvidersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'enabled' | 'disabled' | 'error'>('all');
  const [apiFilter, setApiFilter] = useState<'all' | ModelApi>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ initial?: ProviderConfigPublic; preset?: ProviderPreset } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [testState, setTestState] = useState<Record<string, string>>({});

  const load = useCallback(async () => { setLoading(true); setError(null); try { setData(await fetchProviders()); } catch (cause) { setError(cause instanceof Error ? cause : new Error('供应商加载失败')); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);

  const providers = useMemo(() => (data?.providers ?? []).filter((provider) => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || [provider.id, provider.name, provider.baseUrl, provider.api, ...provider.models.map((model) => model.id)].join(' ').toLowerCase().includes(q);
    const matchesStatus = status === 'all' || (status === 'enabled' && provider.enabled) || (status === 'disabled' && !provider.enabled) || (status === 'error' && Boolean(provider.lastError));
    return matchesQuery && matchesStatus && (apiFilter === 'all' || provider.api === apiFilter);
  }), [data, query, status, apiFilter]);

  function replaceProvider(provider: ProviderConfigPublic) { setData((current) => current ? { ...current, providers: current.providers.map((item) => item.id === provider.id ? provider : item) } : current); }
  async function runProviderTest(provider: ProviderConfigPublic) { setTestState((current) => ({ ...current, [provider.id]: '正在请求真实网关…' })); try { const result = await testProviderConnection(provider.id); setTestState((current) => ({ ...current, [provider.id]: result.ok ? `连接通过${result.latencyMs ? ` · ${result.latencyMs} ms` : ''}` : result.error ?? '连接未通过' })); } catch (cause) { setTestState((current) => ({ ...current, [provider.id]: cause instanceof Error ? cause.message : '测试失败' })); } }
  async function refresh(provider: ProviderConfigPublic) { setTestState((current) => ({ ...current, [provider.id]: '正在从 /models 同步…' })); try { const result = await refreshProvider(provider.id); replaceProvider(result.provider); setTestState((current) => ({ ...current, [provider.id]: `已同步 ${result.fetched} 个模型` })); } catch (cause) { setTestState((current) => ({ ...current, [provider.id]: cause instanceof Error ? cause.message : '同步失败' })); } }
  async function bulkSetEnabled(enabled: boolean) { if (selected.size === 0) return; setBulkSaving(true); try { await Promise.all([...selected].map(async (id) => { const provider = data?.providers.find((item) => item.id === id); if (!provider) return; const updated = await upsertProvider(provider.id, { name: provider.name, baseUrl: provider.baseUrl, api: provider.api, authHeader: provider.authHeader, enabled } as UpsertProviderRequest, newIdempotencyKey()); replaceProvider(updated); })); setSelected(new Set()); } catch (cause) { setError(cause instanceof Error ? cause : new Error('批量更新失败')); } finally { setBulkSaving(false); } }

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) return <div className="admin-settings-page">{stateView}</div>;
  if (!data) return null;
  const allSelected = providers.length > 0 && providers.every((provider) => selected.has(provider.id));

  return <div className="admin-settings-page">
    <div className="admin-page-header"><div className="admin-page-header-title"><div><h1>模型供应商</h1><p>参考 NewAPI 频道管理：一行一个网关，模型目录、协议、状态和真实连通性集中管理。</p></div></div><div className="admin-page-header-actions"><button type="button" className="settings-action-btn is-primary" onClick={() => setEditing({})}>新建供应商</button></div></div>
    <div className="provider-stats"><div><strong>{data.providers.length}</strong><span>供应商</span></div><div><strong>{data.providers.filter((provider) => provider.enabled).length}</strong><span>运行中</span></div><div><strong>{data.providers.reduce((count, provider) => count + provider.models.length, 0)}</strong><span>已登记模型</span></div><div><strong>{data.providers.filter((provider) => provider.lastError).length}</strong><span>同步异常</span></div></div>
    <div className="provider-toolbar"><input className="admin-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 ID、名称、地址或模型" /><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="enabled">运行中</option><option value="disabled">已停用</option><option value="error">同步异常</option></select><select value={apiFilter} onChange={(event) => setApiFilter(event.target.value as typeof apiFilter)}><option value="all">全部协议</option>{API_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{selected.size > 0 ? <><button type="button" className="settings-pill-btn" disabled={bulkSaving} onClick={() => void bulkSetEnabled(true)}>批量启用</button><button type="button" className="settings-pill-btn" disabled={bulkSaving} onClick={() => void bulkSetEnabled(false)}>批量停用</button></> : null}</div>
    {providers.length === 0 ? <div className="admin-empty-state">没有符合筛选条件的供应商。你可以新建一个 OpenAI-compatible / NewAPI 网关。</div> : <div className="admin-data-table admin-table-compact provider-table"><table><thead><tr><th><input type="checkbox" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? new Set(providers.map((provider) => provider.id)) : new Set())} aria-label="全选供应商" /></th><th>供应商</th><th>网关地址</th><th>协议</th><th>状态</th><th>模型</th><th>最近同步</th><th>操作</th></tr></thead><tbody>{providers.map((provider) => <Fragment key={provider.id}><tr className={expanded === provider.id ? 'is-expanded' : ''}><td><input type="checkbox" checked={selected.has(provider.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(provider.id); else next.delete(provider.id); return next; })} aria-label={`选择 ${provider.name}`} /></td><td><div className="provider-name-cell"><span className="provider-logo">{provider.name.slice(0, 1).toUpperCase()}</span><div><strong>{provider.name}</strong><code>{provider.id}</code></div></div></td><td><code className="provider-url">{provider.baseUrl}</code></td><td><span className="protocol-chip">{provider.api.replace('openai-', '').replace('anthropic-', 'Anthropic ')}</span></td><td><span className={`runtime-status ${provider.enabled && provider.auth.configured ? 'is-ready' : provider.enabled ? 'is-warning' : 'is-off'}`}>{provider.enabled ? (provider.auth.configured ? '可用' : '缺少密钥') : '已停用'}</span>{provider.lastError ? <small className="provider-error-dot" title={provider.lastError}>同步异常</small> : null}</td><td><strong>{provider.models.length}</strong> <span className="provider-muted">个</span></td><td>{formatTime(provider.modelsFetchedAt)}</td><td><div className="runtime-actions"><button type="button" className="settings-pill-btn" onClick={() => setExpanded(expanded === provider.id ? null : provider.id)}>{expanded === provider.id ? '收起' : '详情'}</button><button type="button" className="settings-pill-btn" onClick={() => setEditing({ initial: provider })}>编辑</button></div></td></tr>{expanded === provider.id ? <tr><td colSpan={8}><div className="provider-detail"><div className="provider-detail-head"><div><strong>{provider.name}</strong><span>{provider.auth.configured ? `密钥已配置 · ${provider.auth.keyFingerprint ?? '指纹不可用'}` : '尚未配置密钥'}</span></div><div className="runtime-actions"><button type="button" className="settings-pill-btn" onClick={() => void runProviderTest(provider)}>测试连接</button><button type="button" className="settings-pill-btn" onClick={() => void refresh(provider)}>同步模型</button></div></div>{testState[provider.id] ? <p className="runtime-test-message">{testState[provider.id]}</p> : null}{provider.lastError ? <p className="qitu-field-error">{provider.lastError}</p> : null}<div className="provider-model-list">{provider.models.length ? provider.models.map((model: ModelDescriptor) => <div className="provider-model-row" key={model.id}><div><strong>{model.name || model.id}</strong><code>{model.id}</code></div><span>{model.source === 'manual' ? '手工' : '远程'} · {model.input.join('/')} → {model.output.join('/')}</span><button type="button" className="settings-pill-btn" onClick={() => void testModelConnection(provider.id, model.id).then((result: ConnectionTestResponse) => setTestState((current) => ({ ...current, [provider.id]: result.ok ? `${model.id} 连接通过` : result.error ?? `${model.id} 未通过` }))).catch((cause) => setTestState((current) => ({ ...current, [provider.id]: cause instanceof Error ? cause.message : '模型测试失败' })))}>测试</button></div>) : <p className="provider-muted">尚未登记模型，请先同步或手工添加。</p>}</div><ModelQuickAdd provider={provider} onAdded={replaceProvider} /></div></td></tr> : null}</Fragment>)}</tbody></table></div>}
    <section className="provider-presets"><div className="runtime-section-head"><h2>可用模板</h2><span>模板只预填公开地址和协议，不包含密钥。</span></div><div className="provider-preset-grid">{data.presets.map((preset) => <button type="button" className="provider-preset" key={preset.id} onClick={() => setEditing({ preset })}><strong>{preset.name}</strong><code>{preset.id}</code><span>{preset.baseUrl}</span><small>{preset.suggestedModels.length} 个建议模型 · {preset.api}</small></button>)}</div></section>
    {editing ? <ProviderEditor initial={editing.initial} preset={editing.preset} onSaved={(provider) => { replaceProvider(provider); setEditing(null); }} onClose={() => setEditing(null)} /> : null}
  </div>;
}
