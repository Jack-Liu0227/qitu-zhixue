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
  runtimePayloadExample: Record<string, unknown>;
  invocationRule: string;
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
    invocationRule: '当学生在工程实践阶段点击「运行测试」或触发 TheoryMastered 门禁评估时同步阻塞调用。',
    parametersSchema: {
      targetFps: { type: 'number', default: 60, description: '期望运行基准帧率' },
      maxMemoryMb: { type: 'number', default: 256, description: '沙箱内分配的最大虚拟内存 (MB)' },
      strictCollisionCheck: { type: 'boolean', default: true, description: '是否要求必须包含 AABB 或 Sprite.collide_rect 判定' },
      timeoutSec: { type: 'number', default: 10, description: '自动化运行沙箱评测超时时限 (秒)' },
    },
    runtimePayloadExample: {
      hook: 'project.evaluator.gate',
      projectId: 'proj-thunder-2026',
      studentId: 'student-302',
      currentPhase: 'phase-3-code',
      gateId: 'TheoryMastered-AABB',
      codeFiles: [
        { path: 'main.py', sizeBytes: 2420, checksum: 'sha256:7b9c...' },
        { path: 'bullet.py', sizeBytes: 1140, checksum: 'sha256:3a1f...' },
      ],
      runtimeOptions: { headless: true, captureScreenshots: true },
    },
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
    invocationRule: '当学生进入「动手学动能定理」工作台时，前端宿主容器自动装载并双向通信。',
    parametersSchema: {
      gravityConstant: { type: 'number', default: 9.8, description: '仿真环境重力加速度 g (m/s²)' },
      frictionCoefficient: { type: 'number', default: 0.05, description: '轨道动摩擦因数 μ' },
      sampleRateHz: { type: 'number', default: 100, description: '数据采样率与曲线刷新频率 (Hz)' },
      allowSliderTuning: { type: 'boolean', default: true, description: '是否允许学生在界面上自由拖拽小车质量与初速度' },
    },
    runtimePayloadExample: {
      hook: 'ui.panel.extension',
      panelPosition: 'workbench-dock-right',
      studentId: 'student-302',
      activeFormula: 'W = \\Delta E_k = \\frac{1}{2}mv_2^2 - \\frac{1}{2}mv_1^2',
      sessionContext: {
        carMassKg: 0.5,
        appliedForceN: 2.0,
        distanceM: 1.2,
      },
      permissions: ['read:canvas', 'emit:dataset-change'],
    },
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
    invocationRule: '在模型生成流 (LLM Stream) 经过 Agent SDK 管道输出前毫秒级正则与语义拦截。',
    parametersSchema: {
      maxDirectCodeLines: { type: 'number', default: 5, description: '允许模型一次性展示的最大代码行数阈值' },
      enforceQuestionEnding: { type: 'boolean', default: true, description: '是否强制模型回复必须以启发式反问句结尾' },
      blockSolutionKeywords: {
        type: 'array',
        default: ['完整实现如下', '直接复制这串代码', '标准答案是'],
        description: '禁用的直白教学话术黑名单',
      },
    },
    runtimePayloadExample: {
      hook: 'tutor.prompt.augment',
      assistantRole: '原理教练 (Coach)',
      studentGradeLevel: '八年级',
      currentStagePrompt: '引导推导 AABB 包围盒公式，不得直接给出代码',
      userQuery: '老师，我不知道怎么判断子弹打中敌机，直接把碰撞代码给我吧',
      injectedGuidance: '【系统护栏注入】：学生请求直接代码，必须拒绝并反问其敌机与子弹矩形重叠的几何条件。',
    },
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
    invocationRule: '学生在对话输入框点击麦克风时，向 Agent 运行时注入 voice_transcribe 与 voice_speak 工具。',
    parametersSchema: {
      asrProvider: { type: 'string', default: 'sense-voice', description: '语音识别引擎提供商' },
      ttsVoice: { type: 'string', default: 'zh-CN-YunyangNeural', description: '导师默认朗读音色' },
      autoPlayAudio: { type: 'boolean', default: false, description: '回复生成后是否自动播放合成音频' },
    },
    runtimePayloadExample: {
      hook: 'tool.executor.register',
      toolName: 'voice_transcribe_and_synth',
      audioCodec: 'opus',
      sampleRate: 16000,
      clientCapability: { webAudioSupported: true },
    },
  },
];

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
];

export default function PluginsSettingsPage() {
  const [plugins, setPlugins] = useState<PluginItem[]>(REGISTERED_PLUGINS);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installPackageName, setInstallPackageName] = useState('');

  const [editingPlugin, setEditingPlugin] = useState<PluginItem | null>(null);
  const [previewingPlugin, setPreviewingPlugin] = useState<PluginItem | null>(null);

  const togglePlugin = (id: string) => {
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    );
  };

  const handleDeletePlugin = (id: string, name: string) => {
    if (!window.confirm(`确定要彻底卸载并删除插件「${name}」吗？`)) return;
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
    const newPlugin: PluginItem = {
      id: `plugin-${Date.now()}`,
      name: installPackageName.trim(),
      version: '1.0.0',
      author: '第三方开发者',
      description: '由外部 npm 包安装的运行时扩展插件。',
      hookPoint: 'tool.executor.register',
      enabled: true,
      boundScope: '雷霆战机小游戏 PBL 导师团队',
      invocationRule: '由 Agent SDK 运行时在相应调用链中动态拦截调用。',
      parametersSchema: {
        timeoutMs: { type: 'number', default: 5000, description: '插件执行超时时限' },
        enabledLogging: { type: 'boolean', default: true, description: '是否输出执行 Trace 日志' },
      },
      runtimePayloadExample: {
        hook: 'tool.executor.register',
        pluginName: installPackageName.trim(),
        timestamp: Date.now(),
      },
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

      {/* 扩展点规范说明卡片 */}
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
                  <span className="admin-template-info-label">生效团队:</span>
                  <span className="admin-template-info-val">👥 {plugin.boundScope}</span>
                </div>
                <div className="admin-template-info-row">
                  <span className="admin-template-info-label">版本 / 作者:</span>
                  <span className="admin-template-info-val">
                    v{plugin.version} · {plugin.author}
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
                  {plugin.enabled ? '● 插件已就绪' : '○ 插件已停用'}
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    className="settings-action-btn"
                    style={{ fontSize: '12px', padding: '4px 8px' }}
                    onClick={() => setPreviewingPlugin(plugin)}
                    title="查看参数定义与运行时 Payload 预览"
                  >
                    🔍 参数与 Payload 预览
                  </button>
                  <button
                    type="button"
                    className="admin-skill-dot-btn"
                    onClick={() => setEditingPlugin({ ...plugin })}
                    title="编辑插件配置"
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

      {/* 参数与运行时 Payload 预览抽屉/弹窗 */}
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
              <div style={{ marginBottom: '16px', background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>⚙️ 插件调度与参数传递机制：</strong>
                <p style={{ fontSize: '12px', color: '#475569', margin: '4px 0 0', lineHeight: 1.5 }}>
                  {previewingPlugin.invocationRule}
                </p>
              </div>

              {/* 参数定义 Schema */}
              <div style={{ marginBottom: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '14px', color: '#0f172a' }}>1. 参数配置项 (Parameters Schema)</strong>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>支持在控制台调整生效阈值</span>
                </div>
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
              </div>

              {/* 运行时 Payload 预览 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '14px', color: '#0f172a' }}>2. 触发扩展钩子时的上下文 Payload 示例 (Runtime Payload)</strong>
                  <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>● 真实接入格式</span>
                </div>
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
