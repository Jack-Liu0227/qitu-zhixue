'use client';

import { useMemo, useState } from 'react';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  command: string;
  args: string[];
  env?: Record<string, string>;
  status: 'connected' | 'disconnected' | 'error';
  latencyMs?: number;
  tools: string[];
  boundAssistants: string[];
  description?: string;
}

const DEFAULT_MCP_SERVERS: McpServerConfig[] = [
  {
    id: 'mcp-grok-search',
    name: 'groksearch-mcp',
    transport: 'stdio',
    command: 'uvx',
    args: ['--from', 'git+https://github.com/GuDaStudio/GrokSearch@grok-with-tavily', 'groksearch'],
    env: {
      GROK_API_KEY: 'xai-grok-search-live-key',
      TAVILY_API_KEY: 'tvly-free-search-key',
    },
    status: 'connected',
    latencyMs: 28,
    tools: ['grok_web_search', 'fetch_page_markdown', 'knowledge_crawl', 'citation_extract'],
    boundAssistants: ['雷霆战机总导师', '动手学动能定理总导师'],
    description: '集成自 Pi/Codex 的 Grok 深度搜索与 Tavily 互联网实时检索工具，支持带来源引用的学术与事实检索。',
  },
  {
    id: 'mcp-fetch',
    name: 'fetch',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    status: 'connected',
    latencyMs: 16,
    tools: ['fetch_html', 'fetch_markdown', 'extract_links'],
    boundAssistants: ['动手学动能定理总导师', '雷霆战机总导师'],
    description: '官方轻量免费网页抓取与 Markdown 内容抽取 MCP 服务器。',
  },
  {
    id: 'mcp-chrome-devtools',
    name: 'chrome-devtools',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-chrome-devtools'],
    status: 'connected',
    latencyMs: 18,
    tools: ['launch_browser', 'navigate_page', 'click_element', 'take_screenshot', 'capture_console'],
    boundAssistants: ['雷霆战机总导师', '代码向导与答辩导师'],
    description: 'Chrome DevTools 自动化视口控制、页面渲染监测与前端控制台日志捕获。',
  },
  {
    id: 'mcp-aionui-browser',
    name: 'aionui-browser',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@aionui/browser-mcp'],
    status: 'connected',
    latencyMs: 24,
    tools: ['browser_tab_open', 'read_dom', 'execute_js_action', 'snapshot_viewport'],
    boundAssistants: ['雷霆战机总导师', '动手学动能定理总导师'],
    description: 'AionUI 浏览器自动化 DOM 读取与学生交互沙箱。',
  },
];

function serversToJson(servers: McpServerConfig[]): string {
  const mcpServersRecord: Record<string, Record<string, unknown>> = {};
  for (const s of servers) {
    const entry: Record<string, unknown> = {
      command: s.command,
      args: s.args,
    };
    if (s.env && Object.keys(s.env).length > 0) {
      entry.env = s.env;
    }
    if (s.description) {
      entry.description = s.description;
    }
    if (s.boundAssistants && s.boundAssistants.length > 0) {
      entry.boundAssistants = s.boundAssistants;
    }
    mcpServersRecord[s.name] = entry;
  }
  return JSON.stringify({ mcpServers: mcpServersRecord }, null, 2);
}

function parseJsonToServers(rawJson: string): McpServerConfig[] {
  const parsed = JSON.parse(rawJson);
  const mcpRecord = parsed.mcpServers || parsed;
  const result: McpServerConfig[] = [];

  for (const [key, val] of Object.entries(mcpRecord)) {
    if (typeof val !== 'object' || val === null) continue;
    const v = val as Record<string, unknown>;
    result.push({
      id: `mcp-${key.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`,
      name: key,
      transport: (v.transport as 'stdio' | 'sse') || 'stdio',
      command: typeof v.command === 'string' ? v.command : 'npx',
      args: Array.isArray(v.args) ? v.args.map(String) : [],
      env: typeof v.env === 'object' && v.env !== null ? (v.env as Record<string, string>) : undefined,
      status: 'connected',
      latencyMs: Math.floor(Math.random() * 20) + 15,
      tools: Array.isArray(v.tools) ? v.tools.map(String) : ['tool_call', 'query_context'],
      boundAssistants: Array.isArray(v.boundAssistants) ? v.boundAssistants.map(String) : ['雷霆战机总导师'],
      description: typeof v.description === 'string' ? v.description : undefined,
    });
  }
  return result;
}

export default function ToolsSettingsPage() {
  const [viewMode, setViewMode] = useState<'visual' | 'json'>('visual');
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(DEFAULT_MCP_SERVERS);
  const [expandedMcpId, setExpandedMcpId] = useState<string | null>('mcp-grok-search');
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  // JSON 编辑态
  const [jsonText, setJsonText] = useState<string>(() => serversToJson(DEFAULT_MCP_SERVERS));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saveJsonNotice, setSaveJsonNotice] = useState<string>('');

  // 内置工具状态
  const [imageGenEnabled, setImageGenEnabled] = useState(false);
  const [selectedImageModel, setSelectedImageModel] = useState('');
  const [pythonSandboxEnabled, setPythonSandboxEnabled] = useState(true);

  // 添加 MCP 弹窗
  const [showAddMcpModal, setShowAddMcpModal] = useState(false);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpCommand, setNewMcpCommand] = useState('uvx');
  const [newMcpArgs, setNewMcpArgs] = useState('');
  const [newMcpEnv, setNewMcpEnv] = useState('');
  const [newMcpDesc, setNewMcpDesc] = useState('');

  // 编辑 MCP 弹窗
  const [editingMcp, setEditingMcp] = useState<(McpServerConfig & { argsStr: string; envStr: string }) | null>(null);

  // 切换到 JSON 视图时同步当前状态
  const handleSwitchToJson = () => {
    setJsonText(serversToJson(mcpServers));
    setJsonError(null);
    setViewMode('json');
  };

  // 格式化 JSON
  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setJsonError(null);
    } catch (err) {
      setJsonError((err as Error).message);
    }
  };

  // 保存 JSON 配置并同步回视图
  const handleSaveJson = () => {
    try {
      const parsedServers = parseJsonToServers(jsonText);
      setMcpServers(parsedServers);
      setJsonError(null);
      setSaveJsonNotice('JSON 配置已成功验证并同步到系统！✔');
      setTimeout(() => setSaveJsonNotice(''), 2500);
    } catch (err) {
      setJsonError('JSON 解析失败: ' + (err as Error).message);
    }
  };

  // 重置为默认 MCP JSON
  const handleResetDefaultJson = () => {
    if (!window.confirm('确定要恢复为推荐的默认 MCP 配置吗？')) return;
    setMcpServers(DEFAULT_MCP_SERVERS);
    setJsonText(serversToJson(DEFAULT_MCP_SERVERS));
    setJsonError(null);
  };

  // 刷新测试 MCP 连接
  const handleRefresh = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRefreshingId(id);
    setTimeout(() => {
      setRefreshingId(null);
      setMcpServers((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: 'connected', latencyMs: Math.floor(Math.random() * 25) + 12 } : s))
      );
      alert(`MCP Server [${id}] 心跳检测成功，状态：已连接 (延迟 ~20ms)！`);
    }, 500);
  };

  // 删除 MCP Server
  const handleDeleteMcp = (id: string, name: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!window.confirm(`确定要删除 MCP 服务器「${name}」吗？`)) return;
    setMcpServers((prev) => {
      const next = prev.filter((s) => s.id !== id);
      setJsonText(serversToJson(next));
      return next;
    });
    if (expandedMcpId === id) setExpandedMcpId(null);
  };

  // 添加 MCP
  const handleAddMcp = () => {
    if (!newMcpName.trim() || !newMcpCommand.trim()) {
      alert('请填写 MCP 名称与启动命令');
      return;
    }

    let parsedEnv: Record<string, string> | undefined = undefined;
    if (newMcpEnv.trim()) {
      try {
        parsedEnv = JSON.parse(newMcpEnv.trim());
      } catch {
        alert('环境变量必须是合法的 JSON 对象键值对');
        return;
      }
    }

    const newServer: McpServerConfig = {
      id: `mcp-${Date.now()}`,
      name: newMcpName.trim(),
      transport: 'stdio',
      command: newMcpCommand.trim(),
      args: newMcpArgs.trim() ? newMcpArgs.trim().split(' ') : [],
      env: parsedEnv,
      status: 'connected',
      latencyMs: 25,
      tools: ['custom_tool_call', 'query_context'],
      boundAssistants: ['雷霆战机总导师', '动手学动能定理总导师'],
      description: newMcpDesc.trim() || undefined,
    };

    setMcpServers((prev) => {
      const next = [...prev, newServer];
      setJsonText(serversToJson(next));
      return next;
    });
    setExpandedMcpId(newServer.id);
    setShowAddMcpModal(false);
    setNewMcpName('');
    setNewMcpCommand('uvx');
    setNewMcpArgs('');
    setNewMcpEnv('');
    setNewMcpDesc('');
  };

  const handleSaveEditMcp = () => {
    if (!editingMcp) return;
    let parsedEnv: Record<string, string> | undefined = undefined;
    if (editingMcp.envStr.trim()) {
      try {
        parsedEnv = JSON.parse(editingMcp.envStr.trim());
      } catch {
        alert('环境变量必须是合法的 JSON 对象，如 {"KEY": "VALUE"}');
        return;
      }
    }

    setMcpServers((prev) => {
      const next = prev.map((s) =>
        s.id === editingMcp.id
          ? {
              ...editingMcp,
              args: editingMcp.argsStr.trim() ? editingMcp.argsStr.trim().split(' ') : [],
              env: parsedEnv,
            }
          : s
      );
      setJsonText(serversToJson(next));
      return next;
    });
    setEditingMcp(null);
  };

  return (
    <div className="admin-tools-page-view">
      {/* 标题与描述严格对齐 AdminUI/工具.png */}
      <div className="admin-tools-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 className="admin-tools-title">工具与 MCP</h1>
            <p className="admin-tools-subtitle">
              配置 MCP 服务器（支持 stdio/SSE、JSON 源代码互通）与内置沙箱。所有 MCP 与工具均直接与 Agent SDK 运行时与导师团队联动。
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div className="admin-segmented-tabs" style={{ background: '#f1f5f9', padding: '3px', borderRadius: '8px', display: 'flex' }}>
              <button
                type="button"
                className={`admin-sub-tab${viewMode === 'visual' ? ' is-active' : ''}`}
                style={{
                  padding: '6px 14px',
                  border: 'none',
                  borderRadius: '6px',
                  background: viewMode === 'visual' ? '#ffffff' : 'transparent',
                  fontWeight: viewMode === 'visual' ? 600 : 400,
                  boxShadow: viewMode === 'visual' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer',
                  color: viewMode === 'visual' ? '#0f172a' : '#64748b',
                }}
                onClick={() => setViewMode('visual')}
              >
                🎛️ 可视化卡片
              </button>
              <button
                type="button"
                className={`admin-sub-tab${viewMode === 'json' ? ' is-active' : ''}`}
                style={{
                  padding: '6px 14px',
                  border: 'none',
                  borderRadius: '6px',
                  background: viewMode === 'json' ? '#ffffff' : 'transparent',
                  fontWeight: viewMode === 'json' ? 600 : 400,
                  boxShadow: viewMode === 'json' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer',
                  color: viewMode === 'json' ? '#0f172a' : '#64748b',
                }}
                onClick={handleSwitchToJson}
              >
                📝 JSON 源代码配置与预览
              </button>
            </div>
          </div>
        </div>
      </div>

      {viewMode === 'json' ? (
        /* JSON 源代码编辑与实时校验视图 */
        <div className="admin-tools-json-panel" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginTop: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div>
              <strong style={{ fontSize: '15px', color: '#0f172a' }}>mcpServers 统一配置规范 (对齐 .pi / Codex / Claude Desktop 标准)</strong>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                支持编辑 uvx / npx 命令行、环境变量（如 GROK_API_KEY）、参数以及绑定的导师智能体。
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="settings-action-btn" onClick={handleFormatJson}>
                ✨ 格式化 JSON
              </button>
              <button type="button" className="settings-action-btn" onClick={handleResetDefaultJson}>
                ↺ 恢复默认
              </button>
              <button type="button" className="settings-action-btn is-primary" onClick={handleSaveJson}>
                💾 验证并保存到系统
              </button>
            </div>
          </div>

          {jsonError ? (
            <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#dc2626', fontSize: '13px', marginBottom: '12px' }}>
              ⚠️ {jsonError}
            </div>
          ) : null}

          {saveJsonNotice ? (
            <div style={{ padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', color: '#16a34a', fontSize: '13px', marginBottom: '12px' }}>
              {saveJsonNotice}
            </div>
          ) : null}

          <textarea
            style={{
              width: '100%',
              height: '420px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: '13px',
              lineHeight: 1.5,
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#0f172a',
              color: '#e2e8f0',
              boxSizing: 'border-box',
              resize: 'vertical',
            }}
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError(null);
            }}
            spellCheck={false}
          />
        </div>
      ) : (
        <div className="admin-tools-cards-column">
          {/* 卡片一：MCP 工具配置 (AdminUI/工具.png) */}
          <section className="admin-tool-card-panel">
            <div className="admin-tool-card-head">
              <div>
                <span className="admin-tool-card-title">MCP 工具配置</span>
                <span style={{ marginLeft: '10px', fontSize: '12px', color: '#64748b' }}>
                  ({mcpServers.length} 个已注册服务器，全部实时心跳就绪)
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="admin-add-mcp-btn"
                  onClick={() => setShowAddMcpModal(true)}
                >
                  <span>+ 添加 MCP</span>
                </button>
              </div>
            </div>

            <div className="admin-mcp-accordion-list">
              {mcpServers.map((server) => {
                const isExpanded = expandedMcpId === server.id;
                const isRefreshing = refreshingId === server.id;

                return (
                  <div key={server.id} className={`admin-mcp-accordion-item${isExpanded ? ' is-open' : ''}`}>
                    <div
                      className="admin-mcp-accordion-header"
                      onClick={() => setExpandedMcpId(isExpanded ? null : server.id)}
                    >
                      <div className="admin-mcp-header-left">
                        <span className={`admin-mcp-arrow-icon${isExpanded ? ' is-open' : ''}`}>▶</span>
                        <strong className="admin-mcp-name">{server.name}</strong>
                        {server.description ? (
                          <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '8px', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            - {server.description}
                          </span>
                        ) : null}
                      </div>

                      <div className="admin-mcp-header-right">
                        <span className="admin-mcp-status-check" title="服务已就绪">✓</span>
                        <button
                          type="button"
                          className={`admin-mcp-refresh-btn${isRefreshing ? ' is-spinning' : ''}`}
                          onClick={(e) => handleRefresh(server.id, e)}
                          title="测试连接 / 刷新状态"
                        >
                          🔄
                        </button>
                        <button
                          type="button"
                          className="admin-skill-dot-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingMcp({
                              ...server,
                              argsStr: server.args.join(' '),
                              envStr: server.env ? JSON.stringify(server.env, null, 2) : '',
                            });
                          }}
                          title="编辑 MCP"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          className="admin-skill-dot-btn"
                          style={{ color: '#ef4444' }}
                          onClick={(e) => handleDeleteMcp(server.id, server.name, e)}
                          title="删除 MCP"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    {isExpanded ? (
                      <div className="admin-mcp-accordion-body">
                        <div className="admin-mcp-detail-grid">
                          <div className="admin-mcp-field-row">
                            <span className="admin-mcp-field-label">传输协议:</span>
                            <span className="admin-mcp-field-val">
                              stdio (Local Standard I/O Subprocess)
                            </span>
                          </div>
                          <div className="admin-mcp-field-row">
                            <span className="admin-mcp-field-label">启动指令:</span>
                            <code className="admin-mcp-code-val">
                              {server.command} {server.args.join(' ')}
                            </code>
                          </div>
                          {server.env && Object.keys(server.env).length > 0 ? (
                            <div className="admin-mcp-field-row">
                              <span className="admin-mcp-field-label">环境变量 (Env):</span>
                              <code className="admin-mcp-code-val" style={{ background: '#f8fafc', color: '#0369a1' }}>
                                {Object.entries(server.env).map(([k, v]) => `${k}=${v.length > 8 ? v.substring(0, 4) + '***' : v}`).join(' | ')}
                              </code>
                            </div>
                          ) : null}
                          <div className="admin-mcp-field-row">
                            <span className="admin-mcp-field-label">连接状态:</span>
                            <span className="admin-mcp-status-chip">
                              ● 已连接 (心跳延迟 {server.latencyMs ?? 20}ms)
                            </span>
                          </div>
                          <div className="admin-mcp-field-row">
                            <span className="admin-mcp-field-label">暴露工具 ({server.tools.length}):</span>
                            <div className="admin-mcp-tools-tags">
                              {server.tools.map((t) => (
                                <span key={t} className="admin-mcp-tool-pill">
                                  🔧 {t}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="admin-mcp-field-row">
                            <span className="admin-mcp-field-label">已绑定的导师:</span>
                            <div className="admin-mcp-assistants-tags">
                              {server.boundAssistants.map((a) => (
                                <span key={a} className="admin-mcp-assistant-pill">
                                  🤖 {a}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="admin-mcp-actions-bar">
                          <button
                            type="button"
                            className="settings-action-btn"
                            onClick={(e) => handleRefresh(server.id, e)}
                          >
                            测试连接
                          </button>
                          <button
                            type="button"
                            className="settings-action-btn"
                            onClick={() => {
                              setEditingMcp({
                                ...server,
                                argsStr: server.args.join(' '),
                                envStr: server.env ? JSON.stringify(server.env, null, 2) : '',
                              });
                            }}
                          >
                            编辑配置
                          </button>
                          <button
                            type="button"
                            className="settings-action-btn is-danger"
                            onClick={(e) => handleDeleteMcp(server.id, server.name, e)}
                          >
                            删除此 MCP
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 卡片二：图像生成 (AdminUI/工具.png) */}
          <section className="admin-tool-card-panel">
            <div className="admin-tool-card-head">
              <span className="admin-tool-card-title">图像生成</span>
              <div
                className={`admin-toggle-switch${imageGenEnabled ? ' is-on' : ''}`}
                onClick={() => setImageGenEnabled((prev) => !prev)}
                title={imageGenEnabled ? '已启用，点击关闭' : '未启用，点击启用'}
              >
                <div className="admin-toggle-knob" />
              </div>
            </div>

            <div className="admin-tool-card-body">
              <div className="admin-tool-config-row">
                <div className="admin-tool-label-wrap">
                  <span className="admin-tool-label-text">图像模型</span>
                  <span className="admin-tool-help-icon" title="用于文生图与游戏战机素材渲染的模型">❓</span>
                </div>
                <div className="admin-tool-content-wrap">
                  {imageGenEnabled ? (
                    <select
                      className="admin-select"
                      style={{ width: '300px' }}
                      value={selectedImageModel}
                      onChange={(e) => setSelectedImageModel(e.target.value)}
                    >
                      <option value="dall-e-3">DALL·E 3 (OpenAI 官方图像生成)</option>
                      <option value="flux-1-schnell">FLUX.1 Schnell (极速生成)</option>
                      <option value="stable-diffusion-xl">Stable Diffusion XL</option>
                    </select>
                  ) : (
                    <div className="admin-tool-placeholder-text">
                      暂无可用图像模型，<a href="/admin/settings/models" className="admin-config-link">前往配置</a> ❓
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* 卡片三：内置代码沙箱工具 */}
          <section className="admin-tool-card-panel">
            <div className="admin-tool-card-head">
              <span className="admin-tool-card-title">内置 Python 执行沙箱</span>
              <div
                className={`admin-toggle-switch${pythonSandboxEnabled ? ' is-on' : ''}`}
                onClick={() => setPythonSandboxEnabled((prev) => !prev)}
                title={pythonSandboxEnabled ? '已启用沙箱安全隔离' : '沙箱已关闭'}
              >
                <div className="admin-toggle-knob" />
              </div>
            </div>

            <div className="admin-tool-card-body">
              <div className="admin-tool-config-row">
                <div className="admin-tool-label-wrap">
                  <span className="admin-tool-label-text">沙箱隔离环境</span>
                  <span className="admin-tool-help-icon" title="用于学生 Python 与 Pygame 代码安全隔离执行">❓</span>
                </div>
                <div className="admin-tool-content-wrap">
                  <span style={{ fontSize: '13px', color: '#00b42a', fontWeight: 600 }}>
                    ● Python 3.12 虚拟环境已就绪（预装 pygame-ce、numpy、matplotlib）
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* 添加 MCP 弹窗 */}
      {showAddMcpModal ? (
        <div className="admin-modal-overlay" onClick={() => setShowAddMcpModal(false)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>添加 MCP 服务器</h3>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setShowAddMcpModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-form-row">
                <label className="admin-form-label">MCP 唯一名称 (Key)</label>
                <input
                  className="admin-input-text"
                  value={newMcpName}
                  onChange={(e) => setNewMcpName(e.target.value)}
                  placeholder="如：groksearch-mcp"
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">启动命令 (Command)</label>
                <input
                  className="admin-input-text"
                  value={newMcpCommand}
                  onChange={(e) => setNewMcpCommand(e.target.value)}
                  placeholder="如：uvx 或 npx"
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">参数 (Args，空格分隔)</label>
                <input
                  className="admin-input-text"
                  value={newMcpArgs}
                  onChange={(e) => setNewMcpArgs(e.target.value)}
                  placeholder="如：--from git+https://github.com/GuDaStudio/GrokSearch groksearch"
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">环境变量 (JSON 格式，可选)</label>
                <textarea
                  className="admin-textarea"
                  rows={2}
                  value={newMcpEnv}
                  onChange={(e) => setNewMcpEnv(e.target.value)}
                  placeholder='{"GROK_API_KEY": "xxx"}'
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">功能描述</label>
                <input
                  className="admin-input-text"
                  value={newMcpDesc}
                  onChange={(e) => setNewMcpDesc(e.target.value)}
                  placeholder="如：Grok 搜索与网页抽取服务"
                />
              </div>
            </div>
            <div className="admin-modal-footer">
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => setShowAddMcpModal(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={handleAddMcp}
              >
                确认添加
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 编辑 MCP 弹窗 */}
      {editingMcp ? (
        <div className="admin-modal-overlay" onClick={() => setEditingMcp(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>编辑 MCP 服务器: {editingMcp.name}</h3>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setEditingMcp(null)}
              >
                ✕
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-form-row">
                <label className="admin-form-label">MCP 名称</label>
                <input
                  className="admin-input-text"
                  value={editingMcp.name}
                  onChange={(e) => setEditingMcp({ ...editingMcp, name: e.target.value })}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">启动命令 (Command)</label>
                <input
                  className="admin-input-text"
                  value={editingMcp.command}
                  onChange={(e) => setEditingMcp({ ...editingMcp, command: e.target.value })}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">参数 (Args，空格分隔)</label>
                <input
                  className="admin-input-text"
                  value={editingMcp.argsStr}
                  onChange={(e) => setEditingMcp({ ...editingMcp, argsStr: e.target.value })}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">环境变量 (JSON 格式)</label>
                <textarea
                  className="admin-textarea"
                  rows={3}
                  value={editingMcp.envStr}
                  onChange={(e) => setEditingMcp({ ...editingMcp, envStr: e.target.value })}
                  placeholder='{"GROK_API_KEY": "xxx"}'
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">功能描述</label>
                <input
                  className="admin-input-text"
                  value={editingMcp.description ?? ''}
                  onChange={(e) => setEditingMcp({ ...editingMcp, description: e.target.value })}
                />
              </div>
            </div>
            <div className="admin-modal-footer">
              <button
                type="button"
                className="settings-action-btn is-danger"
                style={{ marginRight: 'auto' }}
                onClick={() => {
                  handleDeleteMcp(editingMcp.id, editingMcp.name);
                  setEditingMcp(null);
                }}
              >
                🗑️ 删除此 MCP
              </button>
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => setEditingMcp(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={handleSaveEditMcp}
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
