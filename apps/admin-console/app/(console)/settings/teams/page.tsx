'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAdminTeams, updateAgentRoute, startTeamRun, delegateTeamTask, fetchTeamRun, type TeamRuntimeSnapshot, type AgentGraphEdge } from '../../../../lib/api/teams';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { SettingsSubNav } from '../../../../lib/components/SettingsSubNav';

export default function AdminTeamsPage() {
  const [data, setData] = useState<TeamRuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [search, setSearch] = useState('');
  const [routeSaving, setRouteSaving] = useState<string | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testMessage, setTestMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await fetchAdminTeams()); }
    catch (cause) { setError(cause instanceof Error ? cause : new Error('协作图加载失败')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const nodes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.graph.nodes ?? []).filter((node) => !query || [node.id, node.label, node.role ?? '', node.roleDefinition].join(' ').toLowerCase().includes(query));
  }, [data, search]);

  async function toggleRoute(route: AgentGraphEdge) {
    setRouteSaving(route.id);
    try {
      const updated = await updateAgentRoute(route.id, { enabled: !route.enabled });
      setData((current) => current ? { ...current, routes: current.routes.map((item) => item.id === updated.id ? updated : item), graph: { ...current.graph, edges: current.graph.edges.map((item) => item.id === updated.id ? updated : item) } } : current);
    } catch (cause) {
      setTestMessage(cause instanceof Error ? cause.message : '路由更新失败');
    } finally { setRouteSaving(null); }
  }

  async function runCollaborationTest() {
    const route = data?.routes.find((item) => item.enabled && item.trigger === 'delegate');
    if (!route) { setTestMessage('没有可用的 delegate 路由，服务端不会创建假测试。'); return; }
    setTestRunning(true);
    setTestMessage('正在创建真实 Team Run 并投递任务…');
    try {
      const run = await startTeamRun(route.source);
      const task = await delegateTeamTask({ runId: run.id, senderAgentId: route.source, recipientAgentId: route.target, taskType: route.taskType });
      const graph = await fetchTeamRun(run.id) as { run?: { status?: string }; tasks?: Array<{ status?: string }> };
      setTestMessage(`已写入 Team Run ${run.id.slice(0, 8)}，任务 ${task.id.slice(0, 8)} 已进入 ${task.status}；当前运行状态 ${graph.run?.status ?? run.status}。worker 会从真实模型执行并回写结果。`);
    } catch (cause) {
      setTestMessage(cause instanceof Error ? cause.message : '协同测试失败');
    } finally { setTestRunning(false); }
  }

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) return <div className="admin-settings-page"><SettingsSubNav />{stateView}</div>;

  return (
    <div className="admin-settings-page">
      <SettingsSubNav />
      <div className="admin-page-header">
        <div className="admin-page-header-title"><div><h1>团队协作运行时</h1><p>团队由服务端 Agent 节点与显式路由组成。测试会真实创建 Team Run、投递任务并读取持久化状态。</p></div></div>
        <div className="admin-page-header-actions"><input className="admin-search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 Agent 或职责" /><button type="button" className="settings-action-btn is-primary" disabled={testRunning} onClick={() => void runCollaborationTest()}>{testRunning ? '执行中…' : '运行协同测试'}</button></div>
      </div>
      <div className="admin-runtime-summary"><span>Agent 节点 {data?.graph.nodes.length ?? 0}</span><span>路由 {data?.routes.length ?? 0}</span><span>启用路由 {data?.routes.filter((route) => route.enabled).length ?? 0}</span><span>数据生成于 {data ? new Date(data.graph.generatedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</span></div>
      {testMessage ? <div className="runtime-test-banner" role="status">{testMessage}</div> : null}
      <section className="runtime-section"><div className="runtime-section-head"><h2>Agent 节点</h2><span>模型和启用状态来自运行时治理接口</span></div><div className="admin-data-table admin-table-compact admin-runtime-table"><table><thead><tr><th>节点</th><th>角色</th><th>模型</th><th>父节点</th><th>状态</th><th>能力</th></tr></thead><tbody>{nodes.map((node) => <tr key={node.id}><td><strong>{node.label}</strong><code>{node.id}</code></td><td>{node.role ?? '未声明'}</td><td>{node.modelLabel ?? '未绑定'}</td><td>{node.parentAgentId ?? '根节点'}</td><td><span className={`runtime-status ${node.enabled && node.modelAvailable ? 'is-ready' : node.enabled ? 'is-warning' : 'is-off'}`}>{node.enabled ? (node.modelAvailable ? '可执行' : '待配置') : '已停用'}</span></td><td>{node.capabilities?.join(' · ') || '—'}</td></tr>)}</tbody></table></div>{nodes.length === 0 ? <div className="admin-empty-state">没有匹配的 Agent 节点。</div> : null}</section>
      <section className="runtime-section"><div className="runtime-section-head"><h2>显式协同路由</h2><span>只有启用且命中任务类型的路由才能被 delegate</span></div><div className="admin-data-table admin-table-compact admin-runtime-table"><table><thead><tr><th>来源</th><th>目标</th><th>任务类型</th><th>触发器</th><th>状态</th><th>操作</th></tr></thead><tbody>{(data?.routes ?? []).map((route) => <tr key={route.id}><td><code>{route.source}</code></td><td><code>{route.target}</code></td><td>{route.taskType}</td><td>{route.trigger}</td><td><span className={`runtime-status ${route.enabled ? 'is-ready' : 'is-off'}`}>{route.enabled ? '启用' : '停用'}</span></td><td><button type="button" className="settings-pill-btn" disabled={routeSaving === route.id} onClick={() => void toggleRoute(route)}>{routeSaving === route.id ? '保存中…' : route.enabled ? '停用' : '启用'}</button></td></tr>)}</tbody></table></div>{(data?.routes.length ?? 0) === 0 ? <div className="admin-empty-state">服务端还没有配置协同路由，无法执行协同测试。</div> : null}</section>
    </div>
  );
}
