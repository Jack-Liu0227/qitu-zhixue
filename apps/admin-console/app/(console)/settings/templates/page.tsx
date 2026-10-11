'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminProjectTemplate } from '../../../../lib/api/content';
import { fetchAdminTemplates } from '../../../../lib/api/content';
import { fetchAdminTeamConfigs } from '../../../../lib/api/teams';
import type { AdminTeamConfig } from '@qitu/contracts';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

interface PblPhaseDesign {
  id: string;
  name: string;
  gateRule: string;
  stagePrompt: string;
  mentorRole: string;
}

interface EditableTemplate extends AdminProjectTemplate {
  linkedTeamId: string;
  phases: PblPhaseDesign[];
}

const DEFAULT_PHASES: Record<string, PblPhaseDesign[]> = {
  'template-python-mini-project': [
    {
      id: 'phase-1',
      name: '意图确认与项目开题',
      gateRule: '学生必须明确战机操控与关卡设想，禁止未确认即创建项目',
      stagePrompt: '你负责引导学生阐述雷霆战机的游戏构想（飞船移动、子弹发射、敌机刷新），启发其拆解开发目标，不得直接提供现成代码。',
      mentorRole: '雷霆战机总导师',
    },
    {
      id: 'phase-2',
      name: '核心机制探究 (TheoryMastered 硬性门禁)',
      gateRule: '必须掌握 Pygame 事件循环与 AABB 碰撞检测数学原理后方可进入代码编写',
      stagePrompt: '严格坚持苏格拉底式发问！询问学生“如果两架飞机的矩形边界相交，X轴和Y轴的坐标差满足什么条件？”引导学生推导 AABB 包围盒公式。在学生完全掌握理论前，坚决不进入实践环节。',
      mentorRole: '原理教练',
    },
    {
      id: 'phase-3',
      name: '工程实践与模块编码',
      gateRule: '必须在沙箱中成功运行并通过主循环帧率与按键事件自检',
      stagePrompt: '作为代码向导，指导学生分步编写 Player 精灵类、Bullet 队列与 Enemy 碰撞检测。遇到报错时，引导学生阅读 Traceback 错误栈。',
      mentorRole: '代码向导',
    },
    {
      id: 'phase-4',
      name: '作品答辩与概念反思',
      gateRule: '完成答辩质询量规测评，生成永久成长档案',
      stagePrompt: '针对学生的雷霆战机代码提出2-3个概念质询问题（例如“如果增加爆炸动画，你的事件循环需要做哪些改造？”），评估其真实掌握度。',
      mentorRole: '答辩导师',
    },
  ],
  'template-kinetic-energy': [
    {
      id: 'phase-1',
      name: '生活现象观察与开题',
      gateRule: '学生阐述滑板加速或小车冲坡观察，确认实验假设',
      stagePrompt: '引导学生观察小车在不同拉力作用下的加速现象，提出探究问题：力对物体做功的大小与物体的速度变化有什么定量联系？',
      mentorRole: '动手学动能定理总导师',
    },
    {
      id: 'phase-2',
      name: '动能定理公式推导 (TheoryMastered)',
      gateRule: '推导恒力做功 W=F·s 与动能变化 ΔEk=½mv₂²-½mv₁²，通过测验',
      stagePrompt: '引导学生从牛顿第二定律 a=F/m 和运动学公式 v₂²-v₁²=2as 出发，推导合外力做功与动能定理的关系，完成理论建构。',
      mentorRole: '物理概念教练',
    },
    {
      id: 'phase-3',
      name: 'Python 物理数值仿真与绘图',
      gateRule: '完成 Matplotlib 功-能折线图绘制与数据拟合验证',
      stagePrompt: '指导学生使用 Python 数值模拟不同初速度和小车质量下的动能变化曲线，检查动能误差是否在 5% 以内。',
      mentorRole: '物理仿真向导',
    },
    {
      id: 'phase-4',
      name: '实验报告答辩与反思',
      gateRule: '提交实验报告与数据可复现证据包',
      stagePrompt: '向学生发问：“如果考虑摩擦阻力，合外力做功如何修正？机械能守恒与动能定理有什么区别与联系？”',
      mentorRole: '答辩导师',
    },
  ],
};

export default function AdminTemplatesPage() {
  const [templates, setTemplates] = useState<EditableTemplate[]>([]);
  const [teams, setTeams] = useState<AdminTeamConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // 模板编辑视图状态
  const [editingTemplate, setEditingTemplate] = useState<EditableTemplate | null>(null);
  const [editorTab, setEditorTab] = useState<'basic' | 'workflow'>('workflow');
  const [saveNotice, setSaveNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tpls, teamList] = await Promise.all([
        fetchAdminTemplates().catch(() => []),
        fetchAdminTeamConfigs().catch(() => []),
      ]);

      setTeams(teamList);

      const merged: EditableTemplate[] = tpls.map((t) => {
        const phases = DEFAULT_PHASES[t.id] || [
          {
            id: 'phase-1',
            name: '意图确认',
            gateRule: '确认探究意图与任务目标',
            stagePrompt: '引导学生自主阐述项目构想与目标。',
            mentorRole: '总导师',
          },
          {
            id: 'phase-2',
            name: '核心理论探究 (TheoryMastered)',
            gateRule: '理论掌握度硬性门禁，未达标前不得进入实践',
            stagePrompt: '苏格拉底式发问，引导学生自主掌握原理。',
            mentorRole: '原理教练',
          },
          {
            id: 'phase-3',
            name: '工程实践',
            gateRule: '沙箱验证与成果提交',
            stagePrompt: '指导学生在沙箱中实践。',
            mentorRole: '代码向导',
          },
          {
            id: 'phase-4',
            name: '答辩反思',
            gateRule: '量规质询与学情记录',
            stagePrompt: '评估真实掌握度与反思归档。',
            mentorRole: '答辩导师',
          },
        ];

        const linkedTeamId = t.id.includes('python') || t.id.includes('thunder')
          ? 'team-thunder-fighter-pbl'
          : 'team-kinetic-energy-pbl';

        return {
          ...t,
          linkedTeamId,
          phases,
        };
      });

      setTemplates(merged);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('模板库加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDeleteTemplate = (id: string, title: string) => {
    if (!window.confirm(`确定要删除项目模板「${title}」吗？`)) return;
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    if (editingTemplate?.id === id) setEditingTemplate(null);
  };

  const handleCreateTemplate = () => {
    const newTpl: EditableTemplate = {
      id: `template-${Date.now()}`,
      title: `自定义 PBL 项目模板 ${templates.length + 1}`,
      slug: `custom-pbl-${templates.length + 1}`,
      summary: '自定义项目式学习探索模板，包含从意图确认到答辩反思的全流程。',
      status: 'draft',
      domain: '跨学科探究',
      level: 'intermediate',
      suggestedDurationHours: 12,
      theoryGateConcept: '核心物理或编程概念',
      linkedTeamId: teams[0]?.id || 'team-thunder-fighter-pbl',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      phases: [
        {
          id: 'phase-1',
          name: '意图确认与开题',
          gateRule: '确认探究意图与任务目标',
          stagePrompt: '引导学生阐述项目构想，拆解探究目标。',
          mentorRole: '总导师',
        },
        {
          id: 'phase-2',
          name: '核心理论推导 (TheoryMastered 门禁)',
          gateRule: '理论掌握度硬性门禁，未达标前严禁进入编码实践',
          stagePrompt: '严格坚持苏格拉底式启发引导，通过概念反问检验掌握度。',
          mentorRole: '原理教练',
        },
        {
          id: 'phase-3',
          name: '工程实践与编码',
          gateRule: '沙箱验证与功能测试',
          stagePrompt: '指导学生在沙箱中分步编写代码并定位错误。',
          mentorRole: '代码向导',
        },
        {
          id: 'phase-4',
          name: '成果答辩与反思',
          gateRule: '量规质询与成长档案归档',
          stagePrompt: '提出2-3个概念质询问题评估真实掌握度。',
          mentorRole: '答辩导师',
        },
      ],
    };
    setTemplates((prev) => [newTpl, ...prev]);
    setEditingTemplate(newTpl);
  };

  const handleSaveTemplate = () => {
    if (!editingTemplate) return;
    setTemplates((prev) =>
      prev.map((t) => (t.id === editingTemplate.id ? { ...editingTemplate } : t))
    );
    setSaveNotice('模板与阶段 Prompt 配置已保存 ✔');
    setTimeout(() => {
      setSaveNotice('');
      setEditingTemplate(null);
    }, 600);
  };

  const state = AdminStateViews({ loading, error, onRetry: load });
  if (state && templates.length === 0) return <div className="admin-settings-page">{state}</div>;

  // 模板与 PBL 流程编辑器
  if (editingTemplate) {
    const boundTeam = teams.find((t) => t.id === editingTemplate.linkedTeamId);

    return (
      <div className="admin-template-editor-view">
        <div className="admin-template-editor-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              className="admin-assistant-back-btn"
              onClick={() => setEditingTemplate(null)}
            >
              ← 返回模板列表
            </button>
            <h1 style={{ fontSize: '18px', margin: 0, fontWeight: 700, color: '#1d2129' }}>
              编辑模板：{editingTemplate.title}
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {saveNotice ? <span className="admin-save-notice">{saveNotice}</span> : null}
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={handleSaveTemplate}
            >
              保存模板与提示词
            </button>
            <button
              type="button"
              className="settings-action-btn is-danger"
              onClick={() => handleDeleteTemplate(editingTemplate.id, editingTemplate.title)}
            >
              🗑️ 删除
            </button>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => setEditingTemplate(null)}
            >
              取消
            </button>
          </div>
        </div>

        {/* 选项卡：基础配置 vs PBL 流程与阶段提示词 */}
        <div className="team-editor-top-tabs">
          <button
            type="button"
            className={`team-editor-tab-item${editorTab === 'workflow' ? ' is-active' : ''}`}
            onClick={() => setEditorTab('workflow')}
          >
            PBL 四阶段设计与专属 Prompt
          </button>
          <button
            type="button"
            className={`team-editor-tab-item${editorTab === 'basic' ? ' is-active' : ''}`}
            onClick={() => setEditorTab('basic')}
          >
            基础信息与团队绑定
          </button>
        </div>

        {editorTab === 'workflow' ? (
          <div className="admin-template-workflow-container">
            <div className="admin-template-workflow-intro">
              <strong>PBL 教学全流程设计与门禁管控：</strong>
              <span>
                每个阶段均绑定专属导师角色与 Prompt。TheoryMastered 硬性门禁确保学生在通过理论验证前无法直接进入实践开发。
              </span>
            </div>

            <div className="admin-template-phases-list">
              {editingTemplate.phases.map((phase, idx) => (
                <div key={phase.id} className="admin-template-phase-card">
                  <div className="admin-phase-card-header">
                    <div className="admin-phase-header-left">
                      <span className="admin-phase-index-badge">{idx + 1}</span>
                      <strong className="admin-phase-title-text">{phase.name}</strong>
                      <span className="admin-phase-mentor-tag">绑定角色: {phase.mentorRole}</span>
                    </div>
                  </div>

                  <div className="admin-phase-card-body">
                    <div className="admin-phase-gate-box">
                      <span className="admin-phase-gate-label">🛡️ 阶段硬性门禁规则:</span>
                      <input
                        className="admin-input-text"
                        style={{ flex: 1 }}
                        value={phase.gateRule}
                        onChange={(e) => {
                          const updated = editingTemplate.phases.map((p) =>
                            p.id === phase.id ? { ...p, gateRule: e.target.value } : p
                          );
                          setEditingTemplate({ ...editingTemplate, phases: updated });
                        }}
                      />
                    </div>

                    <div className="admin-phase-prompt-box">
                      <label className="admin-phase-prompt-label">
                        阶段引导 Prompt (系统提示词):
                      </label>
                      <textarea
                        className="admin-prompt-editor-box"
                        rows={6}
                        value={phase.stagePrompt}
                        onChange={(e) => {
                          const updated = editingTemplate.phases.map((p) =>
                            p.id === phase.id ? { ...p, stagePrompt: e.target.value } : p
                          );
                          setEditingTemplate({ ...editingTemplate, phases: updated });
                        }}
                        placeholder="在此配置该阶段导师的苏格拉底式发问策略与引导约束..."
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="admin-template-basic-container">
            <section className="admin-editor-card">
              <div className="admin-editor-card-header">
                <span className="admin-editor-section-title">基本属性</span>
              </div>
              <div className="admin-identity-fields" style={{ padding: '16px 20px' }}>
                <div className="admin-form-row">
                  <label className="admin-form-label">模板标题</label>
                  <input
                    className="admin-input-text"
                    value={editingTemplate.title}
                    onChange={(e) =>
                      setEditingTemplate({ ...editingTemplate, title: e.target.value })
                    }
                  />
                </div>
                <div className="admin-form-row">
                  <label className="admin-form-label">模板摘要</label>
                  <textarea
                    className="team-textarea"
                    value={editingTemplate.summary}
                    onChange={(e) =>
                      setEditingTemplate({ ...editingTemplate, summary: e.target.value })
                    }
                  />
                </div>
                <div className="admin-form-row">
                  <label className="admin-form-label">绑定导师团队</label>
                  <select
                    className="admin-select"
                    value={editingTemplate.linkedTeamId}
                    onChange={(e) =>
                      setEditingTemplate({ ...editingTemplate, linkedTeamId: e.target.value })
                    }
                  >
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.id})
                      </option>
                    ))}
                    {teams.length === 0 ? (
                      <>
                        <option value="team-thunder-fighter-pbl">雷霆战机小游戏 PBL 导师团队</option>
                        <option value="team-kinetic-energy-pbl">动手学动能定理 PBL 导师团队</option>
                      </>
                    ) : null}
                  </select>
                </div>
                <div className="admin-form-row">
                  <label className="admin-form-label">预计时长 (分钟)</label>
                  <input
                    type="number"
                    className="admin-input-text"
                    value={editingTemplate.estimatedDurationMinutes || 60}
                    onChange={(e) =>
                      setEditingTemplate({
                        ...editingTemplate,
                        estimatedDurationMinutes: Number(e.target.value) || 60,
                      })
                    }
                  />
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="admin-settings-page">
      <div className="settings-pagehead">
        <div className="settings-titlebox">
          <h1>项目模板库</h1>
          <div className="settings-desc">
            Admin 统一维护项目式学习（PBL）模板。模板深度绑定指定导师团队，配置四阶段门禁与苏格拉底式引导 Prompt。
          </div>
        </div>
        <div className="settings-page-actions">
          <button
            type="button"
            className="settings-action-btn is-primary"
            onClick={handleCreateTemplate}
          >
            + 新建项目模板
          </button>
        </div>
      </div>

      <div className="admin-templates-cards-grid">
        {templates.map((template) => {
          const boundTeam = teams.find((t) => t.id === template.linkedTeamId);
          const teamName = boundTeam?.name || (template.id.includes('python') || template.id.includes('thunder') ? '雷霆战机小游戏 PBL 导师团队' : '动手学动能定理 PBL 导师团队');

          return (
            <div key={template.id} className="admin-template-item-card">
              <div className="admin-template-item-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '24px' }}>
                    {template.id.includes('python') || template.id.includes('thunder') ? '🚀' : '⚡'}
                  </span>
                  <strong className="admin-template-item-title">{template.title}</strong>
                </div>
                <span className="admin-template-status-pill">{template.status || '已发布'}</span>
              </div>

              <p className="admin-template-item-desc">{template.summary || '暂无描述'}</p>

              <div className="admin-template-info-list">
                <div className="admin-template-info-row">
                  <span className="admin-template-info-label">绑定导师团队:</span>
                  <span className="admin-template-info-val">👥 {teamName}</span>
                </div>
                <div className="admin-template-info-row">
                  <span className="admin-template-info-label">PBL 阶段流程:</span>
                  <span className="admin-template-info-val">4 阶段 (含 TheoryMastered 门禁)</span>
                </div>
                <div className="admin-template-info-row">
                  <span className="admin-template-info-label">适用领域:</span>
                  <span className="admin-template-info-val">{template.domain || '编程与物理科学'}</span>
                </div>
              </div>

              <div className="admin-template-card-footer" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="settings-action-btn is-primary"
                  style={{ flex: 1 }}
                  onClick={() => setEditingTemplate(template)}
                >
                  配置团队与四阶段 Prompt →
                </button>
                <button
                  type="button"
                  className="admin-skill-dot-btn"
                  style={{ color: '#ef4444' }}
                  onClick={() => handleDeleteTemplate(template.id, template.title)}
                  title="删除模板"
                >
                  🗑️
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
