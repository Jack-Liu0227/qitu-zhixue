'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  AdminInitializationStatus,
  AdminRuntimeAgent,
  AdminRuntimeBuiltinTool,
  AdminRuntimeMcpServer,
  AdminRuntimePolicy,
  AdminRuntimeSkill,
  AdminRuntimeSnapshot,
} from '@qitu/contracts';
import { EmptyState, InfoRow, SectionCard, SegmentedControl } from '@qitu/ui';
import { AdminRuntimeUnavailableError, fetchRuntimeSnapshot } from '../../../../lib/api/runtime';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { DataSourceBadge } from '../../../../lib/components/DataSourceBadge';
import { SettingsSubNav } from '../../../../lib/components/SettingsSubNav';
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
 * AI 运行时与初始化治理页（只读）。
 *
 * 单页承载五类治理数据：skills、MCP 服务器、项目 Agent 角色/设置、内置工具、
 * 以及数据库 / 知识库 / 模板 / Tutor 的初始化状态。页面只消费服务端已脱敏的
 * 只读投影，没有任何写入口：默认不展示密钥、MCP 凭据、完整系统提示词或未成年
 * 人原始对话（契约本身不含这些字段）。
 *
 * 五种状态均有显式呈现：
 *  - loading：`AdminStateViews` 的骨架；
 *  - empty：每个分类独立的 `EmptyState`；
 *  - error：`ErrorState` + 重试；
 *  - offline：`OfflineBanner`（readOnly）；
 *  - permission-denied：401/403 → `AdminPermissionError`；
 *  - 接口尚未部署：404 → `RuntimeUnavailableState`（与上述四类区分）。
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

function AgentsPanel({ agents }: { agents: AdminRuntimeAgent[] }) {
  if (agents.length === 0) {
    return (
      <EmptyState
        title="暂无 AI 导师 Agent 注册"
        description="服务端没有返回已发布的 Tutor Partner。开发协作 Agent 不属于此列表，前端不会读取本地开发配置。"
      />
    );
  }

  return (
    <div className="admin-runtime-cards">
      {agents.map((agent) => (
        <SectionCard
          key={agent.id}
          title={agent.label}
          action={<RuntimeItemStatusBadge status={agent.status} />}
        >
          <div className="admin-runtime-row-meta admin-runtime-row-meta-spaced">
            <code className="admin-console-fingerprint">{agent.id}</code>
            <span>{agent.enabled ? '已启用' : '已停用'}</span>
          </div>
          {agent.description ? <p className="admin-runtime-description">{agent.description}</p> : null}
          <InfoRow label="角色" value={agent.role ?? '未知'} muted={agent.role === null} />
          <InfoRow label="模型用途" value={agent.modelUsage ?? '未绑定'} muted={agent.modelUsage === null} />
          <InfoRow label="提示词版本" value={agent.promptVersion ?? '—'} />
          <RuntimeIdList label="能力范围" ids={agent.capabilities} />
          <RuntimeIdList label="关联 Skills" ids={agent.skillIds} />
          <RuntimeIdList label="关联工具" ids={agent.toolIds} />
          <RuntimeIdList label="关联 MCP" ids={agent.mcpServerIds} />
        </SectionCard>
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
          只读治理视图：Tutor Skills、MCP 服务器、AI 导师 Agent、内置工具与初始化状态。不展示开发协作 Agent、密钥、凭据、完整提示词或未成年人原始对话；无法证实的信息一律标为「未知」。
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
        {tab === 'agents' ? <AgentsPanel agents={snapshot.agents} /> : null}
        {tab === 'tools' ? <ToolsPanel tools={snapshot.builtInTools} /> : null}
        {tab === 'init' ? <InitializationPanel initialization={snapshot.initialization} policy={snapshot.policy} /> : null}
      </div>
    </div>
  );
}
