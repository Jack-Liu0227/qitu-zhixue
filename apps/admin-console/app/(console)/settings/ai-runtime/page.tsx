'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AdminInitializationStatus,
  AdminRuntimeAgent,
  AdminRuntimeModelOption,
  AdminRuntimeBuiltinTool,
  AdminRuntimeMcpServer,
  AdminRuntimePolicy,
  AdminRuntimeSkill,
  AdminRuntimeSnapshot,
} from '@qitu/contracts';
import { EmptyState, InfoRow, SectionCard, SegmentedControl, Button } from '@qitu/ui';
import { AdminRuntimeUnavailableError, createRuntimeAgent, fetchRuntimeSnapshot, updateRuntimeAgent } from '../../../../lib/api/runtime';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { DataSourceBadge } from '../../../../lib/components/DataSourceBadge';
import { SettingsSubNav } from '../../../../lib/components/SettingsSubNav';
import './ai-runtime.css';
import {
  InitializationCheckBadge,
  McpConnectionBadge,
  RuntimeHealthBadge,
  RuntimeIdList,
  RuntimeItemStatusBadge,
  RuntimeUnavailableState,
  ToolRiskBadge,
  areaLabel,
  databaseLabel,
  dataModeLabel,
  formatRuntimeTime,
  sourceLabel,
  transportLabel,
} from '../../../../lib/components/RuntimeViews';

/**
 * AI 运行时治理页。
 *
 * 单页承载五类治理数据：skills、MCP 服务器、项目 Agent 角色/设置、内置工具，
 * 以及数据库 / 知识库 / 模板 / Tutor 的初始化状态。读取数据是服务端脱敏投影；
 * Agent 角色支持受权限、幂等和审计保护的编辑，不展示密钥、MCP 凭据、完整私有
 * system prompt 或未成年人原始对话。
 *
 * 页面显式呈现 loading、empty、error、offline、permission-denied 和接口未启用状态。
 */

type RuntimeTab = 'skills' | 'mcp' | 'agents' | 'tools' | 'init';

const TAB_ITEMS: { value: RuntimeTab; label: string }[] = [
  { value: 'skills', label: 'Skills' },
  { value: 'mcp', label: 'MCP 服务器' },
  { value: 'agents', label: 'AI 导师 Agent' },
  { value: 'tools', label: '内置工具' },
  { value: 'init', label: '初始化状态' },
];

function boolLabel(value: boolean | null, yes: string, no: string): string {
  if (value === null) return '未知';
  return value ? yes : no;
}

/* ------------------------------ Skills ------------------------------ */

function SkillsPanel({ skills }: { skills: AdminRuntimeSkill[] }) {
  if (skills.length === 0) {
    return (
      <EmptyState
        title="暂无 skill 注册"
        description="服务端当前没有可展示的 skill 注册项。这不代表平台完全不具备 skills 能力，只代表治理接口没有返回已登记的条目。"
      />
    );
  }

  return (
    <SectionCard title={`Skills（${skills.length}）`}>
      <ul className="admin-runtime-list">
        {skills.map((skill) => (
          <li key={skill.id} className="admin-runtime-row">
            <div className="admin-runtime-row-head">
              <strong className="admin-runtime-row-title">{skill.label}</strong>
              <RuntimeItemStatusBadge status={skill.status} />
            </div>
            <div className="admin-runtime-row-meta">
              <code className="admin-console-fingerprint">{skill.id}</code>
              <span>{sourceLabel(skill.source)}</span>
              <span>版本 {skill.version ?? '—'}</span>
            </div>
            {skill.description ? <p className="admin-runtime-description">{skill.description}</p> : null}
            <RuntimeIdList label="关联 Agent" ids={skill.agentIds} />
            <details className="admin-runtime-definition">
              <summary>查看已加载定义</summary>
              <pre>{skill.content}</pre>
            </details>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/* --------------------------- MCP 服务器 ---------------------------- */

function McpPanel({ servers }: { servers: AdminRuntimeMcpServer[] }) {
  if (servers.length === 0) {
    return (
      <EmptyState
        title="暂无 MCP 服务器注册"
        description="还没有登记任何 MCP 服务器。MCP 凭据只能由后台安全配置写入，治理投影永远不会返回密钥。"
      />
    );
  }

  return (
    <div className="admin-runtime-cards">
      {servers.map((server) => (
        <SectionCard
          key={server.id}
          title={server.label}
          action={<McpConnectionBadge status={server.status} />}
        >
          <div className="admin-runtime-row-meta admin-runtime-row-meta-spaced">
            <code className="admin-console-fingerprint">{server.id}</code>
            <span>{transportLabel(server.transport)}</span>
            <span>{server.enabled ? '已启用' : '已停用'}</span>
          </div>
          <InfoRow label="发现工具数" value={server.toolCount === null ? '未知' : `${server.toolCount} 个`} />
          <InfoRow
            label="端点来源"
            value={server.endpointOrigin ?? '本地 / 未配置'}
            muted={server.endpointOrigin === null}
          />
          <InfoRow label="最近探测" value={formatRuntimeTime(server.lastCheckedAt)} />
          {server.lastError ? (
            <p className="admin-runtime-error" role="status">
              最近错误：{server.lastError}
            </p>
          ) : null}
        </SectionCard>
      ))}
    </div>
  );
}

/* ---------------------------- 项目 Agent ---------------------------- */

const AGENT_CAPABILITIES = ['explore', 'plan', 'teach', 'review', 'reflect'] as const;

function AgentEditorCard({
  agent,
  modelOptions,
  skills,
  tools,
  mcpServers,
  onSaved,
}: {
  agent: AdminRuntimeAgent;
  modelOptions: AdminRuntimeModelOption[];
  skills: AdminRuntimeSkill[];
  tools: AdminRuntimeBuiltinTool[];
  mcpServers: AdminRuntimeMcpServer[];
  onSaved: (agent: AdminRuntimeAgent) => void;
}) {
  const [label, setLabel] = useState(agent.label);
  const [definition, setDefinition] = useState(agent.roleDefinition);
  const [agentDefinition, setAgentDefinition] = useState(agent.agentDefinition);
  const [modelProviderId, setModelProviderId] = useState(agent.modelProviderId ?? '');
  const [modelId, setModelId] = useState(agent.modelId ?? '');
  const [capabilities, setCapabilities] = useState(agent.capabilities);
  const [skillIds, setSkillIds] = useState(agent.skillIds);
  const [toolIds, setToolIds] = useState(agent.toolIds);
  const [mcpServerIds, setMcpServerIds] = useState(agent.mcpServerIds);
  const [enabled, setEnabled] = useState(agent.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    setLabel(agent.label);
    setDefinition(agent.roleDefinition);
    setAgentDefinition(agent.agentDefinition);
    setModelProviderId(agent.modelProviderId ?? '');
    setModelId(agent.modelId ?? '');
    setCapabilities(agent.capabilities);
    setSkillIds(agent.skillIds);
    setToolIds(agent.toolIds);
    setMcpServerIds(agent.mcpServerIds);
    setEnabled(agent.enabled);
    setError('');
    pending.current = null;
  }, [
    agent.id,
    agent.label,
    agent.roleDefinition,
    agent.agentDefinition,
    agent.modelProviderId,
    agent.modelId,
    agent.capabilities,
    agent.skillIds,
    agent.toolIds,
    agent.mcpServerIds,
    agent.enabled,
  ]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const input = {
      label,
      roleDefinition: definition,
      agentDefinition,
      ...((modelProviderId || null) !== agent.modelProviderId || (modelId || null) !== agent.modelId
        ? { modelProviderId: modelProviderId || null, modelId: modelId || null }
        : {}),
      capabilities,
      skillIds,
      toolIds,
      mcpBindings: mcpServerIds.map((serverId) => ({ serverId, toolIds: agent.mcpToolIds[serverId] ?? [] })),
      enabled,
    };
    const signature = JSON.stringify(input);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    setSaving(true);
    setError('');
    try {
      const updated = await updateRuntimeAgent(agent.id, input, pending.current.key);
      pending.current = null;
      onSaved(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '角色保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard key={agent.id} title={agent.label} action={<RuntimeItemStatusBadge status={agent.status} />}>
      <form className="admin-agent-editor" onSubmit={save}>
        <div className="admin-runtime-row-meta admin-runtime-row-meta-spaced">
          <code className="admin-console-fingerprint">{agent.id}</code>
          <span>运行角色：{agent.role ?? '未知'}</span>
        </div>
        <label className="admin-agent-field">
          <span>显示名称</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} required />
        </label>
        <label className="admin-agent-field">
          <span>角色定义</span>
          <textarea value={definition} onChange={(event) => setDefinition(event.target.value)} minLength={20} maxLength={4000} rows={6} required />
        </label>
        <label className="admin-agent-field">
          <span>Agent 定义（AGENTS.md）</span>
          <textarea value={agentDefinition} onChange={(event) => setAgentDefinition(event.target.value)} maxLength={12000} rows={8} />
        </label>
        <fieldset className="admin-agent-capabilities">
          <legend>Skills</legend>
          {skills.map((skill) => (
            <label key={skill.id}>
              <input type="checkbox" checked={skillIds.includes(skill.id)} onChange={(event) => setSkillIds((current) => event.target.checked ? [...current, skill.id] : current.filter((id) => id !== skill.id))} />
              <span>{skill.label}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="admin-agent-capabilities">
          <legend>内置 Tools</legend>
          {tools.map((tool) => (
            <label key={tool.id}>
              <input type="checkbox" checked={toolIds.includes(tool.id)} onChange={(event) => setToolIds((current) => event.target.checked ? [...current, tool.id] : current.filter((id) => id !== tool.id))} />
              <span>{tool.label}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="admin-agent-capabilities">
          <legend>MCP Servers</legend>
          {mcpServers.length === 0 ? <span>暂无安全注册的 MCP Server</span> : mcpServers.map((server) => (
            <label key={server.id}>
              <input type="checkbox" checked={mcpServerIds.includes(server.id)} onChange={(event) => setMcpServerIds((current) => event.target.checked ? [...current, server.id] : current.filter((id) => id !== server.id))} />
              <span>{server.label}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="admin-agent-model-config">
          <legend>模型</legend>
          <p className="admin-agent-hint">模型直接归属此 Agent；清空服务商即可移除模型配置。</p>
          <label className="admin-agent-field">
            <span>服务商</span>
            <select value={modelProviderId} onChange={(event) => { setModelProviderId(event.target.value); setModelId(''); }}>
              <option value="">未配置</option>
              {modelProviderId && !modelOptions.some((option) => option.providerId === modelProviderId) ? (
                <option value={modelProviderId}>{modelProviderId}（当前不可用）</option>
              ) : null}
              {[...new Map(modelOptions.map((option) => [option.providerId, option.providerLabel])).entries()].map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>
          <label className="admin-agent-field">
            <span>模型</span>
            <select value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={!modelProviderId}>
              <option value="">选择服务端已登记的模型</option>
              {modelId && !modelOptions.some((option) => option.providerId === modelProviderId && option.modelId === modelId) ? (
                <option value={modelId}>{agent.modelLabel ?? modelId}（当前不可用）</option>
              ) : null}
              {modelOptions.filter((option) => option.providerId === modelProviderId).map((option) => (
                <option key={option.modelId} value={option.modelId} disabled={!option.available}>
                  {option.modelLabel} · {option.available ? option.modelId : '当前不可用'}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <fieldset className="admin-agent-capabilities">
          <legend>能力范围</legend>
          {AGENT_CAPABILITIES.map((capability) => (
            <label key={capability}>
              <input
                type="checkbox"
                checked={capabilities.includes(capability)}
                onChange={(event) => setCapabilities((current) => event.target.checked
                  ? [...current, capability]
                  : current.filter((value) => value !== capability))}
              />
              <span>{capability}</span>
            </label>
          ))}
        </fieldset>
        <label className="admin-agent-toggle">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>启用此角色</span>
        </label>
        <InfoRow label="提示词版本" value={agent.promptVersion ?? '—'} />
        <RuntimeIdList label="已加载 Skills" ids={skillIds} />
        <RuntimeIdList label="已绑定 Tools" ids={toolIds} />
        <RuntimeIdList label="已绑定 MCP" ids={mcpServerIds} />
        {error ? <p role="alert" className="admin-runtime-error">{error}</p> : null}
        <Button type="submit" loading={saving} disabled={saving || !label.trim() || definition.trim().length < 20 || (modelProviderId !== '' && modelId === '')}>
          保存角色
        </Button>
      </form>
    </SectionCard>
  );
}

function CreateAgentForm({ onCreated, modelOptions }: {
  onCreated: (agent: AdminRuntimeAgent) => void;
  modelOptions: AdminRuntimeModelOption[];
}) {
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [definition, setDefinition] = useState('');
  const [modelProviderId, setModelProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const created = await createRuntimeAgent(id.trim(), {
        label: label.trim(), roleDefinition: definition.trim(), modelProviderId: modelProviderId || null, modelId: modelId || null,
        capabilities: ['teach'], skillIds: [], toolIds: [], mcpBindings: [], enabled: true,
      }, crypto.randomUUID());
      onCreated(created);
      setId(''); setLabel(''); setDefinition(''); setModelProviderId(''); setModelId('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '角色创建失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title="新建子 Agent">
      <form className="admin-agent-editor" onSubmit={submit}>
        <label className="admin-agent-field"><span>Agent ID</span><input value={id} onChange={(event) => setId(event.target.value)} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{1,79}" required /></label>
        <label className="admin-agent-field"><span>显示名称</span><input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} required /></label>
        <label className="admin-agent-field"><span>角色定义</span><textarea value={definition} onChange={(event) => setDefinition(event.target.value)} minLength={20} maxLength={4000} rows={4} required /></label>
        <fieldset className="admin-agent-model-config">
          <legend>模型（可选）</legend>
          <label className="admin-agent-field">
            <span>服务商</span>
            <select value={modelProviderId} onChange={(event) => { setModelProviderId(event.target.value); setModelId(''); }}>
              <option value="">未配置</option>
              {[...new Map(modelOptions.map((option) => [option.providerId, option.providerLabel])).entries()].map(([id, providerLabel]) => (
                <option key={id} value={id}>{providerLabel}</option>
              ))}
            </select>
          </label>
          <label className="admin-agent-field">
            <span>模型</span>
            <select value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={!modelProviderId}>
              <option value="">选择模型</option>
              {modelOptions.filter((option) => option.providerId === modelProviderId).map((option) => (
                <option key={option.modelId} value={option.modelId} disabled={!option.available}>{option.modelLabel} · {option.modelId}</option>
              ))}
            </select>
          </label>
        </fieldset>
        {error ? <p role="alert" className="admin-runtime-error">{error}</p> : null}
        <Button type="submit" loading={saving} disabled={saving || (modelProviderId !== '' && modelId === '')}>创建 Agent</Button>
      </form>
    </SectionCard>
  );
}

function AgentsPanel({
  agents,
  modelOptions,
  skills,
  tools,
  mcpServers,
  onSaved,
}: {
  agents: AdminRuntimeAgent[];
  modelOptions: AdminRuntimeModelOption[];
  skills: AdminRuntimeSkill[];
  tools: AdminRuntimeBuiltinTool[];
  mcpServers: AdminRuntimeMcpServer[];
  onSaved: (agent: AdminRuntimeAgent) => void;
}) {
  return (
    <div className="admin-runtime-cards">
      {agents.length === 0 ? <EmptyState title="暂无 AI 导师 Agent 注册" description="服务端没有返回已发布的 Agent。" /> : null}
      <CreateAgentForm onCreated={onSaved} modelOptions={modelOptions} />
      {agents.map((agent) => (
        <AgentEditorCard
          key={agent.id}
          agent={agent}
          modelOptions={modelOptions}
          skills={skills}
          tools={tools}
          mcpServers={mcpServers}
          onSaved={onSaved}
        />
      ))}
    </div>
  );
}

/* ---------------------------- 内置工具 ----------------------------- */

function ToolsPanel({ tools }: { tools: AdminRuntimeBuiltinTool[] }) {
  if (tools.length === 0) {
    return (
      <EmptyState
        title="暂无内置工具注册"
        description="服务端没有返回可展示的内置工具注册项。"
      />
    );
  }

  return (
    <div className="admin-runtime-cards">
      {tools.map((tool) => (
        <SectionCard
          key={tool.id}
          title={tool.label}
          action={<RuntimeItemStatusBadge status={tool.status} />}
        >
          <div className="admin-runtime-row-meta admin-runtime-row-meta-spaced">
            <code className="admin-console-fingerprint">{tool.id}</code>
            <ToolRiskBadge level={tool.riskLevel} />
          </div>
          {tool.description ? <p className="admin-runtime-description">{tool.description}</p> : null}
          <InfoRow
            label="实践门禁"
            value={boolLabel(tool.requiresTheoryMastered, '需先掌握理论', '无额外门禁')}
            muted={tool.requiresTheoryMastered === null}
          />
          <RuntimeIdList label="关联 Agent" ids={tool.agentIds} />
        </SectionCard>
      ))}
    </div>
  );
}

/* --------------------------- 初始化状态 ---------------------------- */

function InitializationPanel({
  initialization,
  policy,
}: {
  initialization: AdminInitializationStatus;
  policy: AdminRuntimePolicy;
}) {
  const { checks } = initialization;

  return (
    <div className="admin-runtime-cards">
      <SectionCard title="初始化概览" action={<RuntimeHealthBadge health={initialization.overall} />}>
        <InfoRow label="数据模式" value={dataModeLabel(initialization.dataMode)} />
        <InfoRow label="数据库" value={databaseLabel(initialization.database)} />
        <InfoRow label="全局规则" value={policy.status === 'ready' ? `已加载 · ${policy.version ?? 'unknown'}` : '未配置'} muted={policy.status !== 'ready'} />
        <InfoRow label="规则校验摘要" value={policy.contentHash?.slice(0, 12) ?? '—'} muted={policy.contentHash === null} />
        {policy.content ? <details className="admin-runtime-definition"><summary>查看 AGENTS.md 运行规则</summary><pre>{policy.content}</pre></details> : null}
        <InfoRow label="迁移版本" value={initialization.migrationVersion ?? '未知'} muted={initialization.migrationVersion === null} />
      </SectionCard>

      {checks.length === 0 ? (
        <EmptyState
          title="暂无初始化检查项"
          description="服务端没有返回任何初始化检查结果。缺失的项目会被显式标为未知，而不是默认判定为就绪。"
        />
      ) : (
        <SectionCard title={`初始化检查（${checks.length}）`}>
          <ul className="admin-runtime-list">
            {checks.map((check) => (
              <li key={check.id} className="admin-runtime-row">
                <div className="admin-runtime-row-head">
                  <strong className="admin-runtime-row-title">{check.label}</strong>
                  <InitializationCheckBadge status={check.status} />
                </div>
                <div className="admin-runtime-row-meta">
                  <code className="admin-console-fingerprint">{check.id}</code>
                  <span>{areaLabel(check.area)}</span>
                  <span>检查于 {formatRuntimeTime(check.checkedAt)}</span>
                </div>
                {check.detail ? <p className="admin-runtime-description">{check.detail}</p> : null}
                {check.remediation ? (
                  <p className="admin-runtime-remediation">修复建议：{check.remediation}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

/* ------------------------------- 页面 ------------------------------ */

export default function AdminRuntimePage() {
  const [snapshot, setSnapshot] = useState<AdminRuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tab, setTab] = useState<RuntimeTab>('skills');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchRuntimeSnapshot());
    } catch (cause) {
      setSnapshot(null);
      setError(cause instanceof Error ? cause : new Error('未知错误'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || error) {
    const stateView =
      error instanceof AdminRuntimeUnavailableError
        ? RuntimeUnavailableState({ onRetry: load })
        : AdminStateViews({ loading, error, onRetry: load });
    return (
      <div className="admin-settings-page">
        <SettingsSubNav />
        {stateView}
      </div>
    );
  }

  if (!snapshot) return null;

  return (
    <div className="admin-settings-page">
      <SettingsSubNav />

      <div className="admin-page-header">
        <div className="admin-page-header-title">
          <h1>AI 运行时与初始化</h1>
          <DataSourceBadge dataSource={snapshot.dataSource} />
          <RuntimeHealthBadge health={snapshot.overall} />
        </div>
        <p>
          Skills 来自服务端加载的 `.agents/skills/*/SKILL.md`，全局教学规则从仓库根 `AGENTS.md` 加载且在此只读。AI 导师 Agent 在这里集中配置 AGENTS.md、模型、能力和 Skill/Tool/MCP；开发协作角色不会进入运行时。
        </p>
        <p className="admin-runtime-generated">数据生成于 {formatRuntimeTime(snapshot.generatedAt)}</p>
      </div>

      <div className="admin-runtime-summary">
        <InfoRow label="Skills" value={`${snapshot.skills.length} 项`} />
        <InfoRow label="MCP 服务器" value={`${snapshot.mcpServers.length} 个`} />
        <InfoRow label="AI 导师 Agent" value={`${snapshot.agents.length} 个`} />
        <InfoRow label="内置工具" value={`${snapshot.builtInTools.length} 个`} />
        <InfoRow label="初始化检查" value={`${snapshot.initialization.checks.length} 项`} />
      </div>

      <SegmentedControl<RuntimeTab>
        items={TAB_ITEMS}
        value={tab}
        onChange={setTab}
        ariaLabel="AI 运行时治理分类"
        className="admin-runtime-tabs"
      />

      <div className="admin-runtime-panel">
        {tab === 'skills' ? <SkillsPanel skills={snapshot.skills} /> : null}
        {tab === 'mcp' ? <McpPanel servers={snapshot.mcpServers} /> : null}
        {tab === 'agents' ? (
          <AgentsPanel
            agents={snapshot.agents}
            modelOptions={snapshot.modelOptions}
            skills={snapshot.skills}
            tools={snapshot.builtInTools}
            mcpServers={snapshot.mcpServers}
            onSaved={(updated) => setSnapshot((current) => current ? {
              ...current,
              agents: current.agents.some((agent) => agent.id === updated.id)
                ? current.agents.map((agent) => agent.id === updated.id ? updated : agent)
                : [...current.agents, updated],
            } : current)}
          />
        ) : null}
        {tab === 'tools' ? <ToolsPanel tools={snapshot.builtInTools} /> : null}
        {tab === 'init' ? <InitializationPanel initialization={snapshot.initialization} policy={snapshot.policy} /> : null}
      </div>
    </div>
  );
}
