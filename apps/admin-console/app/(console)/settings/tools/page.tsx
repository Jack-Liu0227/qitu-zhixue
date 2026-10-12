'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchAdminAssistantConfigs } from '../../../../lib/api/assistants';
import type { AdminAssistantConfig } from '@qitu/contracts';

export interface SingleMcpConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  transport?: 'stdio' | 'sse';
  status: 'connected' | 'disconnected' | 'error';
  latencyMs?: number;
  tools: string[];
  boundAssistants: string[];
  description?: string;
  rawJson: string;
}

const DEFAULT_MCP_LIST: SingleMcpConfig[] = [
  {
    id: 'mcp-grok-search',
    name: 'groksearch',
    command: 'uvx',
    args: ['--from', 'git+https://github.com/GuDaStudio/GrokSearch@grok-with-tavily', 'groksearch'],
    env: {
      GROK_API_KEY: 'xai-grok-search-live-key',
      TAVILY_API_KEY: 'tvly-free-search-key',
    },
    transport: 'stdio',
    status: 'connected',
    latencyMs: 26,
    tools: ['grok_web_search', 'fetch_page_markdown', 'knowledge_crawl', 'citation_extract'],
    boundAssistants: ['雷霆战机总导师', '动手学动能定理总导师'],
    description: '集成自 Pi/Codex 的 Grok 深度搜索与 Tavily 互联网实时检索，支持学术与事实溯源。',
    rawJson: JSON.stringify(
      {
        name: 'groksearch',
        command: 'uvx',
        args: ['--from', 'git+https://github.com/GuDaStudio/GrokSearch@grok-with-tavily', 'groksearch'],
        env: {
          GROK_API_KEY: 'xai-grok-search-live-key',
          TAVILY_API_KEY: 'tvly-free-search-key',
        },
        transport: 'stdio',
        description: '集成自 Pi/Codex 的 Grok 深度搜索与 Tavily 互联网实时检索，支持学术与事实溯源。',
        boundAssistants: ['雷霆战机总导师', '动手学动能定理总导师'],
        tools: ['grok_web_search', 'fetch_page_markdown', 'knowledge_crawl', 'citation_extract'],
      },
      null,
      2
    ),
  },
  {
    id: 'mcp-chrome-devtools',
    name: 'chrome-devtools',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-chrome-devtools'],
    transport: 'stdio',
    status: 'connected',
    latencyMs: 18,
    tools: ['launch_browser', 'navigate_page', 'click_element', 'take_screenshot', 'capture_console'],
    boundAssistants: ['雷霆战机总导师', '代码向导与答辩导师'],
    description: 'Chrome DevTools 自动化视口控制、页面渲染监测与前端控制台日志捕获。',
    rawJson: JSON.stringify(
      {
        name: 'chrome-devtools',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-chrome-devtools'],
        transport: 'stdio',
        description: 'Chrome DevTools 自动化视口控制、页面渲染监测与前端控制台日志捕获。',
        boundAssistants: ['雷霆战机总导师', '代码向导与答辩导师'],
        tools: ['launch_browser', 'navigate_page', 'click_element', 'take_screenshot', 'capture_console'],
      },
      null,
      2
    ),
  },
  {
    id: 'mcp-aionui-browser',
    name: 'aionui-browser',
    command: 'npx',
    args: ['-y', '@aionui/browser-mcp'],
    transport: 'stdio',
    status: 'connected',
    latencyMs: 22,
    tools: ['browser_tab_open', 'read_dom', 'execute_js_action', 'snapshot_viewport'],
    boundAssistants: ['雷霆战机总导师', '动手学动能定理总导师'],
    description: 'AionUI 浏览器自动化 DOM 读取与学生交互沙箱。',
    rawJson: JSON.stringify(
      {
        name: 'aionui-browser',
        command: 'npx',
        args: ['-y', '@aionui/browser-mcp'],
        transport: 'stdio',
        description: 'AionUI 浏览器自动化 DOM 读取与学生交互沙箱。',
        boundAssistants: ['雷霆战机总导师', '动手学动能定理总导师'],
        tools: ['browser_tab_open', 'read_dom', 'execute_js_action', 'snapshot_viewport'],
      },
      null,
      2
    ),
  },
  {
    id: 'mcp-fetch',
    name: 'fetch',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    transport: 'stdio',
    status: 'connected',
    latencyMs: 15,
    tools: ['fetch_html', 'fetch_markdown', 'extract_links'],
    boundAssistants: ['动手学动能定理总导师', '雷霆战机总导师'],
    description: '官方轻量免费网页抓取与 Markdown 内容抽取 MCP 服务器。',
    rawJson: JSON.stringify(
      {
        name: 'fetch',
        command: 'uvx',
        args: ['mcp-server-fetch'],
        transport: 'stdio',
        description: '官方轻量免费网页抓取与 Markdown 内容抽取 MCP 服务器。',
        boundAssistants: ['动手学动能定理总导师', '雷霆战机总导师'],
        tools: ['fetch_html', 'fetch_markdown', 'extract_links'],
      },
      null,
      2
    ),
  },
];

export default function ToolsSettingsPage() {
  const [mcpList, setMcpList] = useState<SingleMcpConfig[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('qitu.admin.mcp_list');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {
        // fallback
      }
    }
    return DEFAULT_MCP_LIST;
  });

  const [selectedMcpId, setSelectedMcpId] = useState<string>(DEFAULT_MCP_LIST[0]!.id);
  const [editorTab, setEditorTab] = useState<'json-edit' | 'preview'>('json-edit');
  const [jsonTextDraft, setJsonTextDraft] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);

  // 内置工具开关状态
  const [imageGenEnabled, setImageGenEnabled] = useState<boolean>(true);
  const [sandboxEnabled, setSandboxEnabled] = useState<boolean>(true);

  // 挂载时加载助手信息
  useEffect(() => {
    fetchAdminAssistantConfigs()
      .then((res) => {
        if (res && res.length > 0) setAssistants(res);
      })
      .catch(() => {});
  }, []);

  // 持久化存储 MCP 列表
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('qitu.admin.mcp_list', JSON.stringify(mcpList));
      } catch {
        // guard
      }
    }
  }, [mcpList]);

  // 当前选中的 MCP
  const currentMcp = useMemo(() => {
    return mcpList.find((m) => m.id === selectedMcpId) ?? mcpList[0]!;
  }, [mcpList, selectedMcpId]);

  // 当选中的 MCP 改变时，同步草稿文本
  useEffect(() => {
    if (currentMcp) {
      setJsonTextDraft(currentMcp.rawJson);
      setJsonError(null);
    }
  }, [currentMcp.id]);

  // 格式化当前 MCP 的 JSON
  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonTextDraft);
      setJsonTextDraft(JSON.stringify(parsed, null, 2));
      setJsonError(null);
    } catch (err) {
      setJsonError('格式化失败: ' + (err as Error).message);
    }
  };

  // 保存当前单 MCP 的 JSON 配置
  const handleSaveCurrentMcp = () => {
    try {
      const parsed = JSON.parse(jsonTextDraft);
      const name = parsed.name || currentMcp.name;
      const command = parsed.command || 'npx';
      const args = Array.isArray(parsed.args) ? parsed.args.map(String) : [];
      const env = typeof parsed.env === 'object' && parsed.env !== null ? parsed.env : undefined;
      const tools = Array.isArray(parsed.tools) ? parsed.tools.map(String) : currentMcp.tools;
      const boundAssistants = Array.isArray(parsed.boundAssistants) ? parsed.boundAssistants.map(String) : currentMcp.boundAssistants;
      const description = typeof parsed.description === 'string' ? parsed.description : currentMcp.description;

      const updatedMcp: SingleMcpConfig = {
        ...currentMcp,
        name,
        command,
        args,
        env,
        tools,
        boundAssistants,
        description,
        rawJson: JSON.stringify(parsed, null, 2),
      };

      setMcpList((prev) => prev.map((m) => (m.id === currentMcp.id ? updatedMcp : m)));
      setJsonError(null);
      setNotice(`MCP【${name}】的独立配置已成功校验并保存！✔`);
      setTimeout(() => setNotice(''), 2500);
    } catch (err) {
      setJsonError('JSON 语法错误: ' + (err as Error).message);
    }
  };

  // 添加新 MCP
  const handleAddNewMcp = () => {
    const rawName = prompt('请输入新 MCP 名称 (例如 filesystem, sqlite, github)：');
    if (!rawName || !rawName.trim()) return;
    const name = rawName.trim().toLowerCase();
    const newId = `mcp-${name}-${Date.now().toString().slice(-4)}`;
    const templateObj = {
      name,
      command: 'npx',
      args: [`-y`, `@modelcontextprotocol/server-${name}`],
      env: {},
      transport: 'stdio',
      description: `自定义 ${name} MCP 独立服务器配置`,
      boundAssistants: ['雷霆战机总导师'],
      tools: [`${name}_action`, `${name}_query`],
    };
    const newMcp: SingleMcpConfig = {
      id: newId,
      name,
      command: 'npx',
      args: [`-y`, `@modelcontextprotocol/server-${name}`],
      transport: 'stdio',
      status: 'connected',
      latencyMs: 20,
      tools: templateObj.tools,
      boundAssistants: templateObj.boundAssistants,
      description: templateObj.description,
      rawJson: JSON.stringify(templateObj, null, 2),
    };

    setMcpList((prev) => [...prev, newMcp]);
    setSelectedMcpId(newId);
    setNotice(`已新建 MCP【${name}】并生成独立 JSON 模板！✔`);
    setTimeout(() => setNotice(''), 2500);
  };

  // 删除当前 MCP
  const handleDeleteCurrentMcp = (id: string, name: string) => {
    if (mcpList.length <= 1) {
      alert('至少保留一个 MCP 工具服务器！');
      return;
    }
    if (!window.confirm(`确定要删除 MCP【${name}】配置吗？此操作不可逆。`)) return;
    const next = mcpList.filter((m) => m.id !== id);
    setMcpList(next);
    setSelectedMcpId(next[0]!.id);
    setNotice(`MCP【${name}】已成功移除！✔`);
    setTimeout(() => setNotice(''), 2500);
  };

  // 绑定 / 解绑助手
  const toggleAssistantBinding = (asstName: string) => {
    try {
      const parsed = JSON.parse(jsonTextDraft);
      let list: string[] = Array.isArray(parsed.boundAssistants) ? parsed.boundAssistants : [];
      if (list.includes(asstName)) {
        list = list.filter((n) => n !== asstName);
      } else {
        list.push(asstName);
      }
      parsed.boundAssistants = list;
      const formatted = JSON.stringify(parsed, null, 2);
      setJsonTextDraft(formatted);

      setMcpList((prev) =>
        prev.map((m) =>
          m.id === currentMcp.id
            ? { ...m, boundAssistants: list, rawJson: formatted }
            : m
        )
      );
    } catch {
      // json error guard
    }
  };

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
              一个 MCP 一个独立 JSON，类似 Markdown 文件支持独立编辑与实时解析预览。支持为各个智能体绑定调用。
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="settings-action-btn is-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: '#165dff',
                color: '#fff',
                padding: '8px 14px',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
              }}
              onClick={handleAddNewMcp}
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
        <div style={{ marginBottom: '16px', padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', color: '#16a34a', fontSize: '13px', fontWeight: 600 }}>
          {notice}
        </div>
      ) : null}

      {/* 模块一：MCP 服务器列表卡片选择与单 MCP JSON 工作台 */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '18px', alignItems: 'start' }}>
        {/* 左侧：MCP 列表与状态 */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>已配置 MCP 服务器 ({mcpList.length})</span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>独立 JSON 管理</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {mcpList.map((mcp) => {
              const isSelected = mcp.id === currentMcp.id;
              return (
                <div
                  key={mcp.id}
                  onClick={() => setSelectedMcpId(mcp.id)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    background: isSelected ? '#f0f7ff' : '#ffffff',
                    border: isSelected ? '1px solid #165dff' : '1px solid #e2e8f0',
                    transition: 'all 0.15s ease',
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: isSelected ? '#165dff' : '#64748b', fontSize: '12px' }}>▶</span>
                      <strong style={{ fontSize: '13.5px', color: isSelected ? '#165dff' : '#0f172a' }}>{mcp.name}</strong>
                    </div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#16a34a', background: '#ecfdf5', padding: '1px 6px', borderRadius: '999px', fontWeight: 600 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {mcp.latencyMs ?? 20}ms
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
                    {mcp.description || `${mcp.command} ${(mcp.args || []).join(' ')}`}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', fontSize: '11px', color: '#94a3b8' }}>
                    <span>{mcp.tools.length} 个工具</span>
                    <span>·</span>
                    <span>{mcp.boundAssistants.length} 个智能体绑定</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 右侧：单 MCP 详情、JSON 编辑与实时解析预览 */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          {/* 顶部标题与 Tab 栏 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', paddingBottom: '14px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>⚙️</span>
              <div>
                <strong style={{ fontSize: '15px', color: '#0f172a' }}>{currentMcp.name}.json</strong>
                <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '8px' }}>
                  单 MCP 独立配置 (stdio / uvx / npx)
                </span>
              </div>
            </div>

            {/* 编辑与预览 Tab */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ background: '#f1f5f9', padding: '3px', borderRadius: '8px', display: 'flex', border: '1px solid #e2e8f0' }}>
                <button
                  type="button"
                  style={{
                    padding: '5px 12px',
                    border: 'none',
                    borderRadius: '6px',
                    background: editorTab === 'json-edit' ? '#ffffff' : 'transparent',
                    fontWeight: editorTab === 'json-edit' ? 600 : 400,
                    boxShadow: editorTab === 'json-edit' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: editorTab === 'json-edit' ? '#0f172a' : '#64748b',
                  }}
                  onClick={() => setEditorTab('json-edit')}
                >
                  📝 编辑 JSON
                </button>
                <button
                  type="button"
                  style={{
                    padding: '5px 12px',
                    border: 'none',
                    borderRadius: '6px',
                    background: editorTab === 'preview' ? '#ffffff' : 'transparent',
                    fontWeight: editorTab === 'preview' ? 600 : 400,
                    boxShadow: editorTab === 'preview' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: editorTab === 'preview' ? '#0f172a' : '#64748b',
                  }}
                  onClick={() => setEditorTab('preview')}
                >
                  👁️ 实时预览
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleDeleteCurrentMcp(currentMcp.id, currentMcp.name)}
                title="删除此 MCP 配置"
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#dc2626',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🗑️ 删除
              </button>
            </div>
          </div>

          {/* 错误提示 */}
          {jsonError ? (
            <div style={{ marginTop: '12px', padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#dc2626', fontSize: '12.5px' }}>
              ⚠️ {jsonError}
            </div>
          ) : null}

          {/* 编辑模式 */}
          {editorTab === 'json-edit' ? (
            <div style={{ marginTop: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  支持配置 <code>command</code>, <code>args</code>, <code>env</code>, <code>tools</code>, <code>boundAssistants</code>
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    style={{ fontSize: '12px', padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', cursor: 'pointer' }}
                    onClick={handleFormatJson}
                  >
                    ✨ 格式化 JSON
                  </button>
                  <button
                    type="button"
                    style={{ fontSize: '12px', padding: '4px 12px', border: 'none', borderRadius: '6px', background: '#165dff', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
                    onClick={handleSaveCurrentMcp}
                  >
                    💾 保存该 MCP
                  </button>
                </div>
              </div>

              <textarea
                value={jsonTextDraft}
                onChange={(e) => {
                  setJsonTextDraft(e.target.value);
                  setJsonError(null);
                }}
                spellCheck={false}
                style={{
                  width: '100%',
                  height: '380px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  padding: '14px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                }}
              />
            </div>
          ) : (
            /* 预览模式：结构化解析展示 */
            <div style={{ marginTop: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '14px' }}>
                <div style={{ padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>运行命令 (Command)</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', marginTop: '2px', fontFamily: 'monospace' }}>
                    {currentMcp.command} {(currentMcp.args || []).join(' ')}
                  </div>
                </div>

                <div style={{ padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>连接通道 & 延迟</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#16a34a', marginTop: '2px' }}>
                    ● {currentMcp.transport ?? 'stdio'} 通道 ({currentMcp.latencyMs ?? 20}ms)
                  </div>
                </div>
              </div>

              {/* 暴露的工具列表 */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  暴露的 MCP 工具清单 ({currentMcp.tools.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {currentMcp.tools.map((tool) => (
                    <span key={tool} style={{ padding: '3px 8px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '12px', color: '#1d4ed8', fontFamily: 'monospace' }}>
                      ⚡ {tool}
                    </span>
                  ))}
                </div>
              </div>

              {/* 代码只读视图 */}
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  原始 JSON 配置视图
                </div>
                <pre style={{
                  margin: 0,
                  background: '#0f172a',
                  color: '#e2e8f0',
                  padding: '14px',
                  borderRadius: '8px',
                  fontSize: '12.5px',
                  fontFamily: 'ui-monospace, monospace',
                  overflowX: 'auto',
                  maxHeight: '260px',
                  lineHeight: 1.5,
                }}>
                  {currentMcp.rawJson}
                </pre>
              </div>
            </div>
          )}

          {/* 智能体快速授权绑定区 */}
          <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <strong style={{ fontSize: '13px', color: '#0f172a' }}>已授权使用此 MCP 的智能体</strong>
              <span style={{ fontSize: '11px', color: '#64748b' }}>点击标签一键切换绑定状态</span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {(assistants.length > 0 ? assistants.map((a) => a.name) : ['雷霆战机总导师', '动手学动能定理总导师', '代码向导与答辩导师', '原理教练', '评审导师']).map((asstName) => {
                const isBound = currentMcp.boundAssistants.includes(asstName);
                return (
                  <button
                    key={asstName}
                    type="button"
                    onClick={() => toggleAssistantBinding(asstName)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      background: isBound ? '#165dff' : '#f1f5f9',
                      color: isBound ? '#ffffff' : '#475569',
                      border: isBound ? '1px solid #165dff' : '1px solid #cbd5e1',
                      fontWeight: isBound ? 600 : 400,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    {isBound ? '✓' : '+'} {asstName}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 模块二：内置工具（图像生成与沙箱）卡片，严格对应 AdminUI/工具.png 视觉 */}
      <div style={{ marginTop: '20px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <strong style={{ fontSize: '15px', color: '#0f172a' }}>内置工具 (Builtin Tools)</strong>
            <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#64748b' }}>
              配置 MCP 服务器与内置工具（如图像生成与代码沙箱）。图像生成需先在“模型”页配置支持图像的模型后才能启用。
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* 图像生成 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>图像生成 (ImageGen)</strong>
                <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: '#e0e7ff', color: '#4338ca', fontWeight: 600 }}>平台原生</span>
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                图像模型：暂无可用本地图像模型，<a href="/settings/models" style={{ color: '#165dff', textDecoration: 'none' }}>前往配置 ⓘ</a>
              </div>
            </div>

            <label style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px' }}>
              <input
                type="checkbox"
                checked={imageGenEnabled}
                onChange={(e) => setImageGenEnabled(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: 'absolute',
                  cursor: 'pointer',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: imageGenEnabled ? '#165dff' : '#cbd5e1',
                  transition: '.3s',
                  borderRadius: '22px',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    content: '""',
                    height: '16px',
                    width: '16px',
                    left: imageGenEnabled ? '21px' : '3px',
                    bottom: '3px',
                    backgroundColor: 'white',
                    transition: '.3s',
                    borderRadius: '50%',
                  }}
                />
              </span>
            </label>
          </div>

          {/* Python 代码沙箱 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>Python 运行沙箱 (Sandbox)</strong>
                <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: '#ecfdf5', color: '#047857', fontWeight: 600 }}>安全隔离</span>
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                用于学生代码执行、物理公式数值仿真与游戏逻辑运行测试。
              </div>
            </div>

            <label style={{ position: 'relative', display: 'inline-block', width: '40px', height: '22px' }}>
              <input
                type="checkbox"
                checked={sandboxEnabled}
                onChange={(e) => setSandboxEnabled(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: 'absolute',
                  cursor: 'pointer',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: sandboxEnabled ? '#165dff' : '#cbd5e1',
                  transition: '.3s',
                  borderRadius: '22px',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    content: '""',
                    height: '16px',
                    width: '16px',
                    left: sandboxEnabled ? '21px' : '3px',
                    bottom: '3px',
                    backgroundColor: 'white',
                    transition: '.3s',
                    borderRadius: '50%',
                  }}
                />
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
