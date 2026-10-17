'use client';

import { useState } from 'react';

export interface PluginItem {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  hookPoint: 'tutor.prompt.augment' | 'tool.executor.register' | 'project.evaluator.gate' | 'ui.panel.extension';
  enabled: boolean;
  boundScope: string;
  parametersSchema: Record<string, { type: string; default: unknown; description: string }>;
  runtimePayloadExample: Record<string, unknown> | null;
  invocationRule: string;
}

/**
 * 钩子机制的说明文档（纯文档文案，不代表任何已注册数据）。
 */
const HOOK_DOCS = [
  {
    hook: 'tutor.prompt.augment',
    name: '导师 Prompt 动态增强',
    desc: '在导师智能体每次推理前动态注入外部知识、学情画像或防透题安全护栏。',
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
] as const;

const HOOK_OPTIONS: { value: PluginItem['hookPoint']; label: string }[] = [
  { value: 'tutor.prompt.augment', label: 'tutor.prompt.augment · 导师 Prompt 动态增强' },
  { value: 'tool.executor.register', label: 'tool.executor.register · 沙箱与 MCP 工具注册' },
  { value: 'project.evaluator.gate', label: 'project.evaluator.gate · PBL 自动化门禁裁决' },
  { value: 'ui.panel.extension', label: 'ui.panel.extension · 工作台前端扩展画板' },
];

function emptyPlugin(name: string, hookPoint: PluginItem['hookPoint']): PluginItem {
  return {
    id: `plugin-local-${Date.now()}`,
    name,
    version: '未知',
    author: '未知（待插件上报）',
    description: '',
    hookPoint,
    enabled: false,
    boundScope: '未指定',
    invocationRule: '',
    parametersSchema: {},
    runtimePayloadExample: null,
  };
}

export default function PluginsSettingsPage() {
  // 平台尚无插件注册表后端；此列表只承载管理员在本页手动登记的本地草稿。
  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installPackageName, setInstallPackageName] = useState('');
  const [installHookPoint, setInstallHookPoint] = useState<PluginItem['hookPoint']>('tool.executor.register');

  const [editingPlugin, setEditingPlugin] = useState<PluginItem | null>(null);
  const [previewingPlugin, setPreviewingPlugin] = useState<PluginItem | null>(null);

  const togglePlugin = (id: string) => {
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    );
  };

  const handleDeletePlugin = (id: string, name: string) => {
    if (!window.confirm(`确定要移除插件草稿「${name}」吗？`)) return;
    setPlugins((prev) => prev.filter((p) => p.id !== id));
    if (editingPlugin?.id === id) setEditingPlugin(null);
    if (previewingPlugin?.id === id) setPreviewingPlugin(null);
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
    const newPlugin = emptyPlugin(installPackageName.trim(), installHookPoint);
    setPlugins((prev) => [...prev, newPlugin]);
    setShowInstallModal(false);
    setInstallPackageName('');
    alert(
      `已在本页登记插件草稿「${newPlugin.name}」。\n` +
      '注意：平台尚未提供插件安装与注册的服务端接口，草稿仅保存在当前页面会话中，不会真正安装或持久化。'
    );
  };

  return (
    <div className="admin-settings-page">
      <div className="settings-pagehead">
        <div className="settings-titlebox">
          <h1>生态插件扩展 (Plugins)</h1>
          <div className="settings-desc">
            为启途智学平台提供高度模块化的能力拓展机制。通过 4 类标准扩展钩子（Extension Hooks）挂载第三方工具、评估门禁、仿真面板与参数流转。
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

      {/* 扩展点规范说明卡片（纯文档） */}
      <section className="admin-editor-card" style={{ marginBottom: '16px' }}>
        <div className="admin-editor-card-header">
          <span className="admin-editor-section-title">4 类标准扩展挂载点 (Extension Hooks 接入机制)</span>
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

      {/* 已登记插件列表 */}
      <section className="admin-assistants-group-section">
        <div className="admin-group-title-row">
          <span className="admin-group-bar" />
          <h2 className="admin-group-title">已登记的扩展插件</h2>
          <span className="admin-group-count">{plugins.length}</span>
        </div>

        {plugins.length === 0 ? (
          <div className="settings-empty" style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontSize: '13px', lineHeight: 1.8 }}>
            暂无插件记录。
            <br />
            插件的安装、注册与运行状态需要后端插件总线支撑；当前平台尚未提供该服务端接口。
            <br />
            你可以点击右上角「安装新插件」在本页登记插件草稿（仅当前会话可见，不会真正安装）。
          </div>
        ) : (
          <div className="admin-knowledge-cards-grid">
            {plugins.map((plugin) => (
              <div key={plugin.id} className="admin-knowledge-item-card">
                <div className="admin-knowledge-card-top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>🧩</span>
                    <strong className="admin-knowledge-card-title">{plugin.name}</strong>
                    <span
                      style={{ fontSize: '10.5px', padding: '1px 6px', borderRadius: '4px', background: '#fff7ed', color: '#c2410c', fontWeight: 600 }}
                      title="仅保存在当前页面会话中；插件注册需要后端支撑"
                    >
                      本地草稿
                    </span>
                  </div>
                  <div
                    className={`admin-toggle-switch${plugin.enabled ? ' is-on' : ''}`}
                    onClick={() => togglePlugin(plugin.id)}
                    title={plugin.enabled ? '已标记启用（本地草稿状态）' : '已标记停用（本地草稿状态）'}
                  >
                    <div className="admin-toggle-knob" />
                  </div>
                </div>

                <p className="admin-knowledge-card-summary">{plugin.description || '暂无描述（插件元数据需由插件上报）。'}</p>

                <div className="admin-template-info-list">
                  <div className="admin-template-info-row">
                    <span className="admin-template-info-label">挂载钩子:</span>
                    <code style={{ fontSize: '11px', color: '#165dff' }}>{plugin.hookPoint}</code>
                  </div>
                  <div className="admin-template-info-row">
                    <span className="admin-template-info-label">生效团队:</span>
                    <span className="admin-template-info-val">👥 {plugin.boundScope || '未指定'}</span>
                  </div>
                  <div className="admin-template-info-row">
                    <span className="admin-template-info-label">版本 / 作者:</span>
                    <span className="admin-template-info-val">
                      {plugin.version} · {plugin.author}
                    </span>
                  </div>
                </div>

                <div className="admin-knowledge-card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
                  <span
                    style={{
                      fontSize: '12px',
                      color: plugin.enabled ? '#00b42a' : '#86909c',
                      fontWeight: 600,
                    }}
                  >
                    {plugin.enabled ? '● 草稿已标记启用' : '○ 草稿已标记停用'}
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="settings-action-btn"
                      style={{ fontSize: '12px', padding: '4px 8px' }}
                      onClick={() => setPreviewingPlugin(plugin)}
                      title="查看参数定义与运行时 Payload（如已上报）"
                    >
                      🔍 参数与 Payload
                    </button>
                    <button
                      type="button"
                      className="admin-skill-dot-btn"
                      onClick={() => setEditingPlugin({ ...plugin })}
                      title="编辑插件草稿"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="admin-skill-dot-btn"
                      style={{ color: '#ef4444' }}
                      onClick={() => handleDeletePlugin(plugin.id, plugin.name)}
                      title="移除插件草稿"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 参数与运行时 Payload 预览弹窗 */}
      {previewingPlugin ? (
        <div className="admin-modal-overlay" onClick={() => setPreviewingPlugin(null)}>
          <div className="admin-modal-card" style={{ maxWidth: '780px', width: '90%' }} onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <div>
                <h3 style={{ margin: 0 }}>参数定义与运行时 Payload: {previewingPlugin.name}</h3>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  挂载点：<code style={{ color: '#165dff' }}>{previewingPlugin.hookPoint}</code>
                </span>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setPreviewingPlugin(null)}
              >
                ✕
              </button>
            </div>

            <div className="admin-modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {previewingPlugin.invocationRule ? (
                <div style={{ marginBottom: '16px', background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <strong style={{ fontSize: '13px', color: '#0f172a' }}>⚙️ 插件调度与参数传递机制：</strong>
                  <p style={{ fontSize: '12px', color: '#475569', margin: '4px 0 0', lineHeight: 1.5 }}>
                    {previewingPlugin.invocationRule}
                  </p>
                </div>
              ) : null}

              {/* 参数定义 Schema */}
              <div style={{ marginBottom: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '14px', color: '#0f172a' }}>1. 参数配置项 (Parameters Schema)</strong>
                </div>
                {Object.keys(previewingPlugin.parametersSchema).length === 0 ? (
                  <div style={{ padding: '16px', border: '1px dashed #cbd5e1', borderRadius: '8px', color: '#64748b', fontSize: '12.5px', textAlign: 'center' }}>
                    暂无参数定义。参数 Schema 应由插件在注册时上报，平台不会伪造示例。
                  </div>
                ) : (
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                      <thead style={{ background: '#f1f5f9', color: '#475569' }}>
                        <tr>
                          <th style={{ padding: '8px 12px' }}>参数名</th>
                          <th style={{ padding: '8px 12px' }}>类型</th>
                          <th style={{ padding: '8px 12px' }}>默认值</th>
                          <th style={{ padding: '8px 12px' }}>描述说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(previewingPlugin.parametersSchema).map(([key, def]) => (
                          <tr key={key} style={{ borderTop: '1px solid #e2e8f0' }}>
                            <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 600, color: '#0369a1' }}>{key}</td>
                            <td style={{ padding: '8px 12px', color: '#d97706' }}>{def.type}</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{JSON.stringify(def.default)}</td>
                            <td style={{ padding: '8px 12px', color: '#475569' }}>{def.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 运行时 Payload 预览 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '14px', color: '#0f172a' }}>2. 触发扩展钩子时的上下文 Payload (Runtime Payload)</strong>
                </div>
                {previewingPlugin.runtimePayloadExample ? (
                  <pre style={{
                    margin: 0,
                    background: '#0f172a',
                    color: '#e2e8f0',
                    padding: '14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    overflowX: 'auto',
                    lineHeight: 1.45,
                  }}>
                    {JSON.stringify(previewingPlugin.runtimePayloadExample, null, 2)}
                  </pre>
                ) : (
                  <div style={{ padding: '16px', border: '1px dashed #cbd5e1', borderRadius: '8px', color: '#64748b', fontSize: '12.5px', textAlign: 'center' }}>
                    暂无运行时 Payload。真实 Payload 需由插件总线在钩子触发时采集，平台不会伪造示例。
                  </div>
                )}
              </div>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={() => setPreviewingPlugin(null)}
              >
                关闭预览
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                <label className="admin-form-label">npm 包名 / 仓库地址</label>
                <input
                  className="admin-input-text"
                  value={installPackageName}
                  onChange={(e) => setInstallPackageName(e.target.value)}
                  placeholder="如：@qitu/plugin-unity-bridge"
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">目标挂载钩子</label>
                <select
                  className="admin-select"
                  value={installHookPoint}
                  onChange={(e) => setInstallHookPoint(e.target.value as PluginItem['hookPoint'])}
                >
                  {HOOK_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <p style={{ fontSize: '12px', color: '#b45309', margin: 0, lineHeight: 1.6 }}>
                需要后端支撑：插件拉取、注册与运行时钩子总线尚无服务端接口。
                提交后仅在当前页面登记为本地草稿，不会真正安装。
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
                登记为本地草稿
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
              <h3>编辑插件草稿: {editingPlugin.name}</h3>
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
                  setEditingPlugin(null);
                }}
              >
                🗑️ 移除草稿
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
