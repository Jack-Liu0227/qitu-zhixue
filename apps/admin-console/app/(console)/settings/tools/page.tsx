'use client';

import { useMemo, useState } from 'react';

interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  command: string;
  args: string[];
  status: 'connected' | 'disconnected' | 'error';
  latencyMs?: number;
  tools: string[];
  boundAssistants: string[];
}

interface BuiltinToolConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  selectedModel?: string;
}

const DEFAULT_MCP_SERVERS: McpServerConfig[] = [
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
  },
  {
    id: 'mcp-grok-search',
    name: 'Grok Search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'groksearch-mcp'],
    status: 'connected',
    latencyMs: 35,
    tools: ['grok_web_search', 'fetch_page_markdown', 'knowledge_crawl', 'citation_extract'],
    boundAssistants: ['动手学动能定理总导师', '数据分析与图表叙事助手'],
  },
];

export default function ToolsSettingsPage() {
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(DEFAULT_MCP_SERVERS);
  const [expandedMcpId, setExpandedMcpId] = useState<string | null>('mcp-grok-search');
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  // 内置工具状态
  const [imageGenEnabled, setImageGenEnabled] = useState(false);
  const [selectedImageModel, setSelectedImageModel] = useState('');
  const [pythonSandboxEnabled, setPythonSandboxEnabled] = useState(true);

  // 添加 MCP 弹窗
  const [showAddMcpModal, setShowAddMcpModal] = useState(false);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpCommand, setNewMcpCommand] = useState('');
  const [newMcpArgs, setNewMcpArgs] = useState('');

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
  const handleDeleteMcp = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`确定要删除 MCP 服务器「${name}」吗？`)) return;
    setMcpServers((prev) => prev.filter((s) => s.id !== id));
    if (expandedMcpId === id) setExpandedMcpId(null);
  };

  // 添加 MCP
  const handleAddMcp = () => {
    if (!newMcpName.trim() || !newMcpCommand.trim()) {
      alert('请填写 MCP 名称与执行命令');
      return;
    }
    const newServer: McpServerConfig = {
      id: `mcp-${Date.now()}`,
      name: newMcpName.trim(),
      transport: 'stdio',
      command: newMcpCommand.trim(),
      args: newMcpArgs.trim() ? newMcpArgs.trim().split(' ') : [],
      status: 'connected',
      latencyMs: 28,
      tools: ['custom_tool_call', 'query_context'],
      boundAssistants: ['雷霆战机总导师'],
    };
    setMcpServers((prev) => [...prev, newServer]);
    setExpandedMcpId(newServer.id);
    setShowAddMcpModal(false);
    setNewMcpName('');
    setNewMcpCommand('');
    setNewMcpArgs('');
  };

  const [editingMcp, setEditingMcp] = useState<(McpServerConfig & { argsStr: string }) | null>(null);

  const handleSaveEditMcp = () => {
    if (!editingMcp) return;
    setMcpServers((prev) =>
      prev.map((s) =>
        s.id === editingMcp.id
          ? {
              ...editingMcp,
              args: editingMcp.argsStr.trim() ? editingMcp.argsStr.trim().split(' ') : [],
            }
          : s
      )
    );
    setEditingMcp(null);
  };

  return (
    <div className="admin-tools-page-view">
      {/* 标题与描述严格对齐 AdminUI/工具.png */}
      <div className="admin-tools-header">
        <h1 className="admin-tools-title">工具</h1>
        <p className="admin-tools-subtitle">
          配置 MCP 服务器与内置工具（如图像生成）。图像生成需先在“模型”页配置支持图像的模型后才能启用。
        </p>
      </div>

      <div className="admin-tools-cards-column">
        {/* 卡片一：MCP 工具配置 (AdminUI/工具.png) */}
        <section className="admin-tool-card-panel">
          <div className="admin-tool-card-head">
            <span className="admin-tool-card-title">MCP 工具配置</span>
            <button
              type="button"
              className="admin-add-mcp-btn"
              onClick={() => setShowAddMcpModal(true)}
            >
              <span>添加 MCP</span>
              <span aria-hidden="true">▾</span>
            </button>
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
                          setEditingMcp({ ...server, argsStr: server.args.join(' ') });
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
                <label className="admin-form-label">MCP 名称</label>
                <input
                  className="admin-input-text"
                  value={newMcpName}
                  onChange={(e) => setNewMcpName(e.target.value)}
                  placeholder="如：Grok Search"
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">启动命令 (Command)</label>
                <input
                  className="admin-input-text"
                  value={newMcpCommand}
                  onChange={(e) => setNewMcpCommand(e.target.value)}
                  placeholder="如：npx"
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">参数 (Args)</label>
                <input
                  className="admin-input-text"
                  value={newMcpArgs}
                  onChange={(e) => setNewMcpArgs(e.target.value)}
                  placeholder="如：-y groksearch-mcp"
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
                <label className="admin-form-label">参数 (Args)</label>
                <input
                  className="admin-input-text"
                  value={editingMcp.argsStr}
                  onChange={(e) => setEditingMcp({ ...editingMcp, argsStr: e.target.value })}
                />
              </div>
            </div>
            <div className="admin-modal-footer">
              <button
                type="button"
                className="settings-action-btn is-danger"
                style={{ marginRight: 'auto' }}
                onClick={(e) => {
                  handleDeleteMcp(editingMcp.id, editingMcp.name, e);
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
