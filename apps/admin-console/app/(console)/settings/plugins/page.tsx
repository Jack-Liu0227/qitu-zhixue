'use client';

import { useState } from 'react';

interface PluginItem {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  hookPoint: 'tutor.prompt.augment' | 'tool.executor.register' | 'project.evaluator.gate' | 'ui.panel.extension';
  enabled: boolean;
  boundScope: string;
}

const REGISTERED_PLUGINS: PluginItem[] = [
  {
    id: 'plugin-pygame-evaluator',
    name: 'qitu-plugin-pygame-evaluator',
    version: '1.2.0',
    author: '启途开源社区',
    description: 'Pygame 运行态自动化评估器，支持检测学生游戏帧率、主循环结构与精灵碰撞事件流。',
    hookPoint: 'project.evaluator.gate',
    enabled: true,
    boundScope: '雷霆战机小游戏 PBL 导师团队',
  },
  {
    id: 'plugin-physics-simulator',
    name: 'qitu-plugin-physics-simulator',
    version: '1.0.4',
    author: '启途物理教研组',
    description: '二维运动学与动能数值模拟插件，在学生工作台右侧提供实时的力-位移与动能仿真面板。',
    hookPoint: 'ui.panel.extension',
    enabled: true,
    boundScope: '动手学动能定理 PBL 导师团队',
  },
  {
    id: 'plugin-socratic-guard',
    name: 'qitu-plugin-socratic-guard',
    version: '2.1.0',
    author: '启途 AI 安全中心',
    description: '苏格拉底教学法防透题护栏，实时拦截模型直接输出完整代码的违规行为，强制降级为启发提问。',
    hookPoint: 'tutor.prompt.augment',
    enabled: true,
    boundScope: '启途智学全平台通用',
  },
  {
    id: 'plugin-voice-tutor',
    name: 'qitu-plugin-voice-tutor',
    version: '0.9.2',
    author: '启途智能体实验室',
    description: '学生语音输入转写与多音色导师朗读通道，支持低延迟流式语音发问。',
    hookPoint: 'tool.executor.register',
    enabled: false,
    boundScope: '扩展实验功能',
  },
];

const HOOK_DOCS = [
  {
    hook: 'tutor.prompt.augment',
    name: '导师 Prompt 动态增强',
    desc: '在导师智能体每次推理前动态注入外部知识、学情画像或安全护栏约束。',
  },
  {
    hook: 'tool.executor.register',
    name: '沙箱与 MCP 工具注册',
    desc: '向 Agent SDK 运行时动态注册新的 MCP Client、命令行沙箱或外部 API 桥接器。',
  },
  {
    hook: 'project.evaluator.gate',
    name: 'PBL 自动化门禁裁决',
    desc: '在学生提交 TheoryMastered 或结项成果时，执行自定义的单元测试与逻辑验证脚本。',
  },
  {
    hook: 'ui.panel.extension',
    name: '工作台前端扩展画板',
    desc: '在学生端、教师端工作台嵌入自定义的 iframe、Canvas 仿真器或数据可视化挂件。',
  },
];

export default function PluginsSettingsPage() {
  const [plugins, setPlugins] = useState<PluginItem[]>(REGISTERED_PLUGINS);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installPackageName, setInstallPackageName] = useState('');

  const [editingPlugin, setEditingPlugin] = useState<PluginItem | null>(null);

  const togglePlugin = (id: string) => {
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    );
  };

  const handleDeletePlugin = (id: string, name: string) => {
    if (!window.confirm(`确定要彻底卸载并删除插件「${name}」吗？`)) return;
    setPlugins((prev) => prev.filter((p) => p.id !== id));
    if (editingPlugin?.id === id) setEditingPlugin(null);
  };

  const handleSaveEditPlugin = () => {
    if (!editingPlugin) return;
    setPlugins((prev) =>
      prev.map((p) => (p.id === editingPlugin.id ? { ...editingPlugin } : p))
    );
    setEditingPlugin(null);
  };

  const handleInstall = () => {
    if (!installPackageName.trim()) {
      alert('请输入 npm 包名或 GitHub 仓库地址');
      return;
    }
    const newPlugin: PluginItem = {
      id: `plugin-${Date.now()}`,
      name: installPackageName.trim(),
      version: '1.0.0',
      author: '第三方开发者',
      description: '由外部 npm 包安装的运行时扩展插件。',
      hookPoint: 'tool.executor.register',
      enabled: true,
      boundScope: '自定义团队',
    };
    setPlugins((prev) => [...prev, newPlugin]);
    setShowInstallModal(false);
    setInstallPackageName('');
    alert(`插件「${newPlugin.name}」安装成功并已注册至扩展总线！`);
  };

  return (
    <div className="admin-settings-page">
      <div className="settings-pagehead">
        <div className="settings-titlebox">
          <h1>生态插件扩展 (Plugins)</h1>
          <div className="settings-desc">
            为启途智学平台提供高度模块化的能力拓展机制。通过 4 类标准扩展钩子（Extension Hooks）挂载第三方工具、评估门禁与工作台面板。
          </div>
        </div>

        <div className="settings-page-actions">
          <button
            type="button"
            className="settings-action-btn is-primary"
            onClick={() => setShowInstallModal(true)}
          >
            + 安装新插件
          </button>
        </div>
      </div>

      {/* 扩展点规范说明卡片 */}
      <section className="admin-editor-card" style={{ marginBottom: '8px' }}>
        <div className="admin-editor-card-header">
          <span className="admin-editor-section-title">4 类标准扩展挂载点 (Extension Hooks)</span>
          <span className="admin-editor-tag is-green">标准化接入协议</span>
        </div>
        <div className="admin-plugins-hooks-grid">
          {HOOK_DOCS.map((doc) => (
            <div key={doc.hook} className="admin-hook-doc-card">
              <code className="admin-hook-badge">{doc.hook}</code>
              <strong className="admin-hook-title">{doc.name}</strong>
              <p className="admin-hook-desc">{doc.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 已安装插件列表 */}
      <section className="admin-assistants-group-section">
        <div className="admin-group-title-row">
          <span className="admin-group-bar" />
          <h2 className="admin-group-title">已安装的扩展插件</h2>
          <span className="admin-group-count">{plugins.length}</span>
        </div>

        <div className="admin-knowledge-cards-grid">
          {plugins.map((plugin) => (
            <div key={plugin.id} className="admin-knowledge-item-card">
              <div className="admin-knowledge-card-top">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '20px' }}>🧩</span>
                  <strong className="admin-knowledge-card-title">{plugin.name}</strong>
                </div>
                <div
                  className={`admin-toggle-switch${plugin.enabled ? ' is-on' : ''}`}
                  onClick={() => togglePlugin(plugin.id)}
                  title={plugin.enabled ? '已启用，点击停用' : '已停用，点击启用'}
                >
                  <div className="admin-toggle-knob" />
                </div>
              </div>

              <p className="admin-knowledge-card-summary">{plugin.description}</p>

              <div className="admin-template-info-list">
                <div className="admin-template-info-row">
                  <span className="admin-template-info-label">挂载钩子:</span>
                  <code style={{ fontSize: '11px', color: '#165dff' }}>{plugin.hookPoint}</code>
                </div>
                <div className="admin-template-info-row">
                  <span className="admin-template-info-label">生效范围:</span>
                  <span className="admin-template-info-val">👥 {plugin.boundScope}</span>
                </div>
                <div className="admin-template-info-row">
                  <span className="admin-template-info-label">版本 / 作者:</span>
                  <span className="admin-template-info-val">
                    v{plugin.version} · {plugin.author}
                  </span>
                </div>
              </div>

              <div className="admin-knowledge-card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: '12px',
                    color: plugin.enabled ? '#00b42a' : '#86909c',
                    fontWeight: 600,
                  }}
                >
                  {plugin.enabled ? '● 插件已就绪' : '○ 插件已停用'}
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    className="admin-skill-dot-btn"
                    onClick={() => setEditingPlugin({ ...plugin })}
                    title="编辑插件"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    className="admin-skill-dot-btn"
                    style={{ color: '#ef4444' }}
                    onClick={() => handleDeletePlugin(plugin.id, plugin.name)}
                    title="卸载并删除插件"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 安装插件弹窗 */}
      {showInstallModal ? (
        <div className="admin-modal-overlay" onClick={() => setShowInstallModal(false)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>安装新插件</h3>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setShowInstallModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-form-row">
                <label className="admin-form-label">npm 包名</label>
                <input
                  className="admin-input-text"
                  value={installPackageName}
                  onChange={(e) => setInstallPackageName(e.target.value)}
                  placeholder="如：@qitu/plugin-unity-bridge"
                />
              </div>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                系统将自动拉取插件元数据并注册其声明的 Extension Hooks。
              </p>
            </div>
            <div className="admin-modal-footer">
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => setShowInstallModal(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={handleInstall}
              >
                安装并注册
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 编辑插件弹窗 */}
      {editingPlugin ? (
        <div className="admin-modal-overlay" onClick={() => setEditingPlugin(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>编辑插件: {editingPlugin.name}</h3>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setEditingPlugin(null)}
              >
                ✕
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-form-row">
                <label className="admin-form-label">插件名称</label>
                <input
                  className="admin-input-text"
                  value={editingPlugin.name}
                  onChange={(e) => setEditingPlugin({ ...editingPlugin, name: e.target.value })}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">版本</label>
                <input
                  className="admin-input-text"
                  value={editingPlugin.version}
                  onChange={(e) => setEditingPlugin({ ...editingPlugin, version: e.target.value })}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">描述</label>
                <textarea
                  className="admin-input-text"
                  rows={3}
                  value={editingPlugin.description}
                  onChange={(e) => setEditingPlugin({ ...editingPlugin, description: e.target.value })}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">生效团队/范围</label>
                <input
                  className="admin-input-text"
                  value={editingPlugin.boundScope}
                  onChange={(e) => setEditingPlugin({ ...editingPlugin, boundScope: e.target.value })}
                />
              </div>
            </div>
            <div className="admin-modal-footer">
              <button
                type="button"
                className="settings-action-btn is-danger"
                style={{ marginRight: 'auto' }}
                onClick={() => {
                  handleDeletePlugin(editingPlugin.id, editingPlugin.name);
                }}
              >
                🗑️ 卸载删除
              </button>
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => setEditingPlugin(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={handleSaveEditPlugin}
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
