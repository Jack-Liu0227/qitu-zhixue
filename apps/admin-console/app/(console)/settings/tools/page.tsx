'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminImaSettings, AdminImaSettingsPatch, AdminRuntimeSnapshot, AdminTeamConfig } from '@qitu/contracts';
import { fetchImaSettings, saveImaSettings, checkImaConnection } from '../../../../lib/api/ima';
import { fetchRuntimeSnapshot } from '../../../../lib/api/runtime';
import { fetchAdminTeamConfigs } from '../../../../lib/api/teams';
import { createIdempotentRetryKey } from '../../../../lib/api/types';
import styles from './tools.module.css';

type Mode = 'matrix' | 'edit' | 'preview';
function editable(settings: AdminImaSettings): AdminImaSettingsPatch {
  return { enabled: settings.enabled,
    assistantBindings: settings.assistants.map((row) => ({ id: row.id, enabled: row.authorized })),
    agentBindings: settings.agents.map((row) => ({ id: row.id, enabled: row.authorized })),
  };
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';

export default function ToolsSettingsPage() {
  const [ima, setIma] = useState<AdminImaSettings | null>(null);
  const [runtime, setRuntime] = useState<AdminRuntimeSnapshot | null>(null);
  const [teams, setTeams] = useState<AdminTeamConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<Mode>('matrix');
  const [target, setTarget] = useState('ima-knowledge');
  const [draft, setDraft] = useState('');
  const [jsonError, setJsonError] = useState('');
  const busy = useRef(false);
  const retry = useRef(createIdempotentRetryKey());
  const probeRetry = useRef(createIdempotentRetryKey());

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const results = await Promise.allSettled([fetchImaSettings(), fetchRuntimeSnapshot(), fetchAdminTeamConfigs()]);
    setIma(results[0].status === 'fulfilled' ? results[0].value : null);
    setRuntime(results[1].status === 'fulfilled' ? results[1].value : null);
    setTeams(results[2].status === 'fulfilled' ? results[2].value : []);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) setError(failures.map((result) => result.status === 'rejected' ? errorMessage(result.reason) : '').join('；'));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!ima) return;
    setDraft(JSON.stringify(target === 'global' ? { mcpServers: { 'ima-knowledge': editable(ima) } } : editable(ima), null, 2));
    setJsonError('');
  }, [ima, target]);

  async function save(patch: AdminImaSettingsPatch): Promise<boolean> {
    if (busy.current || loading) return false;
    busy.current = true; setPending(true); setError(''); setNotice('');
    try {
      const result = await saveImaSettings(patch, retry.current.keyFor(JSON.stringify(patch)));
      retry.current.acknowledge(); setIma(result); setNotice('ima 设置已保存到服务器'); return true;
    } catch (failure) { setError(errorMessage(failure)); return false; }
    finally { busy.current = false; setPending(false); }
  }

  async function check() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(''); setNotice('');
    try {
      const result = await checkImaConnection(probeRetry.current.keyFor('check'));
      probeRetry.current.acknowledge(); setIma(result);
      setNotice(result.status === 'connected' ? '连接检查通过，已验证 ima 知识库读取' : '连接检查失败，请检查服务端配置');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { busy.current = false; setPending(false); }
  }

  async function saveJson() {
    try {
      const parsed: unknown = JSON.parse(draft);
      let patch = parsed;
      if (target === 'global') {
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== 1 || !('mcpServers' in parsed)) throw new Error('总配置须只包含 mcpServers');
        const servers = parsed.mcpServers;
        if (!servers || typeof servers !== 'object' || Array.isArray(servers) || Object.keys(servers).length !== 1 || !('ima-knowledge' in servers)) throw new Error('本页仅支持编辑已接入的 ima-knowledge');
        patch = servers['ima-knowledge'];
      }
      if (await save(patch as AdminImaSettingsPatch)) setJsonError('');
    } catch (failure) { setJsonError(errorMessage(failure)); }
  }

  const disabled = pending || loading || !ima?.registered;
  const connectionLabel = !ima?.registered ? '未注册' : ima.status === 'connected' ? '连接正常' : ima.status === 'error' ? '连接失败' : '待检查';
  const servers = runtime?.mcpServers ?? [];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div><h1>工具与 MCP 配置中心</h1><p>查看服务状态，管理 ima 知识库的全局开关与智能体授权。</p></div>
        <button className={styles.button} disabled={loading || pending} onClick={() => void load()}>刷新状态</button>
      </header>
      {loading && <p role="status">正在读取服务器配置…</p>}
      {error && <div role="alert" className={styles.error}>{error}<button onClick={() => void load()} disabled={pending}>重新读取</button></div>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      <section className={styles.card} aria-label="ima 全局设置">
        <div className={styles.header}>
          <div><h2>ima 教材知识库 <span className={ima?.status === 'connected' ? styles.good : styles.muted}>{connectionLabel}</span></h2>
            <p>多个 Agent 共享同一知识库，只读检索与教材阅读。</p></div>
          <div className={styles.actions}>
            <label className={styles.switch}><input type="checkbox" role="switch" aria-label="允许调用 ima 知识库" checked={ima?.enabled ?? false} disabled={disabled}
              onChange={(event) => void save({ enabled: event.target.checked })} />允许调用 ima <strong>{ima?.enabled ? '已开启' : '已关闭'}</strong></label>
            <button className={styles.button} disabled={disabled} onClick={() => void check()}>{pending ? '处理中…' : '检查连接'}</button>
          </div>
        </div>
        <div className={styles.facts}>
          <span>服务端凭证：{ima ? ima.credentialConfigured ? '已配置' : '未配置' : '待读取'}</span>
          <span>只读工具：{ima?.toolCount ?? '待检查'}</span>
          <span>最近检查：{ima?.lastCheckedAt ? new Date(ima.lastCheckedAt).toLocaleString('zh-CN') : '尚未检查'}</span>
        </div>
        <p>关闭后，后端会拦截后续 ima 工具调用；已经发出的请求可能继续完成。助手的启停与模型配置分别管理。</p>
        {ima?.lastError && <p className={styles.error}>{ima.lastError}</p>}
      </section>
      <nav className={styles.tabs} aria-label="MCP 配置视图">
        {([['matrix', '智能体授权矩阵'], ['edit', '编辑 JSON'], ['preview', '实时预览']] as const).map(([key, label]) =>
          <button key={key} className={`${styles.button} ${mode === key ? styles.selected : ''}`} aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>)}
      </nav>
      {mode === 'matrix' ? <section className={styles.card}>
        <h2>智能体工具授权与权限矩阵</h2>
        <p>勾选后保存到服务器。学生对话同时受当前阶段助手授权、学习搭档 Agent 授权和总开关约束。</p>
        {!ima?.assistants.length && !loading && <p>尚无可授权助手，请在 AI 助手中添加。</p>}
        <div className={styles.tableScroll}><table className={styles.table}>
          <thead><tr><th>智能体角色</th><th>角色状态</th><th>ima 教材知识库</th><th>调用状态</th></tr></thead>
          <tbody>{ima?.assistants.map((row) => <tr key={row.id}>
            <td><strong>{row.name}</strong><small>{row.id}</small></td><td>{row.enabled ? '已启用' : '已停用'}</td>
            <td><input type="checkbox" aria-label={`${row.name} 的 ima 授权`} checked={row.authorized} disabled={disabled}
              onChange={(event) => void save({ assistantBindings: [{ id: row.id, enabled: event.target.checked }] })} /></td>
            <td>{!row.enabled ? '助手已停用' : !row.authorized ? '未授权' : !ima.enabled ? '总开关已关闭' : !ima.agents.find((agent) => agent.id === 'qitu-learning-partner')?.authorized ? '学习搭档 Agent 未授权' : '已授权，按运行策略调用'}</td>
          </tr>)}</tbody>
        </table></div>
        <h3>运行时 Agent 授权</h3><p>运行时角色与上方助手分别登记；这里展示现有 Agent 的实际绑定。</p>
        <div className={styles.tableScroll}><table className={styles.table}>
          <thead><tr><th>Agent</th><th>角色状态</th><th>ima 授权</th><th>可用只读工具</th></tr></thead>
          <tbody>{ima?.agents.map((row) => <tr key={row.id}>
            <td><strong>{row.name}</strong><small>{row.id}</small></td><td>{row.enabled ? '已启用' : '已停用'}</td>
            <td><input type="checkbox" aria-label={`${row.name} Agent 的 ima 授权`} checked={row.authorized} disabled={disabled}
              onChange={(event) => void save({ agentBindings: [{ id: row.id, enabled: event.target.checked }] })} /></td>
            <td>{row.authorized && row.enabled && ima.enabled ? row.tools.length : 0} 个</td>
          </tr>)}</tbody>
        </table></div>
      </section> : <div className={styles.workspace}>
        <aside className={styles.card} aria-label="MCP 列表">
          <h2>MCP 服务器</h2>
          <button className={`${styles.server} ${target === 'global' ? styles.selected : ''}`} onClick={() => setTarget('global')}>总配置 · mcpServers<small>ima 的全局配置与授权</small></button>
          <button className={`${styles.server} ${target === 'ima-knowledge' ? styles.selected : ''}`} onClick={() => setTarget('ima-knowledge')}>ima 教材知识库<small>{connectionLabel} · {ima?.enabled ? '允许调用' : '调用已关闭'}</small></button>
          {servers.filter((server) => server.id !== 'ima-knowledge').map((server) => <div className={styles.server} key={server.id}>{server.label}<small>{server.enabled ? '已开启' : '已关闭'} · {server.status}</small></div>)}
          <p>列表来自后端注册表；新增服务注册后会显示在此处。</p>
        </aside>
        <section className={styles.card}>
          <div className={styles.header}><h2>{target === 'global' ? 'mcpServers.json' : 'ima-knowledge.json'}</h2>
            {mode === 'edit' && <div className={styles.actions}>
              <button className={styles.button} onClick={() => { try { setDraft(JSON.stringify(JSON.parse(draft), null, 2)); setJsonError(''); } catch (failure) { setJsonError(errorMessage(failure)); } }}>格式化 JSON</button>
              <button className={`${styles.button} ${styles.primary}`} disabled={disabled} onClick={() => void saveJson()}>保存配置</button>
            </div>}
          </div>
          <p>编辑总开关、助手与 Agent 授权。连接地址及凭证由服务端管理。</p>
          {jsonError && <p role="alert" className={styles.error}>{jsonError}</p>}
          {mode === 'edit' ? <textarea className={styles.editor} aria-label="ima JSON 配置" value={draft} disabled={disabled} spellCheck={false} onChange={(event) => setDraft(event.target.value)} />
            : <><div className={styles.tags}>{ima?.tools.map((tool) => <span key={tool}>{tool}</span>)}</div>
              <h3>已授权助手</h3><div className={styles.tags}>{ima?.assistants.filter((row) => row.authorized).map((row) => <span key={row.id}>{row.name}{row.enabled ? '' : ' · 已停用'}</span>)}</div>
              <pre className={styles.editor}>{ima ? JSON.stringify({ ...editable(ima), connection: { transport: ima.transport, endpointOrigin: ima.endpointOrigin, status: ima.status, lastCheckedAt: ima.lastCheckedAt } }, null, 2) : '配置尚未读取'}</pre></>}
        </section>
      </div>}
      <section className={styles.card}>
        <h2>已注册能力与状态</h2><p>新增工具、技能、助手和团队必须注册到后端，管理员可在对应设置中查看状态。</p>
        <div className={styles.inventory}>
          <div><h3>工具与 MCP</h3>{!runtime && <p>状态尚未读取</p>}{runtime?.builtInTools.map((tool) => <p key={tool.id}>{tool.label}<small>{tool.status} · {tool.agentIds.length} 个 Agent</small></p>)}
            {servers.map((server) => <p key={server.id}>{server.label}<small>{(server.id === 'ima-knowledge' ? ima?.enabled : server.enabled) ? '允许调用' : '已关闭'} · {server.id === 'ima-knowledge' ? connectionLabel : server.status}</small></p>)}</div>
          <div><h3><Link href="/settings/skills">技能中心 →</Link></h3>{runtime?.skills.map((skill) => <p key={skill.id}>{skill.label}<small>{skill.status} · {skill.agentIds.length} 个 Agent</small></p>)}</div>
          <div><h3><Link href="/settings/assistants">AI 助手 →</Link></h3>{ima?.assistants.map((assistant) => <p key={assistant.id}>{assistant.name}<small>{assistant.enabled ? '已启用' : '已停用'}</small></p>)}</div>
          <div><h3><Link href="/settings/teams">协作团队 →</Link></h3>{teams.map((team) => <p key={team.id}>{team.name}<small>{team.enabled ? '已启用' : '已停用'} · {team.members.length} 位成员</small></p>)}</div>
        </div>
      </section>
    </div>
  );
}
