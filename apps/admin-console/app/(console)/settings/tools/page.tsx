'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAdminAssistantConfigs } from '../../../../lib/api/assistants';
import { persistAssistantBinding, hasMcpBinding } from '../../../../lib/api/assistantBindings';
import { fetchRuntimeSnapshot } from '../../../../lib/api/runtime';
import { KnowledgeConfiguration } from '../../../../lib/components/KnowledgeConfiguration';
import type {
  AdminAssistantConfig,
  AdminRuntimeBuiltinTool,
  AdminRuntimeMcpServer,
  AdminRuntimeSnapshot,
} from '@qitu/contracts';

const IMA_ID = 'ima-knowledge';

const MCP_STATUS_TEXT: Record<AdminRuntimeMcpServer['status'], string> = {
  connected: '连接正常',
  disconnected: '未连接',
  error: '连接异常',
  not_configured: '未配置',
  unknown: '状态未知',
};

const BUILTIN_STATUS_TEXT: Record<AdminRuntimeBuiltinTool['status'], string> = {
  enabled: '已启用',
  disabled: '已停用',
  ready: '可用',
  unavailable: '不可用',
  error: '异常',
  unknown: '未知',
};

const RISK_TEXT: Record<AdminRuntimeBuiltinTool['riskLevel'], string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  unknown: '风险未知',
};

export default function ToolsSettingsPage() {
  // ---- 运行时快照（MCP 服务器与内置工具的唯一真实来源） ----
  const [snapshot, setSnapshot] = useState<AdminRuntimeSnapshot | null>(null);
  const [registryPending, setRegistryPending] = useState(true);
  const [registryError, setRegistryError] = useState('');

  // ---- 助手（授权矩阵的行；绑定关系通过服务端持久化） ----
  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);
  const [assistantsPending, setAssistantsPending] = useState(true);
  const [assistantsError, setAssistantsError] = useState('');

  const [notice, setNotice] = useState('');
  const [activeMode, setActiveMode] = useState<'matrix' | 'edit' | 'preview'>('matrix');

  const notify = useCallback((text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(''), 3000);
  }, []);

  const loadRegistry = useCallback(async () => {
    setRegistryPending(true);
    try {
      const state = await fetchRuntimeSnapshot();
      setSnapshot(state);
      setRegistryError('');
    } catch (error) {
      setSnapshot(null);
      setRegistryError(error instanceof Error ? error.message : 'MCP 状态读取失败');
    } finally {
      setRegistryPending(false);
    }
  }, []);

  const loadAssistants = useCallback(async () => {
    setAssistantsPending(true);
    try {
      const list = await fetchAdminAssistantConfigs();
      setAssistants(list ?? []);
      setAssistantsError('');
    } catch (error) {
      setAssistants([]);
      setAssistantsError(error instanceof Error ? error.message : '助手列表读取失败');
    } finally {
      setAssistantsPending(false);
    }
  }, []);

  useEffect(() => {
    void loadRegistry();
    void loadAssistants();
    const refresh = () => void loadRegistry();
    window.addEventListener('qitu-configuration-changed', refresh);
    return () => window.removeEventListener('qitu-configuration-changed', refresh);
  }, [loadRegistry, loadAssistants]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('knowledgeEngine')) setActiveMode('edit');
  }, []);

  // Knowledge Center manages knowledge access. Hidden services must also be
  // excluded from the matrix's row/column bulk operations.
  const mcpServers = useMemo(
    () => snapshot?.mcpServers.filter((server) => server.id !== IMA_ID) ?? [],
    [snapshot],
  );
  const builtinTools = useMemo(() => snapshot?.builtInTools ?? [], [snapshot]);

  /** 服务端持久化助手绑定；失败时回滚本地状态并给出提示。 */
  const applyAssistantPatch = useCallback(async (
    assistantId: string,
    field: 'mcpServerIds' | 'toolIds',
    next: string[],
  ): Promise<boolean> => {
    const previous = assistants;
    setAssistants((prev) => prev.map((a) => (a.id === assistantId ? { ...a, [field]: next } : a)));
    try {
      await persistAssistantBinding(assistantId, field, next);
      return true;
    } catch (error) {
      setAssistants(previous);
      notify(`绑定同步失败：${error instanceof Error ? error.message : '未知错误'}（已回滚）`);
      return false;
    }
  }, [assistants, notify]);

  const isMcpBound = useCallback((assistant: AdminAssistantConfig, server: AdminRuntimeMcpServer) => {
    return hasMcpBinding(assistant, { id: server.id, name: server.label });
  }, []);

  const isBuiltinBound = useCallback((assistant: AdminAssistantConfig, tool: AdminRuntimeBuiltinTool) => {
    return assistant.toolIds.includes(tool.id);
  }, []);

  // ---- 单元格切换 ----
  const toggleMcpForAssistant = useCallback(async (server: AdminRuntimeMcpServer, assistant: AdminAssistantConfig) => {
    const bound = isMcpBound(assistant, server);
    const next = bound
      ? assistant.mcpServerIds.filter((value) => value !== server.id && value !== server.label)
      : [...assistant.mcpServerIds, server.id];
    const ok = await applyAssistantPatch(assistant.id, 'mcpServerIds', next);
    if (ok) notify(`已${bound ? '取消' : '更新'}【${assistant.name}】对 MCP【${server.label}】的授权（已同步服务端）`);
  }, [isMcpBound, applyAssistantPatch, notify]);

  const toggleBuiltinForAssistant = useCallback(async (tool: AdminRuntimeBuiltinTool, assistant: AdminAssistantConfig) => {
    const bound = isBuiltinBound(assistant, tool);
    const next = bound
      ? assistant.toolIds.filter((value) => value !== tool.id)
      : [...assistant.toolIds, tool.id];
    const ok = await applyAssistantPatch(assistant.id, 'toolIds', next);
    if (ok) notify(`已${bound ? '取消' : '更新'}【${assistant.name}】对内置工具【${tool.label}】的授权（已同步服务端）`);
  }, [isBuiltinBound, applyAssistantPatch, notify]);

  // ---- 纵向（整列）批量操作 ----
  const setMcpColumnForAll = useCallback(async (server: AdminRuntimeMcpServer, enabled: boolean) => {
    if (assistants.length === 0) return;
    for (const assistant of assistants) {
      const bound = hasMcpBinding(assistant, { id: server.id, name: server.label });
      if (bound === enabled) continue;
      const next = enabled
        ? [...assistant.mcpServerIds, server.id]
        : assistant.mcpServerIds.filter((value) => value !== server.id && value !== server.label);
      const ok = await applyAssistantPatch(assistant.id, 'mcpServerIds', next);
      if (!ok) return;
    }
    notify(enabled ? `纵向全选成功：已为所有助手开启 MCP【${server.label}】` : `纵向取消成功：已清空所有助手对 MCP【${server.label}】的授权`);
  }, [assistants, applyAssistantPatch, notify]);

  const setBuiltinColumnForAll = useCallback(async (tool: AdminRuntimeBuiltinTool, enabled: boolean) => {
    for (const assistant of assistants) {
      const bound = assistant.toolIds.includes(tool.id);
      if (bound === enabled) continue;
      const next = enabled
        ? [...assistant.toolIds, tool.id]
        : assistant.toolIds.filter((value) => value !== tool.id);
      const ok = await applyAssistantPatch(assistant.id, 'toolIds', next);
      if (!ok) return;
    }
    notify(enabled ? `纵向全选成功：已为所有助手开启【${tool.label}】` : `纵向取消成功：已清空所有助手对【${tool.label}】的授权`);
  }, [assistants, applyAssistantPatch, notify]);

  // ---- 横向（整行）批量操作 ----
  const setAssistantRow = useCallback(async (assistant: AdminAssistantConfig, enabled: boolean) => {
    const nextMcp = enabled
      ? Array.from(new Set([...assistant.mcpServerIds, ...mcpServers.map((s) => s.id)]))
      : assistant.mcpServerIds.filter((value) => !mcpServers.some((s) => s.id === value || s.label === value));
    const okMcp = await applyAssistantPatch(assistant.id, 'mcpServerIds', nextMcp);
    if (!okMcp) return;
    const nextTools = enabled
      ? Array.from(new Set([...assistant.toolIds, ...builtinTools.map((t) => t.id)]))
      : assistant.toolIds.filter((value) => !builtinTools.some((t) => t.id === value));
    const okTools = await applyAssistantPatch(assistant.id, 'toolIds', nextTools);
    if (!okTools) return;
    notify(enabled ? `已为【${assistant.name}】开启当前可见工具授权` : `已清空【${assistant.name}】的当前可见工具授权`);
  }, [mcpServers, builtinTools, applyAssistantPatch, notify]);

  const setEntireMatrix = useCallback(async (enabled: boolean) => {
    for (const assistant of assistants) {
      await setAssistantRow(assistant, enabled);
    }
  }, [assistants, setAssistantRow]);

  const checkboxStyle = (checked: boolean, color: string, disabled = false) => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    borderRadius: '5px',
    border: `1.5px solid ${checked ? color : '#cbd5e1'}`,
    background: checked ? color : '#ffffff',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    userSelect: 'none' as const,
    margin: '0 auto',
  });

  if (['edit', 'preview'].includes(activeMode)) {
    return <KnowledgeConfiguration preview={activeMode === 'preview'} onMode={setActiveMode} />;
  }

  const loading = registryPending && !snapshot;

  return (
    <div className="admin-tools-page-view" style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '32px' }}>
      {/* 页头 */}
      <div className="admin-tools-header" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 className="admin-tools-title" style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0' }}>
              工具与 MCP 配置中心
            </h1>
            <p className="admin-tools-subtitle" style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
              MCP 服务器与内置工具目录来自 AI 运行时快照；授权矩阵的每次勾选都会通过助手接口持久化到服务端。JSON 编辑与预览由配置工作台（服务端持久化）承载。
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* 顶层切换按钮：矩阵 / 编辑 JSON / 实时预览 */}
            <div style={{ background: '#f1f5f9', padding: '3px', borderRadius: '8px', display: 'flex', border: '1px solid #e2e8f0', gap: '2px' }}>
              <button
                type="button"
                style={{
                  padding: '6px 14px', border: 'none', borderRadius: '6px',
                  background: activeMode === 'matrix' ? '#ffffff' : 'transparent',
                  fontWeight: activeMode === 'matrix' ? 600 : 400,
                  boxShadow: activeMode === 'matrix' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer', fontSize: '13px',
                  color: activeMode === 'matrix' ? '#165dff' : '#64748b',
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                }}
                onClick={() => setActiveMode('matrix')}
              >
                📊 智能体授权矩阵
              </button>
              <button
                type="button"
                style={{
                  padding: '6px 14px', border: 'none', borderRadius: '6px',
                  background: activeMode === 'edit' ? '#ffffff' : 'transparent',
                  fontWeight: activeMode === 'edit' ? 600 : 400,
                  boxShadow: activeMode === 'edit' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer', fontSize: '13px',
                  color: activeMode === 'edit' ? '#0f172a' : '#64748b',
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                }}
                onClick={() => setActiveMode('edit')}
              >
                📝 JSON 配置编辑
              </button>
              <button
                type="button"
                style={{
                  padding: '6px 14px', border: 'none', borderRadius: '6px',
                  background: activeMode === 'preview' ? '#ffffff' : 'transparent',
                  fontWeight: activeMode === 'preview' ? 600 : 400,
                  boxShadow: activeMode === 'preview' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer', fontSize: '13px',
                  color: activeMode === 'preview' ? '#0f172a' : '#64748b',
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                }}
                onClick={() => setActiveMode('preview')}
              >
                👁️ JSON 实时预览
              </button>
            </div>

            <button
              type="button"
              className="settings-action-btn is-primary"
              title="在 JSON 配置工作台中新增 MCP 服务器（服务端持久化）"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: '#165dff', color: '#fff', padding: '8px 14px', borderRadius: '8px',
                border: 'none', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
              }}
              onClick={() => setActiveMode('edit')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              添加 MCP
            </button>
          </div>
        </div>
      </div>

      {notice ? (
        <div role="status" style={{ marginBottom: '16px', padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', color: '#16a34a', fontSize: '13px', fontWeight: 600 }}>
          {notice}
        </div>
      ) : null}
      {registryError && (
        <div role="alert" style={{ marginBottom: '16px', padding: '10px 14px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px', fontSize: '13px' }}>
          MCP / 内置工具目录：{registryError}
          <button type="button" onClick={() => void loadRegistry()} style={{ marginLeft: '12px', color: '#165dff', border: 'none', background: 'none', cursor: 'pointer' }}>重试</button>
        </div>
      )}
      {assistantsError && (
        <div role="alert" style={{ marginBottom: '16px', padding: '10px 14px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px', fontSize: '13px' }}>
          助手列表：{assistantsError}
          <button type="button" onClick={() => void loadAssistants()} style={{ marginLeft: '12px', color: '#165dff', border: 'none', background: 'none', cursor: 'pointer' }}>重试</button>
        </div>
      )}


      {loading || assistantsPending ? (
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '32px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
          正在读取 AI 运行时目录与助手列表…
        </div>
      ) : (
        <>
          {/* 视图：智能体与工具启用与关闭矩阵 */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <strong style={{ fontSize: '15px', color: '#0f172a' }}>智能体与工具启用与关闭矩阵 (Capability & Authorization Matrix)</strong>
                <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                  行代表助手（来自助手配置接口），列代表 MCP 服务器与内置工具（来自 AI 运行时快照）。勾选或取消会立即通过服务端接口持久化。
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: '#165dff', background: '#eff6ff', padding: '4px 10px', borderRadius: '6px', fontWeight: 600 }}>
                  {assistants.length} 位助手 · {mcpServers.length} 个 MCP 服务 · {builtinTools.length} 个内置工具
                </span>
              </div>
            </div>

            {assistants.length === 0 ? (
              <div className="settings-empty" style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                暂无助手配置，无法展示授权矩阵。请先在「助手」页创建助手。
              </div>
            ) : mcpServers.length === 0 && builtinTools.length === 0 ? (
              <div className="settings-empty" style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                {registryError ? '运行时目录读取失败，请重试。' : 'AI 运行时未上报任何 MCP 服务器或内置工具。可通过「JSON 配置编辑」添加 MCP 服务器。'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid #f1f5f9', borderRadius: '10px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0' }}>
                      <th style={{ padding: '14px 16px', fontWeight: 700, color: '#334155', minWidth: '180px' }}>
                        <div>智能体角色 (行)</div>
                        <div style={{ display: 'flex', gap: '5px', marginTop: '6px' }}>
                          <button
                            type="button"
                            onClick={() => void setEntireMatrix(true)}
                            style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', border: '1px solid #165dff', background: '#165dff', color: '#ffffff', cursor: 'pointer', fontWeight: 600 }}
                            title="全局全选：为所有助手开启当前可见工具"
                          >
                            全部全选
                          </button>
                          <button
                            type="button"
                            onClick={() => void setEntireMatrix(false)}
                            style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#64748b', cursor: 'pointer' }}
                            title="全部取消：清空所有助手的全部工具"
                          >
                            全部取消
                          </button>
                        </div>
                      </th>
                      {mcpServers.map((server) => (
                        <th key={server.id} style={{ padding: '12px 14px', fontWeight: 700, color: '#1e293b', textAlign: 'center', minWidth: '140px' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ fontSize: '11px', color: server.status === 'connected' ? '#16a34a' : server.status === 'error' ? '#dc2626' : '#94a3b8' }}>●</span>
                            <span>{server.label}</span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 400, marginTop: '2px' }}>
                            {server.toolCount === null ? '工具数未知' : `${server.toolCount} 个工具`} · {MCP_STATUS_TEXT[server.status]}
                          </div>
                          <div style={{ fontSize: '10.5px', color: '#94a3b8', fontWeight: 400 }}>{server.transport} {server.enabled ? '' : '· 已停用'}</div>
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', marginTop: '6px' }}>
                            <button
                              type="button"
                              onClick={() => void setMcpColumnForAll(server, true)}
                              style={{ fontSize: '10.5px', padding: '2px 6px', borderRadius: '4px', border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', fontWeight: 600 }}
                              title={`纵向全选：为所有助手开启【${server.label}】`}
                            >
                              纵向全选
                            </button>
                            <button
                              type="button"
                              onClick={() => void setMcpColumnForAll(server, false)}
                              style={{ fontSize: '10.5px', padding: '2px 6px', borderRadius: '4px', border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
                              title={`纵向取消：取消所有助手对【${server.label}】的授权`}
                            >
                              纵向取消
                            </button>
                          </div>
                        </th>
                      ))}
                      {builtinTools.map((tool) => (
                        <th key={tool.id} style={{ padding: '12px 14px', fontWeight: 700, color: '#4338ca', textAlign: 'center', minWidth: '130px' }}>
                          <div>{tool.label}</div>
                          <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 400, marginTop: '2px' }}>
                            内置工具 · {BUILTIN_STATUS_TEXT[tool.status]}
                          </div>
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', marginTop: '6px' }}>
                            <button
                              type="button"
                              onClick={() => void setBuiltinColumnForAll(tool, true)}
                              style={{ fontSize: '10.5px', padding: '2px 6px', borderRadius: '4px', border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#6d28d9', cursor: 'pointer', fontWeight: 600 }}
                              title={`纵向全选：为所有助手开启【${tool.label}】`}
                            >
                              纵向全选
                            </button>
                            <button
                              type="button"
                              onClick={() => void setBuiltinColumnForAll(tool, false)}
                              style={{ fontSize: '10.5px', padding: '2px 6px', borderRadius: '4px', border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
                              title={`纵向取消：取消所有助手对【${tool.label}】的授权`}
                            >
                              纵向取消
                            </button>
                          </div>
                        </th>
                      ))}
                      <th style={{ padding: '12px 16px', fontWeight: 700, color: '#334155', textAlign: 'center', minWidth: '160px' }}>
                        横向快捷操作 (整行)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {assistants.map((assistant, index) => (
                      <tr key={assistant.id} style={{ borderBottom: '1px solid #f1f5f9', background: index % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>{assistant.name}</div>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                            <span style={{ padding: '1px 6px', background: '#e2e8f0', borderRadius: '4px' }}>{assistant.role || '智能导师'}</span>
                          </div>
                        </td>

                        {mcpServers.map((server) => {
                          const isChecked = isMcpBound(assistant, server);
                          return (
                            <td key={server.id} style={{ padding: '12px 14px', textAlign: 'center' }}>
                              <div
                                role="checkbox"
                                aria-checked={isChecked}
                                aria-label={`${assistant.name} 是否授权 ${server.label}`}
                                tabIndex={0}
                                onClick={() => void toggleMcpForAssistant(server, assistant)}
                                onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); void toggleMcpForAssistant(server, assistant); } }}
                                style={checkboxStyle(isChecked, '#165dff')}
                                title={
                                  isChecked
                                      ? `${assistant.name} 已授权 ${server.label}（点击取消并同步服务端）`
                                      : `${assistant.name} 未授权 ${server.label}（点击勾选并同步服务端）`
                                }
                              >
                                {isChecked ? '✓' : ''}
                              </div>
                            </td>
                          );
                        })}

                        {builtinTools.map((tool) => {
                          const isChecked = isBuiltinBound(assistant, tool);
                          return (
                            <td key={tool.id} style={{ padding: '12px 14px', textAlign: 'center' }}>
                              <div
                                role="checkbox"
                                aria-checked={isChecked}
                                aria-label={`${assistant.name} 是否授权内置工具 ${tool.label}`}
                                tabIndex={0}
                                onClick={() => void toggleBuiltinForAssistant(tool, assistant)}
                                onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); void toggleBuiltinForAssistant(tool, assistant); } }}
                                style={checkboxStyle(isChecked, '#7c3aed')}
                                title={
                                  isChecked
                                    ? `${assistant.name} 已授权【${tool.label}】（点击取消并同步服务端）`
                                    : `${assistant.name} 未授权【${tool.label}】（点击勾选并同步服务端）`
                                }
                              >
                                {isChecked ? '✓' : ''}
                              </div>
                            </td>
                          );
                        })}

                        <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            <button
                              type="button"
                              onClick={() => void setAssistantRow(assistant, true)}
                              style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', fontWeight: 600 }}
                              title={`横向全选：为【${assistant.name}】开启当前可见工具`}
                            >
                              横向全选
                            </button>
                            <button
                              type="button"
                              onClick={() => void setAssistantRow(assistant, false)}
                              style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
                              title={`横向取消：清空【${assistant.name}】的当前可见工具授权`}
                            >
                              横向取消
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 模块二：运行时上报的内置工具（只读） */}
          <div style={{ marginTop: '20px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ marginBottom: '14px' }}>
              <strong style={{ fontSize: '15px', color: '#0f172a' }}>内置工具 (Builtin Tools)</strong>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
                以下目录由 AI 运行时快照上报（只读）。按助手的授权请在上方矩阵中勾选，写回通过助手接口持久化。
              </p>
            </div>

            {builtinTools.length === 0 ? (
              <div className="settings-empty" style={{ padding: '20px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                {registryError ? '运行时目录读取失败，请重试。' : 'AI 运行时未上报内置工具。'}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
                {builtinTools.map((tool) => (
                  <div key={tool.id} style={{ padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                      <strong style={{ fontSize: '13px', color: '#0f172a' }}>{tool.label}</strong>
                      <span style={{ fontSize: '11px', color: tool.status === 'error' || tool.status === 'unavailable' ? '#b91c1c' : '#16a34a', fontWeight: 600 }}>
                        ● {BUILTIN_STATUS_TEXT[tool.status]}
                      </span>
                    </div>
                    {tool.description ? (
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{tool.description}</div>
                    ) : null}
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px', fontSize: '11px' }}>
                      <span style={{ padding: '1px 6px', borderRadius: '4px', background: tool.riskLevel === 'high' ? '#fef2f2' : '#f1f5f9', color: tool.riskLevel === 'high' ? '#b91c1c' : '#475569', fontWeight: 600 }}>
                        {RISK_TEXT[tool.riskLevel]}
                      </span>
                      {tool.requiresTheoryMastered === true ? (
                        <span style={{ padding: '1px 6px', borderRadius: '4px', background: '#fff7ed', color: '#c2410c', fontWeight: 600 }}>需 TheoryMastered 门禁</span>
                      ) : null}
                      <span style={{ padding: '1px 6px', borderRadius: '4px', background: '#f1f5f9', color: '#475569' }}>
                        {tool.agentIds.length} 个角色注册
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
