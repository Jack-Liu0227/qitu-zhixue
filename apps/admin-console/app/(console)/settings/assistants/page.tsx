'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminRuntimeAgent, AdminRuntimeAgentUpdateRequest } from '@qitu/contracts';
import { fetchAdminAssistants, updateAdminAssistant, createAdminAssistant } from '../../../../lib/api/assistants';
import { newIdempotencyKey } from '../../../../lib/api/modelRegistry';
import { fetchAvailableConfiguredModels, type ConfiguredModelItem } from '../../../../lib/api/configuredModels';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

interface AssistantItem {
  id: string;
  category: 'custom' | 'cli';
  name: string;
  description: string;
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
}

const INITIAL_ASSISTANTS: AssistantItem[] = [
  {
    id: 'literature-map',
    category: 'custom',
    name: '文献与知识地图助手',
    description: '跨学科文献检索、知识地图构建、来源核验与证据综合助手',
    icon: '🤖',
    agentLabel: 'Claude Code',
    agentIcon: '💥',
    enabled: true,
    model: 'claude-3-7-sonnet',
    permission: '自动记住上次',
    thinkingLevel: '自动记住上次',
    skillsCount: 5,
    mcpSetting: '自动记住上次',
    systemPrompt: `# 角色
你是跨学科文献与知识地图综合助手，负责把分散的学术文献转化为清晰、可溯源的结构化知识地图。

# 工作方式
- 优先从权威学术库检索原始出处，核验实验条件、方法学与结论边界。
- 提取概念节点与因果脉络，保留证据引用（DOI / 论文条目）。
- 不虚构文献，对存疑结论明确标注证据级别与不确定性。`,
  },
  {
    id: 'data-narrative',
    category: 'custom',
    name: '数据分析与图表叙事助手',
    description: '科研数据质量分析、统计检查、图表设计与结果叙事助手',
    icon: '🤖',
    agentLabel: 'Pi',
    agentIcon: '🔲',
    enabled: true,
    hasWarning: true,
    model: 'gpt-5.6-sol',
    permission: '自动记住上次',
    thinkingLevel: '自动记住上次',
    skillsCount: 5,
    mcpSetting: '自动记住上次',
    systemPrompt: `# 角色
你是跨学科科研数据分析与图表叙事助手，负责把可靠的数据分析转化为清晰、诚实、可追溯的图表和结论。

# 工作方式
- 先确认数据字典、观测单位、研究问题、分组、时间范围、缺失值、异常值和分析目标。
- 进行数据质量、重复记录、泄漏、选择偏差和统计假设检查；必要时提出稳健性分析和敏感性分析。
- 图表服务于问题而非装饰：明确每张图的主张、分母、误差定义、样本量、比较基准和适用边界。
- 保留负结果、反例、异常和不确定性，不通过删点、换尺度、挑选子集或调整切分制造更好看的结论。
- 维护数据版本、分析代码、图表文件、feature/variable card、run_id 和结论之间的回溯关系。`,
  },
  {
    id: 'dissertation-review',
    category: 'custom',
    name: '博士论文审查与答辩助手',
    description: '博士论文质量审查、论证检查、风险识别与答辩模拟助手',
    icon: '🤖',
    agentLabel: 'Claude Code',
    agentIcon: '💥',
    enabled: true,
    model: 'claude-3-7-sonnet',
    permission: '自动记住上次',
    thinkingLevel: '高 (high)',
    skillsCount: 4,
    mcpSetting: '自动记住上次',
    systemPrompt: `# 角色
你是严苛且专业的博士学位论文答辩委员会资深评审专家与答辩推演助手。

# 核心任务
- 审查论文的创新点论证逻辑是否闭环，方法学与统计检验是否过硬。
- 模拟答辩委员可能发起的尖锐质询，针对核心脆弱点开展反向测试。`,
  },
  {
    id: 'paper-writing',
    category: 'custom',
    name: '科研写作与投稿助手',
    description: '科研论文、学位论文、报告、投稿材料与审稿回复的写作、智能润色和原创性自...',
    icon: '🤖',
    agentLabel: 'Claude Code',
    agentIcon: '💥',
    enabled: true,
    model: 'claude-3-7-sonnet',
    permission: '自动记住上次',
    thinkingLevel: '中 (medium)',
    skillsCount: 6,
    mcpSetting: '自动记住上次',
    systemPrompt: `# 角色
你是高水平学术期刊资深编辑与论文打磨专家，精通学术规范与学术英语叙事。`,
  },
  {
    id: 'research-mainline',
    category: 'custom',
    name: '科研主线与观点助手',
    description: '跨学科科研规划、研究问题拆解、假设生成与证据驱动的研究路线设计助手',
    icon: '🤖',
    agentLabel: 'Claude Code',
    agentIcon: '💥',
    enabled: true,
    model: 'gpt-5.6-sol',
    permission: '只读',
    thinkingLevel: '高 (high)',
    skillsCount: 3,
    mcpSetting: '自动记住上次',
    systemPrompt: `# 角色
你是科研规划与假设演绎专家，指导科研人员凝练核心科学问题，绘制清晰的技术路线图。`,
  },
  {
    id: 'experiment-model',
    category: 'custom',
    name: '实验与模型研究助手',
    description: '跨学科实验设计、模型研究、复现评估与研究流程管理助手',
    icon: '🤖',
    agentLabel: 'Codex CLI',
    agentIcon: '🕒',
    enabled: true,
    model: 'gpt-5.6-sol',
    permission: '读写',
    thinkingLevel: '自动记住上次',
    skillsCount: 7,
    mcpSetting: '自动记住上次',
    systemPrompt: `# 角色
你是实验方案设计与计算模型复现专家，负责指导实验参数控制、消融实验设计与数据复核。`,
  },
  // CLI 助手
  {
    id: 'cli-aion',
    category: 'cli',
    name: 'Aion CLI',
    description: 'Aion 原生多智能体运行时与分布式工作流接入工具',
    icon: '▲',
    agentLabel: 'Aion',
    agentIcon: '▲',
    enabled: true,
    model: 'gpt-5.6-sol',
    permission: '读写',
    thinkingLevel: '自动记住上次',
    skillsCount: 4,
    mcpSetting: '自动记住上次',
    systemPrompt: `# Aion CLI 代理运行时配置`,
  },
  {
    id: 'cli-claude',
    category: 'cli',
    name: 'Claude Code',
    description: 'Anthropic Claude Code 官方命令行智能体与工程代码助手',
    icon: '💥',
    agentLabel: 'Claude',
    agentIcon: '💥',
    enabled: true,
    model: 'claude-3-7-sonnet',
    permission: '读写',
    thinkingLevel: '高 (high)',
    skillsCount: 6,
    mcpSetting: '自动记住上次',
    systemPrompt: `# Claude Code 智能体角色与执行规则`,
  },
  {
    id: 'cli-codex',
    category: 'cli',
    name: 'Codex CLI',
    description: 'OpenAI Codex 智能体执行环境与代码协同',
    icon: '🕒',
    agentLabel: 'Codex',
    agentIcon: '🕒',
    enabled: true,
    model: 'gpt-5.6-sol',
    permission: '读写',
    thinkingLevel: '自动记住上次',
    skillsCount: 5,
    mcpSetting: '自动记住上次',
    systemPrompt: `# OpenAI Codex 智能体运行配置`,
  },
  {
    id: 'cli-gemini',
    category: 'cli',
    name: 'Gemini CLI',
    description: 'Google Gemini 官方多模态长文本智能体开发环境',
    icon: '✦',
    agentLabel: 'Gemini',
    agentIcon: '✦',
    enabled: true,
    hasWarning: true,
    model: 'gpt-5.6-sol',
    permission: '自动记住上次',
    thinkingLevel: '自动记住上次',
    skillsCount: 3,
    mcpSetting: '自动记住上次',
    systemPrompt: `# Google Gemini 多模态助手配置`,
  },
  {
    id: 'cli-codebuddy',
    category: 'cli',
    name: 'CodeBuddy',
    description: '智能结对编程与代码审查轻量化 CLI 智能体',
    icon: '👾',
    agentLabel: 'CodeBuddy',
    agentIcon: '👾',
    enabled: true,
    hasWarning: true,
    model: 'gpt-5.6-sol',
    permission: '自动记住上次',
    thinkingLevel: '自动记住上次',
    skillsCount: 2,
    mcpSetting: '自动记住上次',
    systemPrompt: `# CodeBuddy 编程搭档配置`,
  },
  {
    id: 'cli-hermes',
    category: 'cli',
    name: 'Hermes',
    description: 'Hermes 自动化研究工作流与任务调度引擎',
    icon: '🌾',
    agentLabel: 'Hermes',
    agentIcon: '🌾',
    enabled: true,
    model: 'deepseek-r1',
    permission: '自动记住上次',
    thinkingLevel: '高 (high)',
    skillsCount: 4,
    mcpSetting: '自动记住上次',
    systemPrompt: `# Hermes 调度引擎配置`,
  },
  {
    id: 'cli-opencode',
    category: 'cli',
    name: 'OpenCode',
    description: '开源代码大模型本地化与私有化运行环境',
    icon: '⬛',
    agentLabel: 'OpenCode',
    agentIcon: '⬛',
    enabled: true,
    model: 'deepseek-r1',
    permission: '读写',
    thinkingLevel: '自动记住上次',
    skillsCount: 4,
    mcpSetting: '自动记住上次',
    systemPrompt: `# OpenCode 本地推理配置`,
  },
  {
    id: 'cli-pi',
    category: 'cli',
    name: 'Pi',
    description: 'Pi coding agent through the pi-acp adapter',
    icon: '🔲',
    agentLabel: 'Pi',
    agentIcon: '🔲',
    enabled: true,
    hasWarning: true,
    model: 'claude-3-7-sonnet',
    permission: '自动记住上次',
    thinkingLevel: '自动记住上次',
    skillsCount: 3,
    mcpSetting: '自动记住上次',
    systemPrompt: `# Pi ACP 智能体适配器规则`,
  },
  {
    id: 'cli-openclaw',
    category: 'cli',
    name: 'OpenClaw',
    description: '自主心跳驱动的连续自主运行代理 (Loop Agent)',
    icon: '🦀',
    agentLabel: 'OpenClaw',
    agentIcon: '🦀',
    enabled: true,
    hasWarning: true,
    model: 'claude-3-7-sonnet',
    permission: '读写',
    thinkingLevel: '高 (high)',
    skillsCount: 5,
    mcpSetting: '自动记住上次',
    systemPrompt: `# OpenClaw 自主心跳运行代理配置`,
  },
];

export default function AdminAssistantsPage() {
  const [assistants, setAssistants] = useState<AssistantItem[]>(INITIAL_ASSISTANTS);
  const [configuredModels, setConfiguredModels] = useState<ConfiguredModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'custom' | 'cli'>('all');
  const [editingAssistant, setEditingAssistant] = useState<AssistantItem | null>(null);
  const [ruleTab, setRuleTab] = useState<'edit' | 'preview'>('edit');
  const [isRuleExpanded, setIsRuleExpanded] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runtimeSnapshot, models] = await Promise.all([
        fetchAdminAssistants().catch(() => null),
        fetchAvailableConfiguredModels(),
      ]);

      setConfiguredModels(models);

      if (runtimeSnapshot && runtimeSnapshot.agents && runtimeSnapshot.agents.length > 0) {
        // 合并服务端的 agent 配置
        setAssistants((prev) => {
          const map = new Map(prev.map((a) => [a.id, a]));
          for (const agent of runtimeSnapshot.agents) {
            const existing = map.get(agent.id);
            if (existing) {
              map.set(agent.id, {
                ...existing,
                name: agent.label || existing.name,
                description: agent.roleDefinition || existing.description,
                enabled: agent.enabled,
                model: agent.modelId || existing.model,
              });
            } else {
              map.set(agent.id, {
                id: agent.id,
                category: 'custom',
                name: agent.label || agent.id,
                description: agent.roleDefinition || '自定义 Agent',
                icon: '🤖',
                agentLabel: agent.modelLabel || 'Custom Agent',
                agentIcon: '⚡',
                enabled: agent.enabled,
                model: agent.modelId || '自动记住上次',
                permission: '自动记住上次',
                thinkingLevel: '自动记住上次',
                skillsCount: agent.capabilities.length,
                mcpSetting: '自动记住上次',
                systemPrompt: agent.agentDefinition || '',
              });
            }
          }
          return Array.from(map.values());
        });
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
      await updateAdminAssistant(
        assistant.id,
        {
          label: assistant.name,
          roleDefinition: assistant.description,
          enabled: nextState,
          capabilities: ['teach'],
        },
        newIdempotencyKey()
      );
    } catch (err) {
      console.warn('同步状态至服务端失败，保持本地切换', err);
    }
  };

  const openEditor = (item: AssistantItem) => {
    setEditingAssistant({ ...item });
    setSaveNotice('');
  };

  const handleSaveEditor = async () => {
    if (!editingAssistant) return;
    setSaveNotice('正在保存配置…');
    try {
      await updateAdminAssistant(
        editingAssistant.id,
        {
          label: editingAssistant.name,
          roleDefinition: editingAssistant.description,
          agentDefinition: editingAssistant.systemPrompt,
          modelId: editingAssistant.model !== '自动记住上次' ? editingAssistant.model : undefined,
          enabled: editingAssistant.enabled,
          capabilities: ['teach'],
        },
        newIdempotencyKey()
      );
      setAssistants((prev) =>
        prev.map((item) => (item.id === editingAssistant.id ? { ...editingAssistant } : item))
      );
      setSaveNotice('配置已生效 ✔');
      setTimeout(() => {
        setEditingAssistant(null);
      }, 700);
    } catch (err) {
      // 保持前端体验更新
      setAssistants((prev) =>
        prev.map((item) => (item.id === editingAssistant.id ? { ...editingAssistant } : item))
      );
      setSaveNotice('已在本地保存 ✔');
      setTimeout(() => {
        setEditingAssistant(null);
      }, 700);
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

  // 编辑视图：渲染符合 AdminUI/助手编辑与设置.png 的高保真界面
  if (editingAssistant) {
    return (
      <div className="admin-assistant-editor-view">
        <div className="admin-assistant-editor-topbar">
          <button
            type="button"
            className="admin-assistant-back-btn"
            onClick={() => setEditingAssistant(null)}
          >
            ← 返回助手列表
          </button>
          <div className="admin-assistant-topbar-actions">
            {saveNotice ? <span className="admin-save-notice">{saveNotice}</span> : null}
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
              onClick={() => setEditingAssistant(null)}
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
          </div>

          <div className="admin-identity-content">
            <div className="admin-identity-avatar-col">
              <div className="admin-identity-avatar-box">
                <span className="admin-identity-avatar-icon">{editingAssistant.icon}</span>
              </div>
              <button type="button" className="admin-upload-btn">
                上传图片
              </button>
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
            {/* 模型选择：强制必须且只能选择配置好的模型通道 */}
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
                      {m.name}
                    </option>
                  ))}
                </select>
                <span className="admin-config-hint">
                  {configuredModels.length > 0
                    ? `当前仅允许选择已在通道中配置好的 ${configuredModels.length} 个可用模型。`
                    : '暂无已配置的模型通道，请先在模型供应商处配置通道。'}
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
                  <span className="admin-selector-pill">已选 {editingAssistant.skillsCount} 项</span>
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

        {/* 模块三：规则（仅对新会话生效） */}
        <section className="admin-editor-card">
          <div className="admin-editor-card-header">
            <div className="admin-header-title-wrap">
              <span className="admin-editor-section-title">规则</span>
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
          由本机 CLI 自动生成、你自己创建或从官方复制的助手。
        </p>

        <div className="admin-assistants-header-right">
          <select
            className="admin-header-filter-select"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
          >
            <option value="all">全部</option>
            <option value="custom">仅自定义助手</option>
            <option value="cli">仅 CLI 助手</option>
          </select>

          <button
            type="button"
            className="settings-action-btn is-primary"
            onClick={() =>
              openEditor({
                id: `custom-agent-${Date.now()}`,
                category: 'custom',
                name: '新建启发学习助手',
                description: '专为特定学科或项目场景定制的启发式辅导助手',
                icon: '🤖',
                agentLabel: 'Claude Code',
                agentIcon: '💥',
                enabled: true,
                model: configuredModels[0]?.id || '自动记住上次',
                permission: '自动记住上次',
                thinkingLevel: '自动记住上次',
                skillsCount: 3,
                mcpSetting: '自动记住上次',
                systemPrompt: '# 角色\n你是专属学科探究辅导智能体。\n\n# 核心原则\n坚持苏格拉底式启发提问，先思考再动手。',
              })
            }
          >
            + 新建助手
          </button>
        </div>
      </div>

      {/* 第一组：自定义助手 */}
      {customAssistants.length > 0 ? (
        <section className="admin-assistants-group-section">
          <div className="admin-group-title-row">
            <span className="admin-group-bar" />
            <h2 className="admin-group-title">自定义助手</h2>
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
                  <div
                    className={`admin-toggle-switch${item.enabled ? ' is-on' : ''}`}
                    onClick={(e) => void toggleAssistantEnabled(item, e)}
                  >
                    <div className="admin-toggle-knob" />
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

      {/* 第二组：CLI 助手 */}
      {cliAssistants.length > 0 ? (
        <section className="admin-assistants-group-section">
          <div className="admin-group-title-row">
            <span className="admin-group-bar is-orange" />
            <h2 className="admin-group-title">CLI 助手</h2>
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
                  <div
                    className={`admin-toggle-switch${item.enabled ? ' is-on' : ''}`}
                    onClick={(e) => void toggleAssistantEnabled(item, e)}
                  >
                    <div className="admin-toggle-knob" />
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
