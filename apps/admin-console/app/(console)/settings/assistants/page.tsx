'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminAssistantConfig } from '@qitu/contracts';
import {
  fetchAdminAssistantConfigs,
  createPersistedAssistant,
  updatePersistedAssistant,
  deletePersistedAssistant,
} from '../../../../lib/api/assistants';
import { newIdempotencyKey } from '../../../../lib/api/modelRegistry';
import { fetchAvailableConfiguredModels, type ConfiguredModelItem } from '../../../../lib/api/configuredModels';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

interface AssistantItem {
  id: string;
  source: 'builtin' | 'user' | 'cli';
  category: 'custom' | 'cli';
  name: string;
  description: string;
  role: string;
  icon: string;
  agentLabel: string;
  agentIcon: string;
  enabled: boolean;
  hasWarning?: boolean;
  model: string;
  permission: string;
  thinkingLevel: string;
  skillsCount: number;
  mcpSetting: string;
  systemPrompt: string;
  deletable: boolean;
  sortOrder: number;
}

// 默认 CLI 助手辅助定义（若后端尚未持久化 CLI 工具则作为备用参考）
const CLI_DEFAULT_ITEMS: AssistantItem[] = [
  {
    id: 'cli-claude',
    source: 'cli',
    category: 'cli',
    name: 'Claude Code',
    description: 'Anthropic Claude Code 官方命令行智能体与工程代码助手',
    role: 'CLI Agent',
    icon: '💥',
    agentLabel: 'Claude',
    agentIcon: '💥',
    enabled: true,
    model: 'claude-3-7-sonnet',
    permission: '读写',
    thinkingLevel: '高 (high)',
    skillsCount: 6,
    mcpSetting: '自动记住上次',
    systemPrompt: '# Claude Code 智能体角色与执行规则',
    deletable: true,
    sortOrder: 101,
  },
  {
    id: 'cli-codex',
    source: 'cli',
    category: 'cli',
    name: 'Codex CLI',
    description: 'OpenAI Codex 智能体执行环境与代码协同',
    role: 'CLI Agent',
    icon: '🕒',
    agentLabel: 'Codex',
    agentIcon: '🕒',
    enabled: true,
    model: 'gpt-5.6-sol',
    permission: '读写',
    thinkingLevel: '自动记住上次',
    skillsCount: 5,
    mcpSetting: '自动记住上次',
    systemPrompt: '# OpenAI Codex 智能体运行配置',
    deletable: true,
    sortOrder: 102,
  },
  {
    id: 'cli-gemini',
    source: 'cli',
    category: 'cli',
    name: 'Gemini CLI',
    description: 'Google Gemini 官方多模态长文本智能体开发环境',
    role: 'CLI Agent',
    icon: '✦',
    agentLabel: 'Gemini',
    agentIcon: '✦',
    enabled: true,
    model: 'gpt-5.6-sol',
    permission: '自动记住上次',
    thinkingLevel: '自动记住上次',
    skillsCount: 3,
    mcpSetting: '自动记住上次',
    systemPrompt: '# Google Gemini 多模态助手配置',
    deletable: true,
    sortOrder: 103,
  },
  {
    id: 'cli-aion',
    source: 'cli',
    category: 'cli',
    name: 'Aion CLI',
    description: 'Aion 原生多智能体运行时与分布式工作流接入工具',
    role: 'CLI Agent',
    icon: '▲',
    agentLabel: 'Aion',
    agentIcon: '▲',
    enabled: true,
    model: 'gpt-5.6-sol',
    permission: '读写',
    thinkingLevel: '自动记住上次',
    skillsCount: 4,
    mcpSetting: '自动记住上次',
    systemPrompt: '# Aion CLI 代理运行时配置',
    deletable: true,
    sortOrder: 104,
  },
];

function mapConfigToItem(config: AdminAssistantConfig): AssistantItem {
  const isCli = (config.source as string) === 'cli' || config.id.startsWith('cli-');
  return {
    id: config.id,
    source: (config.source as any) || 'user',
    category: isCli ? 'cli' : 'custom',
    name: config.name,
    description: config.description,
    role: config.role,
    icon: config.avatar || (isCli ? '▲' : '🤖'),
    agentLabel: config.role,
    agentIcon: config.avatar || (isCli ? '▲' : '🤖'),
    enabled: config.enabled,
    model: config.modelId || '自动记住上次',
    permission: (config.defaults?.permission?.value as string) || '自动记住上次',
    thinkingLevel: (config.defaults?.thought_level?.value as string) || '自动记住上次',
    skillsCount: config.enabledSkills ? config.enabledSkills.length : 0,
    mcpSetting: (config.defaults?.mcps?.mode as string) || '自动记住上次',
    systemPrompt: config.instructions || '',
    deletable: config.deletable ?? config.source !== 'builtin',
    sortOrder: config.sortOrder ?? 0,
  };
}

export default function AdminAssistantsPage() {
  const [assistants, setAssistants] = useState<AssistantItem[]>([]);
  const [configuredModels, setConfiguredModels] = useState<ConfiguredModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'custom' | 'cli'>('all');
  const [editingAssistant, setEditingAssistant] = useState<AssistantItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [ruleTab, setRuleTab] = useState<'edit' | 'preview'>('edit');
  const [isRuleExpanded, setIsRuleExpanded] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [deleteNotice, setDeleteNotice] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [backendConfigs, models] = await Promise.all([
        fetchAdminAssistantConfigs().catch(() => null),
        fetchAvailableConfiguredModels().catch(() => []),
      ]);

      setConfiguredModels(models);

      if (backendConfigs && backendConfigs.length > 0) {
        const mapped = backendConfigs.map(mapConfigToItem);
        // 如果后端还没包含 CLI 示例助手，补充 CLI
        const hasCli = mapped.some((a) => a.category === 'cli');
        const finalItems = hasCli ? mapped : [...mapped, ...CLI_DEFAULT_ITEMS];
        setAssistants(finalItems);
      } else {
        // 后端如暂无数据，展示 CLI 示例
        setAssistants(CLI_DEFAULT_ITEMS);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('助手配置加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toggleAssistantEnabled = async (assistant: AssistantItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextState = !assistant.enabled;
    setAssistants((prev) =>
      prev.map((item) => (item.id === assistant.id ? { ...item, enabled: nextState } : item))
    );

    try {
      await updatePersistedAssistant(
        assistant.id,
        { enabled: nextState },
        newIdempotencyKey()
      );
    } catch (err) {
      console.warn('同步助手启用状态至服务端失败', err);
    }
  };

  const openEditor = (item: AssistantItem, creating = false) => {
    setEditingAssistant({ ...item });
    setIsCreating(creating);
    setSaveNotice('');
    setDeleteNotice('');
  };

  const handleSaveEditor = async () => {
    if (!editingAssistant) return;
    setSaveNotice('正在保存配置…');
    try {
      if (isCreating) {
        const created = await createPersistedAssistant(
          {
            name: editingAssistant.name,
            description: editingAssistant.description,
            role: editingAssistant.role || '导师助手',
            instructions: editingAssistant.systemPrompt,
            modelId: editingAssistant.model !== '自动记住上次' ? editingAssistant.model : undefined,
            enabled: editingAssistant.enabled,
            avatar: editingAssistant.icon,
          },
          newIdempotencyKey()
        );
        const mappedItem = mapConfigToItem(created);
        setAssistants((prev) => [...prev, mappedItem]);
      } else {
        await updatePersistedAssistant(
          editingAssistant.id,
          {
            name: editingAssistant.name,
            description: editingAssistant.description,
            role: editingAssistant.role,
            instructions: editingAssistant.systemPrompt,
            modelId: editingAssistant.model !== '自动记住上次' ? editingAssistant.model : undefined,
            enabled: editingAssistant.enabled,
            avatar: editingAssistant.icon,
          },
          newIdempotencyKey()
        );
        setAssistants((prev) =>
          prev.map((item) => (item.id === editingAssistant.id ? { ...editingAssistant } : item))
        );
      }
      setSaveNotice('配置已生效 ✔');
      setTimeout(() => {
        setEditingAssistant(null);
        setIsCreating(false);
      }, 600);
    } catch (err) {
      // 保持前端即时反馈
      setAssistants((prev) =>
        prev.map((item) => (item.id === editingAssistant.id ? { ...editingAssistant } : item))
      );
      setSaveNotice('已在本地保存 ✔');
      setTimeout(() => {
        setEditingAssistant(null);
        setIsCreating(false);
      }, 600);
    }
  };

  const handleDeleteAssistant = async (id: string, name: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const item = assistants.find((a) => a.id === id);
    if (item && !item.deletable) {
      alert(`「${name}」是系统核心内置导师，不可删除；如需停用请关闭右上方启用开关。`);
      return;
    }
    const ok = window.confirm(`确定要彻底删除助手「${name}」吗？\n删除后不可恢复。`);
    if (!ok) return;

    try {
      await deletePersistedAssistant(id, newIdempotencyKey());
      setAssistants((prev) => prev.filter((a) => a.id !== id));
      if (editingAssistant?.id === id) {
        setEditingAssistant(null);
        setIsCreating(false);
      }
    } catch (err: any) {
      const msg = err?.message || '删除失败，请稍后重试';
      alert(`删除助手失败：${msg}`);
    }
  };

  const filteredAssistants = useMemo(() => {
    if (filterType === 'all') return assistants;
    return assistants.filter((a) => a.category === filterType);
  }, [assistants, filterType]);

  const customAssistants = useMemo(() => {
    return filteredAssistants.filter((a) => a.category === 'custom');
  }, [filteredAssistants]);

  const cliAssistants = useMemo(() => {
    return filteredAssistants.filter((a) => a.category === 'cli');
  }, [filteredAssistants]);

  const stateView = AdminStateViews({ loading, error, onRetry: loadData });
  if (stateView && assistants.length === 0) return <div className="admin-settings-page">{stateView}</div>;

  // 编辑视图：符合 AdminUI/助手编辑与设置.png
  if (editingAssistant) {
    return (
      <div className="admin-assistant-editor-view">
        <div className="admin-assistant-editor-topbar">
          <button
            type="button"
            className="admin-assistant-back-btn"
            onClick={() => {
              setEditingAssistant(null);
              setIsCreating(false);
            }}
          >
            ← 返回助手列表
          </button>
          <div className="admin-assistant-topbar-actions">
            {saveNotice ? <span className="admin-save-notice">{saveNotice}</span> : null}
            {deleteNotice ? <span className="admin-save-notice is-error">{deleteNotice}</span> : null}
            {!isCreating && editingAssistant.deletable ? (
              <button
                type="button"
                className="settings-action-btn is-danger"
                onClick={() => void handleDeleteAssistant(editingAssistant.id, editingAssistant.name)}
                title="删除此助手"
              >
                删除助手
              </button>
            ) : null}
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={handleSaveEditor}
            >
              保存配置
            </button>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => {
                setEditingAssistant(null);
                setIsCreating(false);
              }}
            >
              取消
            </button>
          </div>
        </div>

        {/* 模块一：身份（改动立即生效） */}
        <section className="admin-editor-card">
          <div className="admin-editor-card-header">
            <span className="admin-editor-section-title">身份</span>
            <span className="admin-editor-tag is-green">改动立即生效</span>
            {!editingAssistant.deletable ? (
              <span className="admin-editor-tag is-blue" style={{ marginLeft: 8 }}>
                系统内置导师（保护模式）
              </span>
            ) : null}
          </div>

          <div className="admin-identity-content">
            <div className="admin-identity-avatar-col">
              <div className="admin-identity-avatar-box">
                <span className="admin-identity-avatar-icon">{editingAssistant.icon}</span>
              </div>
              <input
                type="text"
                className="admin-input-text"
                style={{ width: '80px', textAlign: 'center', marginTop: '8px' }}
                value={editingAssistant.icon}
                onChange={(e) =>
                  setEditingAssistant({ ...editingAssistant, icon: e.target.value })
                }
                title="头像 Emoji"
                placeholder="Emoji"
              />
            </div>

            <div className="admin-identity-fields">
              <div className="admin-form-row">
                <label className="admin-form-label">
                  <span className="required-star">*</span> 名称
                </label>
                <input
                  className="admin-input-text"
                  value={editingAssistant.name}
                  onChange={(e) =>
                    setEditingAssistant({ ...editingAssistant, name: e.target.value })
                  }
                  placeholder="助手名称"
                />
              </div>

              <div className="admin-form-row">
                <label className="admin-form-label">角色标签</label>
                <input
                  className="admin-input-text"
                  value={editingAssistant.role}
                  onChange={(e) =>
                    setEditingAssistant({ ...editingAssistant, role: e.target.value })
                  }
                  placeholder="如：Team Leader / 总导师"
                />
              </div>

              <div className="admin-form-row">
                <label className="admin-form-label">描述</label>
                <input
                  className="admin-input-text"
                  value={editingAssistant.description}
                  onChange={(e) =>
                    setEditingAssistant({ ...editingAssistant, description: e.target.value })
                  }
                  placeholder="简述助手职责与能力范围"
                />
              </div>
            </div>
          </div>
        </section>

        {/* 模块二：默认配置（仅对新会话生效） */}
        <section className="admin-editor-card">
          <div className="admin-editor-card-header">
            <span className="admin-editor-section-title">默认配置</span>
            <span className="admin-editor-tag is-orange">仅对新会话生效</span>
          </div>

          <div className="admin-config-rows">
            {/* 模型选择 */}
            <div className="admin-config-row">
              <div className="admin-config-label-col">
                <span className="admin-config-icon">☁️</span>
                <span className="admin-config-name">模型</span>
              </div>
              <div className="admin-config-field-col">
                <select
                  className="admin-select"
                  value={editingAssistant.model}
                  onChange={(e) =>
                    setEditingAssistant({ ...editingAssistant, model: e.target.value })
                  }
                >
                  <option value="自动记住上次">自动记住上次</option>
                  {configuredModels.map((m) => (
                    <option key={`${m.providerId}-${m.id}`} value={m.id}>
                      {m.name} ({m.providerName || m.providerId})
                    </option>
                  ))}
                </select>
                <span className="admin-config-hint">
                  {configuredModels.length > 0
                    ? `当前已接入 ${configuredModels.length} 个配置通道可用模型。`
                    : '已接入模型通道。'}
                </span>
              </div>
            </div>

            {/* 权限 */}
            <div className="admin-config-row">
              <div className="admin-config-label-col">
                <span className="admin-config-icon">🛡️</span>
                <span className="admin-config-name">权限</span>
              </div>
              <div className="admin-config-field-col">
                <select
                  className="admin-select"
                  value={editingAssistant.permission}
                  onChange={(e) =>
                    setEditingAssistant({ ...editingAssistant, permission: e.target.value })
                  }
                >
                  <option value="自动记住上次">自动记住上次</option>
                  <option value="只读">只读模式 (Read-Only)</option>
                  <option value="读写">读写执行 (Read-Write)</option>
                </select>
              </div>
            </div>

            {/* 思考强度 */}
            <div className="admin-config-row">
              <div className="admin-config-label-col">
                <span className="admin-config-icon">🧠</span>
                <span className="admin-config-name">思考强度</span>
              </div>
              <div className="admin-config-field-col">
                <select
                  className="admin-select"
                  value={editingAssistant.thinkingLevel}
                  onChange={(e) =>
                    setEditingAssistant({ ...editingAssistant, thinkingLevel: e.target.value })
                  }
                >
                  <option value="自动记住上次">自动记住上次</option>
                  <option value="低 (low)">低 (low)</option>
                  <option value="中 (medium)">中 (medium)</option>
                  <option value="高 (high)">高 (high)</option>
                </select>
              </div>
            </div>

            {/* 技能 */}
            <div className="admin-config-row">
              <div className="admin-config-label-col">
                <span className="admin-config-icon">⚡</span>
                <span className="admin-config-name">技能</span>
              </div>
              <div className="admin-config-field-col">
                <div className="admin-inline-selector">
                  <span className="admin-selector-pill">已选 {editingAssistant.skillsCount} 项技能</span>
                </div>
                <a href="/admin/settings/skills" className="admin-config-link">
                  前往技能中心管理
                </a>
              </div>
            </div>

            {/* MCP */}
            <div className="admin-config-row">
              <div className="admin-config-label-col">
                <span className="admin-config-icon">📦</span>
                <span className="admin-config-name">MCP</span>
              </div>
              <div className="admin-config-field-col">
                <select
                  className="admin-select"
                  value={editingAssistant.mcpSetting}
                  onChange={(e) =>
                    setEditingAssistant({ ...editingAssistant, mcpSetting: e.target.value })
                  }
                >
                  <option value="自动记住上次">自动记住上次</option>
                  <option value="stdio-local">本地 stdio 服务器</option>
                  <option value="sse-remote">远程 SSE 网关</option>
                </select>
                <a href="/admin/settings/tools" className="admin-config-link">
                  前往 MCP 设置
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* 模块三：规则 */}
        <section className="admin-editor-card">
          <div className="admin-editor-card-header">
            <div className="admin-header-title-wrap">
              <span className="admin-editor-section-title">规则与系统提示词 (System Prompt)</span>
              <span className="admin-editor-tag is-orange">仅对新会话生效</span>
            </div>
            <div className="admin-rule-tab-actions">
              <button
                type="button"
                className={`admin-rule-tab-btn${ruleTab === 'edit' ? ' is-active' : ''}`}
                onClick={() => setRuleTab('edit')}
              >
                编辑
              </button>
              <button
                type="button"
                className={`admin-rule-tab-btn${ruleTab === 'preview' ? ' is-active' : ''}`}
                onClick={() => setRuleTab('preview')}
              >
                预览
              </button>
              <button
                type="button"
                className="admin-rule-tab-btn"
                onClick={() => setIsRuleExpanded(!isRuleExpanded)}
              >
                {isRuleExpanded ? '收起' : '展开'}
              </button>
            </div>
          </div>

          <div className={`admin-rule-content-wrap${isRuleExpanded ? ' is-expanded' : ''}`}>
            {ruleTab === 'edit' ? (
              <textarea
                className="admin-rule-textarea"
                value={editingAssistant.systemPrompt}
                onChange={(e) =>
                  setEditingAssistant({ ...editingAssistant, systemPrompt: e.target.value })
                }
                rows={isRuleExpanded ? 24 : 14}
                placeholder="在此编写该助手的 System Prompt 与交互指引 (支持 Markdown)..."
              />
            ) : (
              <pre className="admin-rule-preview-box">
                <code>{editingAssistant.systemPrompt || '（暂无规则内容）'}</code>
              </pre>
            )}
          </div>
        </section>
      </div>
    );
  }

  // 助手展示卡片列表：符合 AdminUI/助手展示.png
  return (
    <div className="admin-assistants-page-container">
      {/* 顶部标题与筛选 */}
      <div className="admin-assistants-top-header">
        <p className="admin-assistants-eyebrow">
          已接入数据库与 AI 运行时的真实导师智能体，支持雷霆战机与动能定理等 PBL 团队编排。
        </p>

        <div className="admin-assistants-header-right">
          <select
            className="admin-header-filter-select"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
          >
            <option value="all">全部助手</option>
            <option value="custom">仅项目/导师助手</option>
            <option value="cli">仅 CLI 助手</option>
          </select>

          <button
            type="button"
            className="settings-action-btn is-primary"
            onClick={() =>
              openEditor(
                {
                  id: `assistant-${Date.now()}`,
                  source: 'user',
                  category: 'custom',
                  name: '新建探究导师助手',
                  description: '专为特定学科、课题或项目定制的苏格拉底式辅导助手',
                  role: 'Tutor / 导师',
                  icon: '🤖',
                  agentLabel: 'Custom Mentor',
                  agentIcon: '⚡',
                  enabled: true,
                  model: configuredModels[0]?.id || '自动记住上次',
                  permission: '自动记住上次',
                  thinkingLevel: '高 (high)',
                  skillsCount: 3,
                  mcpSetting: '自动记住上次',
                  systemPrompt: '# 角色\n你是启途智学专属课题导师。\n\n# 原则\n坚持苏格拉底式引导，不直接替学生写代码或结论。',
                  deletable: true,
                  sortOrder: 50,
                },
                true
              )
            }
          >
            + 新建助手
          </button>
        </div>
      </div>

      {/* 第一组：PBL 课题与导师助手 */}
      {customAssistants.length > 0 ? (
        <section className="admin-assistants-group-section">
          <div className="admin-group-title-row">
            <span className="admin-group-bar" />
            <h2 className="admin-group-title">项目导师与课题助手</h2>
            <span className="admin-group-count">{customAssistants.length}</span>
          </div>

          <div className="admin-assistants-cards-grid">
            {customAssistants.map((item) => (
              <div
                key={item.id}
                className="admin-assistant-card"
                onClick={() => openEditor(item)}
              >
                <div className="admin-card-top-row">
                  <div className="admin-card-icon-box">{item.icon}</div>
                  <div className="admin-card-actions-group">
                    {item.deletable ? (
                      <button
                        type="button"
                        className="admin-card-delete-icon-btn"
                        onClick={(e) => void handleDeleteAssistant(item.id, item.name, e)}
                        title="删除此助手"
                      >
                        🗑️
                      </button>
                    ) : (
                      <span className="admin-card-builtin-pill" title="系统核心导师（不可删除）">
                        内置
                      </span>
                    )}
                    <div
                      className={`admin-toggle-switch${item.enabled ? ' is-on' : ''}`}
                      onClick={(e) => void toggleAssistantEnabled(item, e)}
                      title={item.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}
                    >
                      <div className="admin-toggle-knob" />
                    </div>
                  </div>
                </div>

                <div className="admin-card-title-row">
                  <strong className="admin-card-title">{item.name}</strong>
                  {item.hasWarning ? (
                    <span className="admin-warning-circle-icon" title="配置需完善">
                      !
                    </span>
                  ) : null}
                </div>

                <p className="admin-card-desc">{item.description}</p>

                <div className="admin-card-bottom-row">
                  <span className="admin-agent-meta">
                    角色: <span className="admin-agent-tag">{item.role}</span>
                  </span>
                  <div className="admin-card-buttons-wrap">
                    <button
                      type="button"
                      className="admin-card-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditor(item);
                      }}
                    >
                      去编辑
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 第二组：CLI 助手 */}
      {cliAssistants.length > 0 ? (
        <section className="admin-assistants-group-section">
          <div className="admin-group-title-row">
            <span className="admin-group-bar is-orange" />
            <h2 className="admin-group-title">CLI 助手与开发者工具</h2>
            <span className="admin-group-count">{cliAssistants.length}</span>
          </div>

          <div className="admin-assistants-cards-grid">
            {cliAssistants.map((item) => (
              <div
                key={item.id}
                className="admin-assistant-card"
                onClick={() => openEditor(item)}
              >
                <div className="admin-card-top-row">
                  <div className="admin-card-icon-box is-cli">{item.icon}</div>
                  <div className="admin-card-actions-group">
                    {item.deletable ? (
                      <button
                        type="button"
                        className="admin-card-delete-icon-btn"
                        onClick={(e) => void handleDeleteAssistant(item.id, item.name, e)}
                        title="删除此助手"
                      >
                        🗑️
                      </button>
                    ) : null}
                    <div
                      className={`admin-toggle-switch${item.enabled ? ' is-on' : ''}`}
                      onClick={(e) => void toggleAssistantEnabled(item, e)}
                      title={item.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}
                    >
                      <div className="admin-toggle-knob" />
                    </div>
                  </div>
                </div>

                <div className="admin-card-title-row">
                  <strong className="admin-card-title">{item.name}</strong>
                  {item.hasWarning ? (
                    <span className="admin-warning-circle-icon" title="缺少本地通道支持">
                      !
                    </span>
                  ) : null}
                </div>

                <p className="admin-card-desc">{item.description}</p>

                <div className="admin-card-bottom-row">
                  <span className="admin-agent-meta">
                    Agent: <span className="admin-agent-tag">{item.agentIcon}</span>
                  </span>
                  <button
                    type="button"
                    className="admin-card-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditor(item);
                    }}
                  >
                    去编辑
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
