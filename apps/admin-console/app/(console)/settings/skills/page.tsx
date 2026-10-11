'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAdminAssistantConfigs, updatePersistedAssistant } from '../../../../lib/api/assistants';
import type { AdminAssistantConfig } from '@qitu/contracts';
import { newIdempotencyKey } from '../../../../lib/api/modelRegistry';

interface SkillItem {
  id: string;
  name: string;
  description: string;
  tags: string[];
  filesCount: number;
  addedBy: string;
  updatedAtText: string;
  boundAssistantIds: string[];
}

const INITIAL_SKILLS: SkillItem[] = [
  {
    id: 'tutor-guided-learning',
    name: 'tutor-guided-learning',
    description: '短轮次苏格拉底式启发教学，引导学生自主探索与思考，严禁直出完整代码。智能体据此决定何时加载引导规范。',
    tags: ['教学规范', '苏格拉底', '引导'],
    filesCount: 6,
    addedBy: '平台教研组',
    updatedAtText: '2 天前',
    boundAssistantIds: ['asst-thunder-leader', 'asst-kinetic-leader', 'asst-code-guide'],
  },
  {
    id: 'thunder-fighter-engine',
    name: 'thunder-fighter-engine',
    description: '雷霆战机 Python/Pygame 游戏主循环引擎与渲染规范，包含帧率锁定与事件队列控制。',
    tags: ['Pygame', '游戏引擎', '主循环'],
    filesCount: 12,
    addedBy: '平台教研组',
    updatedAtText: '5 天前',
    boundAssistantIds: ['asst-thunder-leader', 'asst-code-guide'],
  },
  {
    id: 'aabb-collision-solver',
    name: 'aabb-collision-solver',
    description: '二维轴对齐包围盒 (AABB) 碰撞检测算法推导与子弹击中敌机判定数学规范。',
    tags: ['物理算法', 'AABB', '碰撞检测'],
    filesCount: 8,
    addedBy: '平台教研组',
    updatedAtText: '12 天前',
    boundAssistantIds: ['asst-thunder-leader', 'asst-code-guide'],
  },
  {
    id: 'kinetic-energy-physics',
    name: 'kinetic-energy-physics',
    description: '动手学动能定理：合外力做功与动能变化关系模拟验证与数值推导规范。',
    tags: ['物理仿真', '动能定理', '功与能量'],
    filesCount: 9,
    addedBy: '平台教研组',
    updatedAtText: '15 天前',
    boundAssistantIds: ['asst-kinetic-leader', 'asst-concept-coach'],
  },
  {
    id: 'pbl-defense-rubric',
    name: 'pbl-defense-rubric',
    description: 'PBL 结项答辩、概念掌握度质询与作品防作弊问答评测规程。',
    tags: ['答辩评测', '量规', '反思'],
    filesCount: 5,
    addedBy: '平台教研组',
    updatedAtText: '20 天前',
    boundAssistantIds: ['asst-reviewer'],
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

  // 加载真实助手用于绑定与展示头像
  useEffect(() => {
    fetchAdminAssistantConfigs()
      .then((res) => setAssistants(res))
      .catch(() => {});
  }, []);

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
      filesCount: 1,
      addedBy: '管理员',
      updatedAtText: '刚刚',
      boundAssistantIds: assistants[0]?.id ? [assistants[0].id] : [],
    };
    setSkills((prev) => [newSkill, ...prev]);
    setEditingSkill(newSkill);
  };

  // 保存 Skill 编辑
  const handleSaveSkill = () => {
    if (!editingSkill) return;
    setSkills((prev) => prev.map((s) => (s.id === editingSkill.id ? { ...editingSkill } : s)));
    setSaveNotice('已保存配置 ✔');
    setTimeout(() => setSaveNotice(''), 2000);
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

  // 技能编辑视图（严格对齐 AdminUI/技能编辑.png 与 技能概览.png）
  if (editingSkill) {
    const boundAssistants = assistants.filter((a) => editingSkill.boundAssistantIds.includes(a.id));

    return (
      <div className="admin-skill-editor-page">
        {/* 面包屑与顶部操作栏 */}
        <div className="admin-skill-editor-header">
          <div className="admin-skill-breadcrumb">
            <span
              className="admin-skill-breadcrumb-link"
              onClick={() => {
                handleSaveSkill();
                setEditingSkill(null);
              }}
            >
              Skills
            </span>
            <span className="admin-skill-breadcrumb-sep">›</span>
            <strong className="admin-skill-breadcrumb-current">{editingSkill.name}</strong>
          </div>

          <div className="admin-skill-header-actions">
            {saveNotice ? <span className="admin-save-notice">{saveNotice}</span> : null}
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => setShowAddAssistantModal(true)}
            >
              + 添加到智能体
            </button>
            <button
              type="button"
              className="settings-action-btn is-danger"
              onClick={() => handleDeleteSkill(editingSkill.id, editingSkill.name)}
              title="删除此技能"
            >
              🗑️
            </button>
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={handleSaveSkill}
            >
              保存
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
            概览
          </button>
          <button
            type="button"
            className={`admin-skill-tab-item${activeTab === 'files' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('files')}
          >
            文件 {editingSkill.filesCount}
          </button>
        </div>

        {activeTab === 'overview' ? (
          <div className="admin-skill-overview-content">
            {/* 模块一：属性 (AdminUI/技能编辑.png) */}
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

            {/* 模块二：被 X 个智能体使用 (AdminUI/技能编辑.png) */}
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
          <div className="admin-skill-files-view">
            <div className="admin-skill-file-item">
              <span>📄 SKILL.md</span>
              <span className="admin-skill-file-size">4.2 KB</span>
            </div>
            <div className="admin-skill-file-item">
              <span>📄 prompts/instruction.txt</span>
              <span className="admin-skill-file-size">1.8 KB</span>
            </div>
            <div className="admin-skill-file-item">
              <span>📄 references/rubric.json</span>
              <span className="admin-skill-file-size">8.5 KB</span>
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

  // 技能列表视图（严格对齐 AdminUI/技能展示.png）
  return (
    <div className="admin-skills-page-container">
      {/* 顶部标题与新建按钮 (AdminUI/技能展示.png) */}
      <div className="admin-skills-top-bar">
        <div className="admin-skills-title-group">
          <span className="admin-skills-top-icon">📖</span>
          <h1 className="admin-skills-title">Skills</h1>
          <span className="admin-skills-total-count">{skills.length}</span>
          <span className="admin-skills-tagline">工作区里任何智能体都能使用的指令。</span>
          <a href="#" className="admin-skills-learn-more">了解更多 →</a>
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

        <div className="admin-skills-filter-actions">
          <button type="button" className="admin-filter-pill-btn">
            <span>⚙️ 筛选</span>
          </button>
          <button type="button" className="admin-filter-pill-btn">
            <span>↓ 更新时间</span>
          </button>
        </div>
      </div>

      {/* 技能表格 (AdminUI/技能展示.png) */}
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
                  onClick={() => setEditingSkill(skill)}
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
                        onClick={() => setEditingSkill(skill)}
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
