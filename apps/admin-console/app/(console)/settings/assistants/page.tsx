'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminRuntimeAgent, AdminRuntimeAgentUpdateRequest, AdminRuntimeSnapshot } from '@qitu/contracts';
import { fetchAdminAssistants, updateAdminAssistant, createAdminAssistant } from '../../../../lib/api/assistants';
import { newIdempotencyKey, testModelConnection } from '../../../../lib/api/modelRegistry';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

type Draft = {
  id: string;
  label: string;
  roleDefinition: string;
  agentDefinition: string;
  model: string;
  enabled: boolean;
  capabilities: string;
};

function draftFromAgent(agent?: AdminRuntimeAgent): Draft {
  return {
    id: agent?.id ?? '',
    label: agent?.label ?? '',
    roleDefinition: agent?.roleDefinition ?? '',
    agentDefinition: agent?.agentDefinition ?? '',
    model: agent?.modelProviderId && agent.modelId ? `${agent.modelProviderId}\u0000${agent.modelId}` : '',
    enabled: agent?.enabled ?? true,
    capabilities: agent?.capabilities.join(', ') ?? 'teach',
  };
}

function parseModel(value: string): { providerId: string | null; modelId: string | null } {
  if (!value) return { providerId: null, modelId: null };
  const split = value.split('\u0000');
  return { providerId: split[0] || null, modelId: split[1] || null };
}

export default function AdminAssistantsPage() {
  const [snapshot, setSnapshot] = useState<AdminRuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AdminRuntimeAgent | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(draftFromAgent());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchAdminAssistants());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('助手配置加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const agents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (snapshot?.agents ?? []).filter((agent) => !query || [agent.id, agent.label, agent.role ?? '', agent.roleDefinition].join(' ').toLowerCase().includes(query));
  }, [snapshot, search]);

  function openEdit(agent: AdminRuntimeAgent) {
    setCreating(false);
    setEditing(agent);
    setDraft(draftFromAgent(agent));
    setSaveError('');
  }

  function openCreate() {
    setCreating(true);
    setEditing(null);
    setDraft(draftFromAgent());
    setSaveError('');
  }

  async function save() {
    setSaveError('');
    const id = draft.id.trim();
    if (creating && !/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(id)) {
      setSaveError('新助手 ID 需要 2-80 位字母、数字、点、下划线或连字符');
      return;
    }
    if (!draft.label.trim() || draft.roleDefinition.trim().length < 20) {
      setSaveError('名称不能为空，角色定义至少需要 20 个字符');
      return;
    }
    const model = parseModel(draft.model);
    const capabilities = draft.capabilities.split(',').map((item) => item.trim()).filter(Boolean);
    const patch: AdminRuntimeAgentUpdateRequest = {
      label: draft.label.trim(),
      roleDefinition: draft.roleDefinition.trim(),
      agentDefinition: draft.agentDefinition.trim(),
      modelProviderId: model.providerId,
      modelId: model.modelId,
      enabled: draft.enabled,
      capabilities: capabilities.length > 0 ? capabilities : ['teach'],
    };
    setSaving(true);
    try {
      if (creating) await createAdminAssistant(id, patch, newIdempotencyKey());
      else if (editing) await updateAdminAssistant(editing.id, patch, newIdempotencyKey());
      else return;
      await load();
      setEditing(null);
      setCreating(false);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function test(agent: AdminRuntimeAgent) {
    if (!agent.modelProviderId || !agent.modelId) {
      setTestMessage((current) => ({ ...current, [agent.id]: '未配置直接模型，服务端拒绝测试' }));
      return;
    }
    setTestingId(agent.id);
    setTestMessage((current) => ({ ...current, [agent.id]: '正在请求真实模型网关…' }));
    try {
      const result = await testModelConnection(agent.modelProviderId, agent.modelId);
      setTestMessage((current) => ({ ...current, [agent.id]: result.ok ? `连接通过${result.latencyMs ? ` · ${result.latencyMs} ms` : ''}` : result.error ?? '连接未通过' }));
    } catch (cause) {
      setTestMessage((current) => ({ ...current, [agent.id]: cause instanceof Error ? cause.message : '测试请求失败' }));
    } finally {
      setTestingId(null);
    }
  }

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) return <div className="admin-settings-page">{stateView}</div>;

  return (
    <div className="admin-settings-page">
      <div className="admin-page-header">
        <div className="admin-page-header-title"><div><h1>助手运行时</h1><p>所有助手来自服务端 Agent 配置；模型、技能和协同路由由后端校验后生效。</p></div></div>
        <div className="admin-page-header-actions">
          <input className="admin-search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 ID、名称或职责" />
          <button type="button" className="settings-action-btn is-primary" onClick={openCreate}>新建助手</button>
        </div>
      </div>

      <div className="admin-runtime-summary"><span>共 {snapshot?.agents.length ?? 0} 个 Agent</span><span>已启用 {snapshot?.agents.filter((agent) => agent.enabled).length ?? 0}</span><span>可用模型 {snapshot?.modelOptions.filter((option) => option.available).length ?? 0}</span></div>
      {agents.length === 0 ? <div className="admin-empty-state">没有匹配的服务端助手配置。</div> : (
        <div className="admin-data-table admin-table-compact admin-runtime-table">
          <table><thead><tr><th>助手</th><th>职责</th><th>模型</th><th>状态</th><th>协同能力</th><th>操作</th></tr></thead>
            <tbody>{agents.map((agent) => <tr key={agent.id}>
              <td><strong>{agent.label}</strong><code>{agent.id}</code></td>
              <td>{agent.roleDefinition}</td>
              <td>{agent.modelLabel ?? '未绑定'}<small>{agent.modelProviderId && agent.modelId ? `${agent.modelProviderId} / ${agent.modelId}` : ''}</small></td>
              <td><span className={`runtime-status ${agent.enabled && agent.modelAvailable ? 'is-ready' : agent.enabled ? 'is-warning' : 'is-off'}`}>{agent.enabled ? (agent.modelAvailable ? '可用' : '待配置') : '已停用'}</span></td>
              <td>{agent.capabilities.join(' · ') || '未声明'}</td>
              <td><div className="runtime-actions"><button type="button" className="settings-pill-btn" onClick={() => void test(agent)} disabled={testingId === agent.id}>{testingId === agent.id ? '测试中…' : '测试模型'}</button><button type="button" className="settings-pill-btn" onClick={() => openEdit(agent)}>编辑</button></div>{testMessage[agent.id] ? <small className="runtime-test-message">{testMessage[agent.id]}</small> : null}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}

      {(editing || creating) ? <div className="runtime-editor" role="dialog" aria-modal="true">
        <div className="runtime-editor-head"><div><h2>{creating ? '新建助手' : `编辑 ${editing?.label ?? ''}`}</h2><p>写入成功后会重新读取服务端配置。</p></div><button type="button" className="settings-pill-btn" onClick={() => { setEditing(null); setCreating(false); }}>关闭</button></div>
        <div className="runtime-form-grid">
          <label>ID<input value={draft.id} disabled={!creating} onChange={(event) => setDraft({ ...draft, id: event.target.value })} /></label>
          <label>名称<input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
          <label className="runtime-form-wide">角色定义<textarea value={draft.roleDefinition} onChange={(event) => setDraft({ ...draft, roleDefinition: event.target.value })} rows={4} /></label>
          <label className="runtime-form-wide">Agent 定义<textarea value={draft.agentDefinition} onChange={(event) => setDraft({ ...draft, agentDefinition: event.target.value })} rows={4} placeholder="可选；服务端会限制长度并审计" /></label>
          <label>直接模型<select value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })}><option value="">不绑定模型</option>{(snapshot?.modelOptions ?? []).map((option) => <option key={`${option.providerId}\u0000${option.modelId}`} value={`${option.providerId}\u0000${option.modelId}`} disabled={!option.available}>{option.providerLabel} / {option.modelLabel}{option.available ? '' : '（不可用）'}</option>)}</select></label>
          <label>能力（逗号分隔）<input value={draft.capabilities} onChange={(event) => setDraft({ ...draft, capabilities: event.target.value })} /></label>
          <label className="runtime-checkbox"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />启用</label>
        </div>
        {saveError ? <p className="qitu-field-error" role="alert">{saveError}</p> : null}
        <div className="admin-form-actions"><button type="button" className="settings-action-btn is-primary" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存配置'}</button><button type="button" className="settings-action-btn" disabled={saving} onClick={() => { setEditing(null); setCreating(false); }}>取消</button></div>
      </div> : null}
    </div>
  );
}
