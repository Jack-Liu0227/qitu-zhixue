'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchAdminAssistantConfigs } from '../../../../lib/api/assistants';
import type { AdminAssistantConfig } from '@qitu/contracts';

interface SkillFile {
  name: string;
  sizeBytes: number;
  content: string;
}

interface SkillItem {
  id: string;
  name: string;
  description: string;
  tags: string[];
  filesCount: number;
  addedBy: string;
  updatedAtText: string;
  boundAssistantIds: string[];
  files: SkillFile[];
}

const DEFAULT_FILES_FOR_SKILL: Record<string, SkillFile[]> = {
  'tutor-guided-learning': [
    {
      name: 'SKILL.md',
      sizeBytes: 4200,
      content: `# Tutor Guided Learning (苏格拉底短轮次启发学习规范)

## 技能定位与核心目标
本技能定义启途智学全平台 PBL 智能体在面对学生提问时的教学互动范式。
核心指导理念为：**启发思考而非替代操作；拆解概念而非倾倒答案。**

## 核心交互铁律 (Hard Constraints)
1. **绝对禁令**：严禁在单次回复中直接提供超过 5 行的完整实现代码。
2. **渐进支架 (Scaffolding)**：
   - 第 1 轮：确认意图，提炼核心概念障碍，抛出 1 个反问。
   - 第 2 轮：若学生仍困惑，提供局部伪代码或错误示范比对。
   - 第 3 轮：引导学生自主指出错误根源并给出修改尝试。
3. **理论门禁 (TheoryMastered)**：
   - 在学生进入实践编码阶段前，必须经由原理教练确认其掌握核心物理/数学公式。

## 适用角色与触发阶段
- **适用智能体**：总负责人 (Leader)、原理教练 (Coach)、代码向导 (Teammate)。
- **触发条件**：学生提问包含“怎么写”、“报错了”、“直接给我代码”等求助句式。
`,
    },
    {
      name: 'prompts/instruction.txt',
      sizeBytes: 1820,
      content: `[SYSTEM TUTOR CONTRACT]
Role: Socratic Mentor Agent
Mode: Conversational & Inquisitive
Tone: Encouraging, rigorous, concise (under 180 words per turn).
Rule: Always conclude your response with a thought-provoking question to nudge the student forward.
`,
    },
    {
      name: 'references/rubric.json',
      sizeBytes: 2450,
      content: `{
  "rubricVersion": "2.0.0",
  "skill": "tutor-guided-learning",
  "criteria": [
    { "id": "crit-socratic", "name": "苏格拉底启发比率", "weight": 0.4, "threshold": 0.85 },
    { "id": "crit-no-direct-code", "name": "防直接透题合规性", "weight": 0.4, "threshold": 1.0 },
    { "id": "crit-encouragement", "name": "正面探索激励性", "weight": 0.2, "threshold": 0.8 }
  ]
}`,
    },
  ],
  'thunder-fighter-engine': [
    {
      name: 'SKILL.md',
      sizeBytes: 5120,
      content: `# Thunder Fighter Game Engine Specification

## 架构概览
本规范定义「雷霆战机」PBL 项目的标准 Pygame 主循环、精灵分层管理与帧率锁定逻辑。

## 模块清单
- \`PlayerSprite\`：玩家战机操控与键盘事件响应。
- \`BulletQueue\`：子弹发射池与越界回收。
- \`EnemySpawner\`：敌机定时生成、航迹插值与速度计算。
- \`CollisionManager\`：AABB 轴对齐包围盒碰撞检测。
`,
    },
    {
      name: 'prompts/instruction.txt',
      sizeBytes: 1200,
      content: `Guide the student through building a pygame 60FPS loop. Focus on clock.tick(60), pygame.event.pump(), and dirty rect updating.`,
    },
  ],
};

const INITIAL_SKILLS: SkillItem[] = [
  {
    id: 'tutor-guided-learning',
    name: 'tutor-guided-learning',
    description: '短轮次苏格拉底式启发教学，引导学生自主探索与思考，严禁直出完整代码。智能体据此决定何时加载引导规范。',
    tags: ['教学规范', '苏格拉底', '引导'],
    filesCount: 3,
    addedBy: '平台教研组',
    updatedAtText: '2 天前',
    boundAssistantIds: ['asst-thunder-leader', 'asst-kinetic-leader', 'asst-code-guide'],
    files: DEFAULT_FILES_FOR_SKILL['tutor-guided-learning'] ?? [],
  },
  {
    id: 'thunder-fighter-engine',
    name: 'thunder-fighter-engine',
    description: '雷霆战机 Python/Pygame 游戏主循环引擎与渲染规范，包含帧率锁定与事件队列控制。',
    tags: ['Pygame', '游戏引擎', '主循环'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '5 天前',
    boundAssistantIds: ['asst-thunder-leader', 'asst-code-guide'],
    files: DEFAULT_FILES_FOR_SKILL['thunder-fighter-engine'] ?? [],
  },
  {
    id: 'aabb-collision-solver',
    name: 'aabb-collision-solver',
    description: '二维轴对齐包围盒 (AABB) 碰撞检测算法推导与子弹击中敌机判定数学规范。',
    tags: ['物理算法', 'AABB', '碰撞检测'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '12 天前',
    boundAssistantIds: ['asst-thunder-leader', 'asst-code-guide'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 3100,
        content: `# AABB Collision Solver Specification\n\n## 理论推导\n两个矩形相交的充要条件：\n\`rect1.x < rect2.x + rect2.width && rect1.x + rect1.width > rect2.x && rect1.y < rect2.y + rect2.height && rect1.y + rect1.height > rect2.y\``,
      },
    ],
  },
  {
    id: 'kinetic-energy-physics',
    name: 'kinetic-energy-physics',
    description: '动手学动能定理：合外力做功与动能变化关系模拟验证与数值推导规范。',
    tags: ['物理仿真', '动能定理', '功与能量'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '15 天前',
    boundAssistantIds: ['asst-kinetic-leader', 'asst-concept-coach'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 3800,
        content: `# Kinetic Energy Physics Specification\n\n## 动能定理公式\n$$W = \\Delta E_k = \\frac{1}{2}m v_2^2 - \\frac{1}{2}m v_1^2$$\n\n## 探究流程\n1. 恒力作用与匀加速运动数据采集。\n2. 绘制功-位移曲线与动能折线图。\n3. 分析误差来源（空气阻力与轨道摩擦）。`,
      },
    ],
  },
  {
    id: 'pbl-defense-rubric',
    name: 'pbl-defense-rubric',
    description: 'PBL 结项答辩、概念掌握度质询与作品防作弊问答评测规程。',
    tags: ['答辩评测', '量规', '反思'],
    filesCount: 2,
    addedBy: '平台教研组',
    updatedAtText: '20 天前',
    boundAssistantIds: ['asst-reviewer'],
    files: [
      {
        name: 'SKILL.md',
        sizeBytes: 2900,
        content: `# PBL Defense Rubric\n\n## 答辩环节三问\n1. 为什么选择这个方案？\n2. 遇到的最大困难是什么，如何定位根因？\n3. 如果再多一周，你会增加什么特性？`,
      },
    ],
  },
];

export default function SkillsSettingsPage() {
  const [skills, setSkills] = useState<SkillItem[]>(INITIAL_SKILLS);
  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingSkill, setEditingSkill] = useState<SkillItem | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'files'>('overview');
  const [showAddAssistantModal, setShowAddAssistantModal] = useState(false);
  const [selectedAsstToAdd, setSelectedAsstToAdd] = useState('');
  const [saveNotice, setSaveNotice] = useState('');

  // 文件管理状态
  const [selectedFileName, setSelectedFileName] = useState<string>('SKILL.md');
  const [fileViewMode, setFileViewMode] = useState<'edit' | 'preview'>('edit');
  const [fileContentDraft, setFileContentDraft] = useState<string>('');

  // 加载真实助手用于绑定与展示头像
  useEffect(() => {
    fetchAdminAssistantConfigs()
      .then((res) => setAssistants(res))
      .catch(() => {});
  }, []);

  // 当切换 editingSkill 或 selectedFileName 时同步草稿
  useEffect(() => {
    if (!editingSkill) return;
    const file = editingSkill.files.find((f) => f.name === selectedFileName) || editingSkill.files[0];
    if (file) {
      setSelectedFileName(file.name);
      setFileContentDraft(file.content);
    }
  }, [editingSkill, selectedFileName]);

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
  }, [skills, searchQuery]);

  // 新建 Skill
  const handleCreateSkill = () => {
    const newSkill: SkillItem = {
      id: `skill-${Date.now()}`,
      name: `custom-skill-${skills.length + 1}`,
      description: '自定义 PBL 智能体能力扩展指令与上下文约定。',
      tags: ['自定义'],
      filesCount: 2,
      addedBy: '管理员',
      updatedAtText: '刚刚',
      boundAssistantIds: assistants[0]?.id ? [assistants[0].id] : [],
      files: [
        {
          name: 'SKILL.md',
          sizeBytes: 1200,
          content: '# New Custom Skill\n\n## 技能功能定义\n请在此处编写 Markdown 技能规范与智能体调用约束。',
        },
        {
          name: 'prompts/instruction.txt',
          sizeBytes: 600,
          content: 'You are a specialized agent executing this skill.',
        },
      ],
    };
    setSkills((prev) => [newSkill, ...prev]);
    setEditingSkill(newSkill);
    setSelectedFileName('SKILL.md');
  };

  // 保存 Skill 编辑（含属性与文件）
  const handleSaveSkill = () => {
    if (!editingSkill) return;
    const updatedFiles = editingSkill.files.map((f) =>
      f.name === selectedFileName
        ? { ...f, content: fileContentDraft, sizeBytes: new Blob([fileContentDraft]).size }
        : f
    );
    const updatedSkill = { ...editingSkill, files: updatedFiles, filesCount: updatedFiles.length };

    setSkills((prev) => prev.map((s) => (s.id === editingSkill.id ? updatedSkill : s)));
    setEditingSkill(updatedSkill);
    setSaveNotice('已成功保存所有配置与文件更改 ✔');
    setTimeout(() => setSaveNotice(''), 2500);
  };

  // 保存当前单文件
  const handleSaveCurrentFile = () => {
    if (!editingSkill) return;
    const updatedFiles = editingSkill.files.map((f) =>
      f.name === selectedFileName
        ? { ...f, content: fileContentDraft, sizeBytes: new Blob([fileContentDraft]).size }
        : f
    );
    const updatedSkill = { ...editingSkill, files: updatedFiles, filesCount: updatedFiles.length };

    setSkills((prev) => prev.map((s) => (s.id === editingSkill.id ? updatedSkill : s)));
    setEditingSkill(updatedSkill);
    setSaveNotice(`文件 ${selectedFileName} 已保存 ✔`);
    setTimeout(() => setSaveNotice(''), 2000);
  };

  // 添加新文件
  const handleAddNewFile = () => {
    if (!editingSkill) return;
    const fileName = prompt('请输入新文件名（如：rules/constraints.md 或 rubric.json）：');
    if (!fileName?.trim()) return;
    const trimmed = fileName.trim();
    if (editingSkill.files.some((f) => f.name === trimmed)) {
      alert('已存在同名文件');
      return;
    }
    const newFile: SkillFile = {
      name: trimmed,
      sizeBytes: 0,
      content: trimmed.endsWith('.md') ? `# ${trimmed}\n\n文件初始内容` : '',
    };
    const updatedFiles = [...editingSkill.files, newFile];
    const updatedSkill = { ...editingSkill, files: updatedFiles, filesCount: updatedFiles.length };
    setEditingSkill(updatedSkill);
    setSkills((prev) => prev.map((s) => (s.id === editingSkill.id ? updatedSkill : s)));
    setSelectedFileName(trimmed);
    setFileContentDraft(newFile.content);
  };

  // 删除文件
  const handleDeleteFile = (fileName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editingSkill) return;
    if (editingSkill.files.length <= 1) {
      alert('Skill 至少需保留一个文件');
      return;
    }
    if (!window.confirm(`确定要删除文件「${fileName}」吗？`)) return;

    const updatedFiles = editingSkill.files.filter((f) => f.name !== fileName);
    const updatedSkill = { ...editingSkill, files: updatedFiles, filesCount: updatedFiles.length };
    setEditingSkill(updatedSkill);
    setSkills((prev) => prev.map((s) => (s.id === editingSkill.id ? updatedSkill : s)));
    if (selectedFileName === fileName) {
      setSelectedFileName(updatedFiles[0].name);
      setFileContentDraft(updatedFiles[0].content);
    }
  };

  // 删除 Skill
  const handleDeleteSkill = (id: string, name: string) => {
    if (!window.confirm(`确定要彻底删除技能「${name}」吗？`)) return;
    setSkills((prev) => prev.filter((s) => s.id !== id));
    if (editingSkill?.id === id) {
      setEditingSkill(null);
    }
  };

  // 从技能中解除绑定助手
  const handleRemoveAssistantFromSkill = (asstId: string) => {
    if (!editingSkill) return;
    setEditingSkill({
      ...editingSkill,
      boundAssistantIds: editingSkill.boundAssistantIds.filter((id) => id !== asstId),
    });
  };

  // 向技能绑定助手
  const handleAddAssistantToSkill = () => {
    if (!editingSkill || !selectedAsstToAdd) return;
    if (editingSkill.boundAssistantIds.includes(selectedAsstToAdd)) {
      alert('该助手已绑定此技能');
      return;
    }
    setEditingSkill({
      ...editingSkill,
      boundAssistantIds: [...editingSkill.boundAssistantIds, selectedAsstToAdd],
    });
    setShowAddAssistantModal(false);
    setSelectedAsstToAdd('');
  };

  // 技能编辑视图
  if (editingSkill) {
    const boundAssistants = assistants.filter((a) => editingSkill.boundAssistantIds.includes(a.id));
    const activeFile = editingSkill.files.find((f) => f.name === selectedFileName) || editingSkill.files[0];

    return (
      <div className="admin-skill-editor-page">
        {/* 面包屑与顶部操作栏 */}
        <div className="admin-skill-breadcrumb-bar">
          <div className="admin-skill-breadcrumb-links">
            <button
              type="button"
              className="admin-crumb-btn"
              onClick={() => setEditingSkill(null)}
            >
              Skills
            </button>
            <span className="admin-crumb-sep">/</span>
            <span className="admin-crumb-current">{editingSkill.name}</span>
          </div>

          <div className="admin-skill-top-actions">
            {saveNotice ? (
              <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: 600 }}>{saveNotice}</span>
            ) : null}
            <button
              type="button"
              className="settings-action-btn is-danger"
              onClick={() => handleDeleteSkill(editingSkill.id, editingSkill.name)}
              title="删除此技能"
            >
              🗑️ 删除技能
            </button>
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={handleSaveSkill}
            >
              💾 保存全部修改
            </button>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => setEditingSkill(null)}
            >
              返回列表
            </button>
          </div>
        </div>

        {/* 技能标题与元数据 */}
        <div className="admin-skill-title-block">
          <div className="admin-skill-title-row">
            <span className="admin-skill-icon">📖</span>
            <h1 className="admin-skill-main-title">{editingSkill.name}</h1>
          </div>
          <div className="admin-skill-meta-tags">
            <span className="admin-skill-meta-pill">✎ 手动创建</span>
            <span className="admin-skill-meta-pill">📄 {editingSkill.filesCount} 个文件</span>
            <span className="admin-skill-meta-pill">👥 {editingSkill.boundAssistantIds.length} 个智能体在用</span>
            <span className="admin-skill-meta-pill">🕒 {editingSkill.addedBy} 于 {editingSkill.updatedAtText}更新</span>
          </div>
        </div>

        {/* 概览 / 文件 选项卡 */}
        <div className="admin-skill-tabs-bar">
          <button
            type="button"
            className={`admin-skill-tab-item${activeTab === 'overview' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            概览与属性
          </button>
          <button
            type="button"
            className={`admin-skill-tab-item${activeTab === 'files' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('files')}
          >
            文件编辑与预览 ({editingSkill.filesCount})
          </button>
        </div>

        {activeTab === 'overview' ? (
          <div className="admin-skill-overview-content">
            {/* 模块一：属性 */}
            <section className="admin-skill-card-section">
              <h2 className="admin-skill-section-title">属性</h2>
              <div className="admin-skill-fold-hint">▶ 关于 skill 属性</div>

              <div className="admin-skill-form-field">
                <label className="admin-skill-field-label">名称</label>
                <input
                  className="admin-skill-input-text"
                  value={editingSkill.name}
                  onChange={(e) => setEditingSkill({ ...editingSkill, name: e.target.value })}
                  placeholder="skill 标识名称"
                />
              </div>

              <div className="admin-skill-form-field">
                <label className="admin-skill-field-label">描述</label>
                <textarea
                  className="admin-skill-textarea"
                  value={editingSkill.description}
                  onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })}
                  placeholder="智能体据此决定何时加载 skill。"
                  rows={4}
                />
                <div className="admin-skill-char-count-row">
                  <span className="admin-skill-hint-sub">智能体据此决定何时加载 skill。</span>
                  <span className="admin-skill-count-sub">{editingSkill.description.length} 个字符</span>
                </div>
              </div>

              <div className="admin-skill-form-field">
                <label className="admin-skill-field-label">标签</label>
                <div className="admin-skill-tags-input-box">
                  {editingSkill.tags.map((t) => (
                    <span key={t} className="admin-skill-tag-chip">
                      {t}
                    </span>
                  ))}
                  <button
                    type="button"
                    className="admin-skill-add-tag-btn"
                    onClick={() => {
                      const tag = prompt('输入新标签：');
                      if (tag?.trim()) {
                        setEditingSkill({
                          ...editingSkill,
                          tags: [...editingSkill.tags, tag.trim()],
                        });
                      }
                    }}
                  >
                    🏷 添加标签
                  </button>
                </div>
              </div>
            </section>

            {/* 模块二：被 X 个智能体使用 */}
            <section className="admin-skill-card-section">
              <div className="admin-skill-agents-header">
                <h2 className="admin-skill-section-title">
                  被 {editingSkill.boundAssistantIds.length} 个智能体使用
                </h2>
                <button
                  type="button"
                  className="settings-action-btn"
                  onClick={() => setShowAddAssistantModal(true)}
                >
                  + 添加到智能体
                </button>
              </div>

              {boundAssistants.length === 0 ? (
                <div className="admin-skill-empty-agents">
                  暂未绑定任何智能体，点击右上角“添加到智能体”进行挂载。
                </div>
              ) : (
                <div className="admin-skill-agents-list">
                  {boundAssistants.map((assistant) => (
                    <div key={assistant.id} className="admin-skill-agent-row">
                      <div className="admin-skill-agent-avatar-wrap">
                        {assistant.avatar || '🤖'}
                      </div>
                      <div className="admin-skill-agent-info">
                        <strong className="admin-skill-agent-name">{assistant.name}</strong>
                        <p className="admin-skill-agent-desc">
                          {assistant.description || '专业教学指导智能体。'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="admin-skill-unlink-btn"
                        onClick={() => handleRemoveAssistantFromSkill(assistant.id)}
                        title="从此智能体移除该技能"
                      >
                        ✕ 解除绑定
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          /* 文件双栏视图：左侧文件列表，右侧文件编辑与实时渲染预览 */
          <div className="admin-skill-files-workbench" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '16px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginTop: '16px', minHeight: '560px' }}>
            {/* 左侧文件树 */}
            <div style={{ borderRight: '1px solid #e2e8f0', paddingRight: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <strong style={{ fontSize: '13px', color: '#0f172a' }}>文件树 ({editingSkill.files.length})</strong>
                <button
                  type="button"
                  style={{ fontSize: '12px', padding: '3px 8px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc', cursor: 'pointer' }}
                  onClick={handleAddNewFile}
                >
                  + 新建文件
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {editingSkill.files.map((file) => {
                  const isSelected = file.name === selectedFileName;
                  return (
                    <div
                      key={file.name}
                      onClick={() => {
                        setSelectedFileName(file.name);
                        setFileContentDraft(file.content);
                      }}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        background: isSelected ? '#eff6ff' : 'transparent',
                        border: isSelected ? '1px solid #bfdbfe' : '1px solid transparent',
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                        <span>{file.name.endsWith('.md') ? '📝' : file.name.endsWith('.json') ? '⚙️' : '📄'}</span>
                        <span style={{ fontWeight: isSelected ? 600 : 400, color: isSelected ? '#1d4ed8' : '#334155', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {file.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }}
                        onClick={(e) => handleDeleteFile(file.name, e)}
                        title="删除文件"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 右侧编辑器与预览器 */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {/* 文件顶部工具条 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid #e2e8f0', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <strong style={{ fontSize: '15px', color: '#0f172a' }}>{selectedFileName}</strong>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>({new Blob([fileContentDraft]).size} 字节)</span>
                  {selectedFileName.endsWith('.md') ? (
                    <span style={{ fontSize: '11px', background: '#dbeafe', color: '#1e40af', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                      Markdown 文档
                    </span>
                  ) : null}
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {selectedFileName.endsWith('.md') ? (
                    <div style={{ display: 'flex', background: '#f1f5f9', padding: '2px', borderRadius: '6px' }}>
                      <button
                        type="button"
                        onClick={() => setFileViewMode('edit')}
                        style={{
                          border: 'none',
                          padding: '4px 10px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          background: fileViewMode === 'edit' ? '#ffffff' : 'transparent',
                          fontWeight: fileViewMode === 'edit' ? 600 : 400,
                          color: fileViewMode === 'edit' ? '#0f172a' : '#64748b',
                        }}
                      >
                        ✏️ 编辑代码
                      </button>
                      <button
                        type="button"
                        onClick={() => setFileViewMode('preview')}
                        style={{
                          border: 'none',
                          padding: '4px 10px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          background: fileViewMode === 'preview' ? '#ffffff' : 'transparent',
                          fontWeight: fileViewMode === 'preview' ? 600 : 400,
                          color: fileViewMode === 'preview' ? '#0f172a' : '#64748b',
                        }}
                      >
                        👁 实时渲染预览
                      </button>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="settings-action-btn is-primary"
                    style={{ fontSize: '12px', padding: '4px 12px' }}
                    onClick={handleSaveCurrentFile}
                  >
                    💾 保存当前文件
                  </button>
                </div>
              </div>

              {/* 文件内容展示区 */}
              {selectedFileName.endsWith('.md') && fileViewMode === 'preview' ? (
                /* Markdown 渲染预览 */
                <div style={{ flex: 1, padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', overflowY: 'auto', maxHeight: '480px', lineHeight: 1.6, color: '#1e293b' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {fileContentDraft.split('\n').map((line, idx) => {
                      if (line.startsWith('# ')) {
                        return <h1 key={idx} style={{ fontSize: '1.4rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px', margin: '8px 0 4px', color: '#0f172a' }}>{line.replace('# ', '')}</h1>;
                      }
                      if (line.startsWith('## ')) {
                        return <h2 key={idx} style={{ fontSize: '1.15rem', margin: '8px 0 4px', color: '#1e293b' }}>{line.replace('## ', '')}</h2>;
                      }
                      if (line.startsWith('### ')) {
                        return <h3 key={idx} style={{ fontSize: '1rem', margin: '6px 0 2px', color: '#334155' }}>{line.replace('### ', '')}</h3>;
                      }
                      if (line.startsWith('- ') || line.startsWith('* ')) {
                        return <li key={idx} style={{ marginLeft: '16px', fontSize: '13px' }}>{line.replace(/^[-*]\s+/, '')}</li>;
                      }
                      if (line.startsWith('1. ') || line.startsWith('2. ') || line.startsWith('3. ')) {
                        return <div key={idx} style={{ marginLeft: '12px', fontSize: '13px' }}>{line}</div>;
                      }
                      if (line.startsWith('```')) {
                        return <div key={idx} style={{ fontSize: '12px', color: '#64748b', fontFamily: 'monospace' }}>{line}</div>;
                      }
                      if (!line.trim()) {
                        return <div key={idx} style={{ height: '6px' }} />;
                      }
                      return <p key={idx} style={{ margin: '2px 0', fontSize: '13px' }}>{line}</p>;
                    })}
                  </div>
                </div>
              ) : (
                /* 源代码编辑 */
                <textarea
                  style={{
                    flex: 1,
                    minHeight: '440px',
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
                  value={fileContentDraft}
                  onChange={(e) => setFileContentDraft(e.target.value)}
                  spellCheck={false}
                />
              )}
            </div>
          </div>
        )}

        {/* 添加到智能体弹窗 */}
        {showAddAssistantModal ? (
          <div className="admin-modal-overlay" onClick={() => setShowAddAssistantModal(false)}>
            <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <h3>将技能添加到智能体</h3>
                <button
                  type="button"
                  className="admin-modal-close-btn"
                  onClick={() => setShowAddAssistantModal(false)}
                >
                  ✕
                </button>
              </div>
              <div className="admin-modal-body">
                <div className="admin-form-row">
                  <label className="admin-form-label">选择智能体</label>
                  <select
                    className="admin-select"
                    value={selectedAsstToAdd}
                    onChange={(e) => setSelectedAsstToAdd(e.target.value)}
                  >
                    <option value="">-- 请选择要绑定的助手 --</option>
                    {assistants.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="admin-modal-footer">
                <button
                  type="button"
                  className="settings-action-btn"
                  onClick={() => setShowAddAssistantModal(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="settings-action-btn is-primary"
                  onClick={handleAddAssistantToSkill}
                >
                  确认添加
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // 技能列表视图
  return (
    <div className="admin-skills-page-container">
      {/* 顶部标题与新建按钮 */}
      <div className="admin-skills-top-bar">
        <div className="admin-skills-title-group">
          <span className="admin-skills-top-icon">📖</span>
          <h1 className="admin-skills-title">Skills (技能库)</h1>
          <span className="admin-skills-total-count">{skills.length}</span>
          <span className="admin-skills-tagline">工作区里任何智能体都能使用的指令规范与文件体系。</span>
        </div>

        <button
          type="button"
          className="settings-action-btn is-primary"
          onClick={handleCreateSkill}
        >
          + 新建 skill
        </button>
      </div>

      {/* 搜索与筛选控制栏 */}
      <div className="admin-skills-filter-row">
        <div className="admin-skills-search-input-wrap">
          <span aria-hidden="true">🔍</span>
          <input
            type="text"
            placeholder="搜索 skill..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 技能表格 */}
      <div className="admin-skills-table-card">
        <table className="admin-skills-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>
                <input type="checkbox" readOnly />
              </th>
              <th>名称</th>
              <th>被谁使用</th>
              <th>添加者</th>
              <th>更新时间 ↓</th>
              <th style={{ textAlign: 'right', width: '80px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredSkills.map((skill) => {
              const bound = assistants.filter((a) => skill.boundAssistantIds.includes(a.id));

              return (
                <tr
                  key={skill.id}
                  className="admin-skill-table-row"
                  onClick={() => {
                    setEditingSkill(skill);
                    setSelectedFileName(skill.files[0]?.name || 'SKILL.md');
                  }}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" />
                  </td>
                  <td>
                    <strong className="admin-skill-table-name">{skill.name}</strong>
                  </td>
                  <td>
                    <div className="admin-skill-avatar-stack">
                      {bound.slice(0, 3).map((a) => (
                        <div key={a.id} className="admin-skill-avatar-circle" title={a.name}>
                          {a.avatar || '🤖'}
                        </div>
                      ))}
                      {bound.length > 3 ? (
                        <span className="admin-skill-avatar-more">+{bound.length - 3}</span>
                      ) : null}
                      {bound.length === 0 ? (
                        <span className="admin-skill-none-used">— 未使用</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div className="admin-skill-added-by-cell">
                      <span className="admin-skill-user-badge">Y</span>
                      <span>{skill.addedBy}</span>
                    </div>
                  </td>
                  <td>
                    <span className="admin-skill-time-cell">{skill.updatedAtText}</span>
                  </td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="admin-skill-dot-btn"
                        onClick={() => {
                          setEditingSkill(skill);
                          setSelectedFileName(skill.files[0]?.name || 'SKILL.md');
                        }}
                        title="编辑技能"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        className="admin-skill-dot-btn"
                        style={{ color: '#ef4444' }}
                        onClick={() => handleDeleteSkill(skill.id, skill.name)}
                        title="删除技能"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
