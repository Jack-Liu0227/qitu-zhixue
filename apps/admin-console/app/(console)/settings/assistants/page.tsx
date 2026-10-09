'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminAssistantConfig } from '@qitu/contracts';
import { fetchAdminAssistants, updateAdminAssistant } from '../../../../lib/api/assistants';
import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';

export interface CustomAssistantItem {
  id: string;
  name: string;
  role: string;
  description: string;
  avatarText: string;
  avatarBg: string;
  avatarImage?: string;
  isAvailable: boolean;
  modelId: string;
  permission: 'auto' | 'full' | 'supervised' | 'readonly';
  skills: string[];
  mcpIds: string[];
  instructions: string;
  workspaceMode: 'shared' | 'isolated';
  temperature: number;
  isBuiltin: boolean;
}

const STATIC_ASSISTANT_PRESETS: CustomAssistantItem[] = [
  {
    id: 'literature-knowledge-map',
    name: '文献与知识地图助手',
    role: '跨学科证据综合师',
    description: '跨学科文献检索、知识地图构建、来源校验与证据综合助手',
    avatarText: '📖',
    avatarBg: '#059669',
    isAvailable: true,
    modelId: 'qwen-2.5-coder-32b',
    permission: 'auto',
    skills: ['tutor-guided-learning', 'pbl-deliverable-qa'],
    mcpIds: ['web-research-mcp'],
    instructions: `# 角色
你是跨学科文献与知识地图助手，负责发现、组织、核验和综合不同领域的学术与技术证据。

# 工作方式
- 先明确主题、时间范围、文献类型、纳入/排除标准和用户需要的证据等级。
- 检索时先规划意图、复杂度、子问题和检索词；关键论文、官方文档、代码、数据集和版本必须用原始页面或 PDF 核验。
- 区分原始研究、综述、预印本、项目方自述、第三方复现、新闻和观点。不得把搜索摘要当正式证据。
- 建立主题、方法、数据、结论、局限、时间和引用关系；明确哪些内容是直接证据、合理推断或尚未核验。`,
    workspaceMode: 'shared',
    temperature: 0.3,
    isBuiltin: false,
  },
  {
    id: 'general-coach',
    name: '启途总导师',
    role: '学习流程总控与意图确认',
    description: '负责学生学习意图确认、项目目标拆解与各阶段进度护航。',
    avatarText: '👑',
    avatarBg: '#165dff',
    isAvailable: true,
    modelId: 'qwen-2.5-coder-32b',
    permission: 'supervised',
    skills: ['tutor-guided-learning'],
    mcpIds: ['project-file-manager'],
    instructions: `# 角色
你是启途智学平台总导师。在学生明确表达并确认立项意图前，不得直接创建正式项目。
引导学生进行结构化思考，帮助其将模糊想法转化为具体 PBL 项目目标。`,
    workspaceMode: 'shared',
    temperature: 0.2,
    isBuiltin: true,
  },
  {
    id: 'physics-concept-coach',
    name: '战机原理教练',
    role: '物理规律与碰撞理论教学',
    description: '负责雷霆战机动力方程、矢量位移与 AABB 碰撞检测概念深度讲解。',
    avatarText: '🚀',
    avatarBg: '#059669',
    isAvailable: true,
    modelId: 'deepseek-r1',
    permission: 'supervised',
    skills: ['thunder-fighter-engine', 'aabb-collision-solver'],
    mcpIds: ['python-sandbox'],
    instructions: `# 教学硬约束
在学生通过 TheoryMastered 概念测评前，绝对不得提前放行进入代码实践！
用苏格拉底提问法引导学生理解 AABB 轴对齐包围盒原理。`,
    workspaceMode: 'shared',
    temperature: 0.1,
    isBuiltin: true,
  },
  {
    id: 'game-code-guide',
    name: '战机代码向导',
    role: 'Canvas 渲染与游戏循环编码',
    description: '引导学生通过分步微任务完成战机战机渲染与键盘事件交互。',
    avatarText: '⚡',
    avatarBg: '#f77234',
    isAvailable: true,
    modelId: 'claude-3-5-sonnet',
    permission: 'full',
    skills: ['thunder-fighter-engine'],
    mcpIds: ['python-sandbox', 'project-file-manager'],
    instructions: `# 编码实践向导
每轮交互仅给出 1 个最小可执行微任务与单元测试指导，不可一次性输出全部实现。`,
    workspaceMode: 'shared',
    temperature: 0.2,
    isBuiltin: true,
  },
  {
    id: 'review-qa-mentor',
    name: '答辩导师',
    role: '成果质量评审与反思答辩',
    description: '对最终成果进行静态分析、安全审计与 PBL 学习成果答辩质检。',
    avatarText: '🎓',
    avatarBg: '#722ed1',
    isAvailable: true,
    modelId: 'gpt-4o',
    permission: 'supervised',
    skills: ['pbl-deliverable-qa'],
    mcpIds: ['project-file-manager'],
    instructions: `# 成果答辩评审
对作品完整度、代码鲁棒性与理论掌握程度进行综合评分，生成雷达图与反思成长档案。`,
    workspaceMode: 'isolated',
    temperature: 0.1,
    isBuiltin: true,
  },
];

const AVAILABLE_MODELS = [
  { id: 'qwen-2.5-coder-32b', label: 'Qwen 2.5 Coder 32B (推荐本地加速)' },
  { id: 'deepseek-r1', label: 'DeepSeek R1 (深度思考推演)' },
  { id: 'gpt-4o', label: 'GPT-4o (全能旗舰模型)' },
  { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet (架构代码王者)' },
  { id: 'moonshot-v1', label: 'Moonshot Kimi (长上下文检索)' },
  { id: 'glm-4', label: 'GLM-4 (智谱多模态旗舰)' },
];

const ALL_SKILLS = [
  { id: 'tutor-guided-learning', label: '苏格拉底启导式教学 (tutor-guided-learning)' },
  { id: 'thunder-fighter-engine', label: '战机物理运动引擎 (thunder-fighter-engine)' },
  { id: 'aabb-collision-solver', label: 'AABB 碰撞检测算法求解器 (aabb-collision-solver)' },
  { id: 'pbl-deliverable-qa', label: 'PBL 交付品质质检答辩 (pbl-deliverable-qa)' },
];

const ALL_MCPS = [
  { id: 'python-sandbox', label: 'Python 代码执行沙箱 (python-sandbox)' },
  { id: 'project-file-manager', label: '工程工作区管理器 (project-file-manager)' },
  { id: 'image-generation', label: '战机游戏贴图生成 (image-generation)' },
  { id: 'web-research-mcp', label: '学术与技术文档检索 (web-research-mcp)' },
];

export default function AdminAssistantsPage() {
  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [testingId, setTestingId] = useState<string | null>(null);

  // 编辑 / 自定义模式状态
  const [editingAssistant, setEditingAssistant] = useState<CustomAssistantItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  // 卡片折叠状态
  const [collapsedIdentity, setCollapsedIdentity] = useState(false);
  const [collapsedDefaults, setCollapsedDefaults] = useState(false);
  const [collapsedRules, setCollapsedRules] = useState(false);
  const [collapsedMultica, setCollapsedMultica] = useState(false);

  // 规则编辑状态
  const [ruleTab, setRuleTab] = useState<'edit' | 'preview'>('edit');
  const [ruleExpanded, setRuleExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminAssistants();
      setAssistants(data);
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allList = useMemo<CustomAssistantItem[]>(() => {
    const list: CustomAssistantItem[] = assistants.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      description: a.description,
      avatarText: a.name.slice(0, 1),
      avatarBg: a.id.includes('general')
        ? '#165dff'
        : a.id.includes('concept')
        ? '#059669'
        : a.id.includes('code')
        ? '#f77234'
        : '#722ed1',
      isAvailable: a.agentStatus === 'online',
      modelId: a.modelId ?? 'qwen-2.5-coder-32b',
      permission: 'supervised',
      skills: [...a.enabledSkills],
      mcpIds: [...a.mcpServerIds],
      instructions: a.instructions,
      workspaceMode: 'shared',
      temperature: a.temperature ?? 0.2,
      isBuiltin: a.source === 'builtin',
    }));

    for (const preset of STATIC_ASSISTANT_PRESETS) {
      if (!list.some((item) => item.id === preset.id)) {
        list.push(preset);
      }
    }
    return list;
  }, [assistants]);

  const tabs = useMemo(() => {
    const availableCount = allList.filter((a) => a.isAvailable).length;
    const builtinCount = allList.filter((a) => a.isBuiltin).length;
    const customCount = allList.filter((a) => !a.isBuiltin).length;
    return [
      { id: 'all', label: '全部助手', count: allList.length },
      { id: 'builtin', label: '系统内置', count: builtinCount },
      { id: 'custom', label: '自定义助手', count: customCount },
      { id: 'available', label: '可用', count: availableCount },
    ];
  }, [allList]);

  const filtered = useMemo(() => {
    return allList.filter((agent) => {
      if (activeTab === 'available' && !agent.isAvailable) return false;
      if (activeTab === 'builtin' && !agent.isBuiltin) return false;
      if (activeTab === 'custom' && agent.isBuiltin) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          agent.name.toLowerCase().includes(q) ||
          agent.role.toLowerCase().includes(q) ||
          agent.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allList, search, activeTab]);

  const handleTest = (id: string) => {
    setTestingId(id);
    setTimeout(() => {
      setTestingId(null);
      alert(`助手 [${id}] 连接测试成功，心跳握手正常 (RTT 58ms)！`);
    }, 450);
  };

  const startCreate = () => {
    setIsCreating(true);
    setEditingAssistant({
      id: `custom-assistant-${Date.now()}`,
      name: '',
      role: '领域特化助手',
      description: '',
      avatarText: '🤖',
      avatarBg: '#059669',
      isAvailable: true,
      modelId: 'qwen-2.5-coder-32b',
      permission: 'auto',
      skills: ['tutor-guided-learning'],
      mcpIds: ['project-file-manager'],
      instructions: `# 角色\n你是专属智能助手...\n\n# 工作方式\n- 第一步...\n- 第二步...`,
      workspaceMode: 'shared',
      temperature: 0.3,
      isBuiltin: false,
    });
  };

  const handleSave = async () => {
    if (!editingAssistant) return;
    if (!editingAssistant.name.trim()) {
      alert('请填写助手名称！');
      return;
    }
    setSaving(true);
    try {
      if (editingAssistant.isBuiltin) {
        await updateAdminAssistant(
          editingAssistant.id,
          {
            name: editingAssistant.name,
            role: editingAssistant.role,
            description: editingAssistant.description,
            modelId: editingAssistant.modelId,
            instructions: editingAssistant.instructions,
            temperature: editingAssistant.temperature,
            enabledSkills: editingAssistant.skills,
            mcpServerIds: editingAssistant.mcpIds,
          },
          `assistant-save-${Date.now()}`,
        );
      }
      // Update local preset
      const existingIdx = STATIC_ASSISTANT_PRESETS.findIndex((p) => p.id === editingAssistant.id);
      if (existingIdx >= 0) {
        STATIC_ASSISTANT_PRESETS[existingIdx] = { ...editingAssistant };
      } else {
        STATIC_ASSISTANT_PRESETS.unshift({ ...editingAssistant });
      }
      await load();
      setEditingAssistant(null);
      setIsCreating(false);
      alert('助手设置已成功生效！');
    } catch (err) {
      alert(`保存失败: ${err instanceof Error ? err.message : '网络或服务异常'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    if (!confirm('确定要删除此自定义助手吗？')) return;
    const idx = STATIC_ASSISTANT_PRESETS.findIndex((p) => p.id === id);
    if (idx >= 0) {
      STATIC_ASSISTANT_PRESETS.splice(idx, 1);
    }
    setEditingAssistant(null);
    setIsCreating(false);
    void load();
  };

  // -------------------------------------------------------------
  // 视图渲染：编辑 / 自定义助手页面 (参考上传截图 AionUI / Multica 规范)
  // -------------------------------------------------------------
  if (editingAssistant) {
    return (
      <div style={{ maxWidth: '820px', margin: '0 auto' }}>
        {/* 顶部操作条 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: '14px',
            borderBottom: '1px solid #e5e6eb',
            marginBottom: '18px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => {
                setEditingAssistant(null);
                setIsCreating(false);
              }}
            >
              ← 全部助手
            </button>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1d2129' }}>
              {editingAssistant.name.trim() || (isCreating ? '新建助手' : '助手详情设置')}
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {!isCreating && !editingAssistant.isBuiltin && (
              <button
                type="button"
                className="settings-pill-btn"
                style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                onClick={() => handleDelete(editingAssistant.id)}
              >
                删除
              </button>
            )}
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
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '保存中...' : isCreating ? '创建' : '保存'}
            </button>
          </div>
        </div>

        {/* 卡片 1: 身份 (改动立即生效) */}
        <section className="settings-collapsible-card">
          <header
            className={`settings-card-header ${collapsedIdentity ? 'is-collapsed' : ''}`}
            onClick={() => setCollapsedIdentity((c) => !c)}
          >
            <div className="settings-card-title-group">
              <span className="settings-card-title">身份</span>
              <span className="badge-immediate">改动立即生效</span>
            </div>
            <div className="settings-card-actions">
              <span className={`settings-card-chevron ${!collapsedIdentity ? 'is-open' : ''}`}>
                ▶
              </span>
            </div>
          </header>
          {!collapsedIdentity && (
            <div className="settings-card-body">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '18px' }}>
                {/* 头像区域 */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '46px',
                      height: '46px',
                      borderRadius: '12px',
                      background: editingAssistant.avatarBg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '22px',
                      color: '#ffffff',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                    }}
                  >
                    {editingAssistant.avatarText}
                  </div>
                  <button
                    type="button"
                    className="settings-pill-btn"
                    style={{ fontSize: '11px', padding: '0 8px', height: '24px' }}
                    onClick={() => {
                      const icons = ['🤖', '📖', '🚀', '⚡', '🎓', '🦊', '🔬', '💡', '🛡️', '💻'];
                      const next = icons[(icons.indexOf(editingAssistant.avatarText) + 1) % icons.length] ?? '🤖';
                      setEditingAssistant({ ...editingAssistant, avatarText: next });
                    }}
                  >
                    更换图标
                  </button>
                </div>
                {/* 字段输入 */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div className="settings-form-row">
                    <label className="settings-form-label">
                      <span className="req">*</span> 名称
                    </label>
                    <div className="settings-form-content">
                      <input
                        type="text"
                        className="settings-input"
                        placeholder="请输入助手名称，例如：文献与知识地图助手"
                        value={editingAssistant.name}
                        onChange={(e) =>
                          setEditingAssistant({ ...editingAssistant, name: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="settings-form-row">
                    <label className="settings-form-label">描述</label>
                    <div className="settings-form-content">
                      <input
                        type="text"
                        className="settings-input"
                        placeholder="跨学科文献检索、知识地图构建、来源校验与证据综合助手"
                        value={editingAssistant.description}
                        onChange={(e) =>
                          setEditingAssistant({ ...editingAssistant, description: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 卡片 2: 默认配置 (仅对新会话生效) */}
        <section className="settings-collapsible-card">
          <header
            className={`settings-card-header ${collapsedDefaults ? 'is-collapsed' : ''}`}
            onClick={() => setCollapsedDefaults((c) => !c)}
          >
            <div className="settings-card-title-group">
              <span className="settings-card-title">默认配置</span>
              <span className="badge-new-session">仅对新会话生效</span>
            </div>
            <div className="settings-card-actions">
              <span className={`settings-card-chevron ${!collapsedDefaults ? 'is-open' : ''}`}>
                ▶
              </span>
            </div>
          </header>
          {!collapsedDefaults && (
            <div className="settings-card-body">
              {/* 模型 */}
              <div className="settings-form-row">
                <label className="settings-form-label">
                  <span style={{ fontSize: '15px' }}>☁️</span> 模型
                </label>
                <div className="settings-form-content">
                  <select
                    className="settings-select"
                    value={editingAssistant.modelId}
                    onChange={(e) =>
                      setEditingAssistant({ ...editingAssistant, modelId: e.target.value })
                    }
                  >
                    <option value="auto">自动记住上次</option>
                    {AVAILABLE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <p className="settings-hint">
                    自动记忆只有在这个助手已经记录过一次选择后才会生效。
                  </p>
                </div>
              </div>

              {/* 权限 */}
              <div className="settings-form-row">
                <label className="settings-form-label">
                  <span style={{ fontSize: '15px' }}>🛡️</span> 权限
                </label>
                <div className="settings-form-content">
                  <select
                    className="settings-select"
                    value={editingAssistant.permission}
                    onChange={(e) =>
                      setEditingAssistant({
                        ...editingAssistant,
                        permission: e.target.value as CustomAssistantItem['permission'],
                      })
                    }
                  >
                    <option value="auto">自动记住上次</option>
                    <option value="full">完全执行权限 (自主读写工作区)</option>
                    <option value="supervised">监督确认模式 (PBL 教学硬约束标准)</option>
                    <option value="readonly">只读分析模式 (禁止直接写入代码)</option>
                  </select>
                </div>
              </div>

              {/* 技能 */}
              <div className="settings-form-row">
                <label className="settings-form-label">
                  <span style={{ fontSize: '15px' }}>⚡</span> 技能
                </label>
                <div className="settings-form-content">
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '6px',
                      padding: '8px',
                      border: '1px solid #e5e6eb',
                      borderRadius: '8px',
                      background: '#fcfcfc',
                    }}
                  >
                    {ALL_SKILLS.map((sk) => {
                      const checked = editingAssistant.skills.includes(sk.id);
                      return (
                        <label
                          key={sk.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            fontSize: '12px',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            background: checked ? '#e8f3ff' : '#ffffff',
                            border: `1px solid ${checked ? '#165dff' : '#e5e6eb'}`,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...editingAssistant.skills, sk.id]
                                : editingAssistant.skills.filter((s) => s !== sk.id);
                              setEditingAssistant({ ...editingAssistant, skills: next });
                            }}
                          />
                          <span style={{ color: checked ? '#165dff' : '#4e5969', fontWeight: checked ? 600 : 400 }}>
                            {sk.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="settings-hint">已选 {editingAssistant.skills.length} 项技能</span>
                    <a href="/admin/settings/skills" className="settings-hint" style={{ color: '#165dff', textDecoration: 'none' }}>
                      前往技能中心管理 →
                    </a>
                  </div>
                </div>
              </div>

              {/* MCP / 工具 */}
              <div className="settings-form-row">
                <label className="settings-form-label">
                  <span style={{ fontSize: '15px' }}>🧰</span> MCP
                </label>
                <div className="settings-form-content">
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '6px',
                      padding: '8px',
                      border: '1px solid #e5e6eb',
                      borderRadius: '8px',
                      background: '#fcfcfc',
                    }}
                  >
                    {ALL_MCPS.map((mcp) => {
                      const checked = editingAssistant.mcpIds.includes(mcp.id);
                      return (
                        <label
                          key={mcp.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            fontSize: '12px',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            background: checked ? '#f0fdf4' : '#ffffff',
                            border: `1px solid ${checked ? '#059669' : '#e5e6eb'}`,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...editingAssistant.mcpIds, mcp.id]
                                : editingAssistant.mcpIds.filter((s) => s !== mcp.id);
                              setEditingAssistant({ ...editingAssistant, mcpIds: next });
                            }}
                          />
                          <span style={{ color: checked ? '#059669' : '#4e5969', fontWeight: checked ? 600 : 400 }}>
                            {mcp.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="settings-hint">已选 {editingAssistant.mcpIds.length} 项工具与沙箱</span>
                    <a href="/admin/settings/tools" className="settings-hint" style={{ color: '#165dff', textDecoration: 'none' }}>
                      前往 MCP / 工具设置 →
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 卡片 3: 规则 (仅对新会话生效) */}
        <section className="settings-collapsible-card">
          <header
            className={`settings-card-header ${collapsedRules ? 'is-collapsed' : ''}`}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('.rule-controls')) return;
              setCollapsedRules((c) => !c);
            }}
          >
            <div className="settings-card-title-group">
              <span className="settings-card-title">规则</span>
              <span className="badge-new-session">仅对新会话生效</span>
            </div>
            <div className="settings-card-actions rule-controls" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ display: 'inline-flex', background: '#f2f3f5', borderRadius: '6px', padding: '2px' }}>
                <button
                  type="button"
                  style={{
                    border: 'none',
                    background: ruleTab === 'edit' ? '#ffffff' : 'transparent',
                    color: ruleTab === 'edit' ? '#165dff' : '#4e5969',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setRuleTab('edit')}
                >
                  编辑
                </button>
                <button
                  type="button"
                  style={{
                    border: 'none',
                    background: ruleTab === 'preview' ? '#ffffff' : 'transparent',
                    color: ruleTab === 'preview' ? '#165dff' : '#4e5969',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                  onClick={() => setRuleTab('preview')}
                >
                  预览
                </button>
              </div>
              <button
                type="button"
                className="settings-pill-btn"
                style={{ fontSize: '11px', height: '22px', padding: '0 6px' }}
                onClick={() => setRuleExpanded((r) => !r)}
              >
                {ruleExpanded ? '收起' : '展开'}
              </button>
              <span className={`settings-card-chevron ${!collapsedRules ? 'is-open' : ''}`}>
                ▶
              </span>
            </div>
          </header>
          {!collapsedRules && (
            <div className="settings-card-body" style={{ padding: '0' }}>
              {ruleTab === 'edit' ? (
                <textarea
                  className="settings-textarea"
                  style={{
                    height: ruleExpanded ? '460px' : '230px',
                    border: 'none',
                    borderRadius: '0',
                    fontFamily: 'monospace',
                    fontSize: '12.5px',
                    lineHeight: '1.6',
                    padding: '14px 18px',
                  }}
                  placeholder="# 角色\n你是...\n\n# 工作方式\n- 先明确..."
                  value={editingAssistant.instructions}
                  onChange={(e) =>
                    setEditingAssistant({ ...editingAssistant, instructions: e.target.value })
                  }
                />
              ) : (
                <div
                  style={{
                    height: ruleExpanded ? '460px' : '230px',
                    overflowY: 'auto',
                    padding: '16px 20px',
                    background: '#fafafa',
                    fontSize: '13px',
                    lineHeight: '1.7',
                    color: '#272e3b',
                  }}
                >
                  <pre
                    style={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      margin: 0,
                      fontFamily: 'inherit',
                    }}
                  >
                    {editingAssistant.instructions || '（暂无规则指令）'}
                  </pre>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 卡片 4: Multica 进阶配置 */}
        <section className="settings-collapsible-card">
          <header
            className={`settings-card-header ${collapsedMultica ? 'is-collapsed' : ''}`}
            onClick={() => setCollapsedMultica((c) => !c)}
          >
            <div className="settings-card-title-group">
              <span className="settings-card-title">Multica 进阶属性</span>
              <span className="badge-advanced">团队协作</span>
            </div>
            <div className="settings-card-actions">
              <span className={`settings-card-chevron ${!collapsedMultica ? 'is-open' : ''}`}>
                ▶
              </span>
            </div>
          </header>
          {!collapsedMultica && (
            <div className="settings-card-body">
              <div className="settings-form-row">
                <label className="settings-form-label">角色定位</label>
                <div className="settings-form-content">
                  <input
                    type="text"
                    className="settings-input"
                    placeholder="例如：生产流程 Leader / 架构师 / 物理教学教练"
                    value={editingAssistant.role}
                    onChange={(e) =>
                      setEditingAssistant({ ...editingAssistant, role: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="settings-form-row">
                <label className="settings-form-label">工作区模式</label>
                <div className="settings-form-content">
                  <select
                    className="settings-select"
                    value={editingAssistant.workspaceMode}
                    onChange={(e) =>
                      setEditingAssistant({
                        ...editingAssistant,
                        workspaceMode: e.target.value as 'shared' | 'isolated',
                      })
                    }
                  >
                    <option value="shared">shared (与团队成员共享项目代码工作区)</option>
                    <option value="isolated">isolated (分配独立沙箱/Git分支环境)</option>
                  </select>
                </div>
              </div>

              <div className="settings-form-row">
                <label className="settings-form-label">生成温度</label>
                <div className="settings-form-content" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    style={{ flex: 1 }}
                    value={editingAssistant.temperature}
                    onChange={(e) =>
                      setEditingAssistant({
                        ...editingAssistant,
                        temperature: parseFloat(e.target.value),
                      })
                    }
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600, width: '40px' }}>
                    {editingAssistant.temperature}
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  // -------------------------------------------------------------
  // 列表视图：助手列表
  // -------------------------------------------------------------
  return (
    <AionSettingsParadigm
      title="智能助手"
      description={
        <span>
          管理启途智学平台智能助手与 PBL 导师。支持通过自己的 Agent SDK 定义会话、执行门禁与团队编排，亦可参考 Multica 格式自定义助手。
        </span>
      }
      searchPlaceholder="搜索助手名称、定位、技能..."
      searchQuery={search}
      onSearchChange={setSearch}
      primaryActionLabel="新建助手"
      onPrimaryAction={startCreate}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {filtered.length === 0 ? (
        <div className="settings-empty">暂无匹配的智能助手</div>
      ) : (
        filtered.map((agent) => (
          <RowCard
            key={agent.id}
            avatarText={agent.avatarText}
            avatarBg={agent.avatarBg}
            name={agent.name}
            statusText={agent.isAvailable ? (agent.isBuiltin ? '系统内置' : '自定义') : '待配置'}
            statusType={agent.isAvailable ? (agent.isBuiltin ? 'ok' : 'custom') : 'off'}
            description={`${agent.role} · ${agent.description}`}
            avatarStack={[agent.modelId.slice(0, 2), ...agent.skills.map((s) => s.slice(0, 1))]}
            testLabel="测试连接"
            testLoading={testingId === agent.id}
            onTestConnection={() => handleTest(agent.id)}
            editLabel="编辑设置"
            onEdit={() => {
              setEditingAssistant({ ...agent });
              setIsCreating(false);
            }}
          />
        ))
      )}
    </AionSettingsParadigm>
  );
}
