'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminProjectTemplate, AdminTemplateVersionDetail } from '../../../../lib/api/content';
import {
  archiveAdminTemplate,
  createAdminTemplate,
  createAdminTemplateVersion,
  fetchAdminTemplateVersions,
  fetchAdminTemplates,
  updateAdminTemplate,
} from '../../../../lib/api/content';
import { fetchAdminTeamConfigs } from '../../../../lib/api/teams';
import type {
  AdminTeamConfig,
  ProjectTemplateSpec,
  PblTemplateSession,
} from '@qitu/contracts';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

/**
 * PBL 阶段设计（name / gateRule / stagePrompt / mentorRole）。
 *
 * 数据来源闭环：保存在模板版本的 `content.phases`（随版本冻结），
 * 打开编辑器时从 `GET /admin/project-templates/:id/versions` 的
 * 最新版本读回；页面不内置任何假数据。
 */
interface PblPhaseDesign {
  id: string;
  name: string;
  gateRule: string;
  stagePrompt: string;
  mentorRole: string;
}

/** 编辑器本地状态：模板元数据 + 从最新版本读出的阶段设计。 */
interface TemplateEditorState {
  id: string;
  status: string;
  title: string;
  summary: string;
  domain: string | null;
  ageRange: string | null;
  difficulty: string | null;
  estimatedDurationMinutes: number | null;
  learningObjectives: string[];
  linkedTeamId: string;
  phases: PblPhaseDesign[];
  /** 阶段设计取自哪个版本；null = 该模板还没有任何版本。 */
  sourceVersion: string | null;
  /** 若最新版本包含治理版 ProjectTemplateSpec，保存在此以供课时轨道展示并启用防呆 */
  pblSpec: ProjectTemplateSpec | null;
}

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  review: '审核中',
  published: '已发布',
  archived: '已归档',
};

const PHASE_META: Record<
  string,
  { label: string; tag: string; color: string; bg: string; border: string; mentor: string; defaultGate: string }
> = {
  exploration: {
    label: '探索破冰 (exploration)',
    tag: '探索',
    color: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
    mentor: '主导导师 (Lead Advisor)',
    defaultGate: 'student_confirmed_intent (探究意向书确认)',
  },
  concept_mastery: {
    label: '概念奠基 (concept_mastery)',
    tag: '概念',
    color: '#2563eb',
    bg: '#eff6ff',
    border: '#bfdbfe',
    mentor: '概念教练 (Concept Coach)',
    defaultGate: 'TheoryMastered (四大物理定律通关)',
  },
  guided_practice: {
    label: '探究实践 (guided_practice)',
    tag: '实践',
    color: '#16a34a',
    bg: '#f0fdf4',
    border: '#bbf7d0',
    mentor: '实验向导 (Lab Guide)',
    defaultGate: 'practice_artifact_approved (CER 实验报告通过)',
  },
  deliverable_review: {
    label: '成果答辩与归档 (deliverable_review)',
    tag: '答辩',
    color: '#9333ea',
    bg: '#faf5ff',
    border: '#e9d5ff',
    mentor: '评审导师 (Reviewer)',
    defaultGate: 'review_completed_and_archived (素养成长归档)',
  },
};

const GATE_DESCRIPTIONS: Record<
  string,
  { title: string; desc: string; badge: string; color: string; bg: string; border: string }
> = {
  TheoryMastered: {
    title: '【TheoryMastered 核心门禁】',
    desc: '四大物理定律（光的直线传播、反射定律、折射定律、全反射/透镜规律）评测全达标，解锁光具座搭建与实践操作权限',
    badge: '🛡️ 核心理论门禁',
    color: '#dc2626',
    bg: '#fef2f2',
    border: '#fecaca',
  },
  student_confirmed_intent: {
    title: '【意图确认门禁】',
    desc: '学生显式确认探究意向书草稿并立项，未确认前禁止创建正式项目',
    badge: '🚩 意向立项门禁',
    color: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
  },
  practice_artifact_approved: {
    title: '【实践成果门禁】',
    desc: '实验探究报告与 CER（主张-证据-推理）科学论证提交，需经导师审核通过',
    badge: '📝 成果评审门禁',
    color: '#16a34a',
    bg: '#f0fdf4',
    border: '#bbf7d0',
  },
  review_completed_and_archived: {
    title: '【结项归档门禁】',
    desc: '学科素养成长反思与量规自评由服务端 owner 正式完成归档',
    badge: '🎓 素养成长归档',
    color: '#9333ea',
    bg: '#faf5ff',
    border: '#e9d5ff',
  },
};

const SESSION_TYPE_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  theory: { label: '理论探究', icon: '📘', color: '#1d4ed8', bg: '#dbeafe' },
  practice: { label: '实验操作', icon: '🔬', color: '#15803d', bg: '#dcfce7' },
  review: { label: '答辩归档', icon: '📋', color: '#7e22ce', bg: '#f3e8ff' },
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 从版本数据解析阶段设计。只认版本里真实存在的字段：
 * - `content.phases` 是本页保存时写入的结构，优先使用；
 * - 治理版 `content.pbl` 的 `phases`；
 * - 否则退到版本冻结的 `stages`（id/label）生成骨架，其余字段留空由治理者补全；
 * - 两者都没有时返回空数组，页面展示诚实空态。
 */
function parsePhasesFromVersion(version: AdminTemplateVersionDetail): PblPhaseDesign[] {
  const content = (version.content ?? {}) as Record<string, unknown>;
  if (Array.isArray(content.phases)) {
    const parsed = content.phases
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item, index) => ({
        id: asText(item.id).trim() || `phase-${index + 1}`,
        name: asText(item.name),
        gateRule: asText(item.gateRule),
        stagePrompt: asText(item.stagePrompt),
        mentorRole: asText(item.mentorRole),
      }));
    if (parsed.length > 0) return parsed;
  }
  if (content.pbl && typeof content.pbl === 'object') {
    const pbl = content.pbl as ProjectTemplateSpec;
    if (Array.isArray(pbl.phases) && pbl.phases.length > 0) {
      return pbl.phases.map((phase, index) => ({
        id: phase.phase || `phase-${index + 1}`,
        name: phase.title || phase.phase,
        gateRule: phase.gateCondition || '',
        stagePrompt: `【${phase.title || phase.phase}】阶段主导角色：${phase.assignedAssistantId ?? '系统分配'}；交付物：${phase.deliverableType ?? '无'}`,
        mentorRole: phase.assignedAssistantId ?? '',
      }));
    }
  }
  return version.stages.map((stage, index) => ({
    id: stage.id || `phase-${index + 1}`,
    name: stage.label,
    gateRule: '',
    stagePrompt: '',
    mentorRole: '',
  }));
}

export default function AdminTemplatesPage() {
  const [templates, setTemplates] = useState<AdminProjectTemplate[]>([]);
  const [teams, setTeams] = useState<AdminTeamConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // 模板编辑视图状态
  const [editingTemplate, setEditingTemplate] = useState<TemplateEditorState | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<Error | null>(null);
  const [editorTab, setEditorTab] = useState<'basic' | 'workflow'>('workflow');
  const [saveNotice, setSaveNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tpls, teamList] = await Promise.all([
        fetchAdminTemplates(),
        fetchAdminTeamConfigs(),
      ]);
      setTeams(teamList);
      setTemplates(tpls);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('模板库加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 按需拉取某模板的版本数据，把最新版本的阶段设计读进编辑器。 */
  const loadVersions = useCallback(async (templateId: string) => {
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const versions = await fetchAdminTemplateVersions(templateId);
      const latest = versions.length > 0 ? versions[versions.length - 1] ?? null : null;
      setEditingTemplate((prev) => {
        if (prev === null || prev.id !== templateId) return prev;
        if (latest === null) return prev;
        const content = (latest.content ?? {}) as Record<string, unknown>;
        return {
          ...prev,
          phases: parsePhasesFromVersion(latest),
          linkedTeamId: asText(content.linkedTeamId),
          sourceVersion: latest.version,
        };
      });
    } catch (cause) {
      setVersionsError(cause instanceof Error ? cause : new Error('版本数据加载失败'));
    } finally {
      setVersionsLoading(false);
    }
  }, []);

  const openEditor = (template: AdminProjectTemplate) => {
    setSaveNotice('');
    setSaveError('');
    setEditorTab('workflow');
    setEditingTemplate({
      id: template.id,
      status: template.status,
      title: template.title,
      summary: template.summary,
      domain: template.domain,
      ageRange: template.ageRange,
      difficulty: template.difficulty,
      estimatedDurationMinutes: template.estimatedDurationMinutes,
      learningObjectives: template.learningObjectives ?? [],
      linkedTeamId: '',
      phases: [],
      sourceVersion: null,
    });
    void loadVersions(template.id);
  };

  const handleDeleteTemplate = async (id: string, title: string) => {
    if (!window.confirm(`确定要归档项目模板「${title}」吗？`)) return;
    setSaving(true);
    try {
      const result = await archiveAdminTemplate(id);
      setTemplates((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...result.template } : item)),
      );
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '模板归档失败');
    } finally {
      setSaving(false);
    }
    if (editingTemplate?.id === id) setEditingTemplate(null);
  };

  const handleCreateTemplate = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const created = await createAdminTemplate({
        schoolId: null,
        slug: `custom-pbl-${Date.now()}`,
        title: `自定义 PBL 项目模板 ${templates.length + 1}`,
        summary: '自定义项目式学习探索模板；阶段设计与导师提示词请在编辑器中补全。',
        domain: '跨学科探究',
        ageRange: '12-18',
        difficulty: 'medium',
        estimatedDurationMinutes: 720,
        learningObjectives: [],
      });
      setTemplates((prev) => [created.template, ...prev]);
      // 新模板还没有任何版本：直接进编辑器，由治理者补全阶段设计后保存生成 v1。
      openEditor(created.template);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '模板创建失败');
    } finally {
      setSaving(false);
    }
  };

  const updatePhase = (phaseId: string, patch: Partial<PblPhaseDesign>) => {
    setEditingTemplate((prev) => {
      if (prev === null) return prev;
      return {
        ...prev,
        phases: prev.phases.map((p) => (p.id === phaseId ? { ...p, ...patch } : p)),
      };
    });
  };

  const addPhase = () => {
    setEditingTemplate((prev) => {
      if (prev === null) return prev;
      const used = new Set(prev.phases.map((p) => p.id));
      let index = prev.phases.length + 1;
      while (used.has(`phase-${index}`)) index += 1;
      return {
        ...prev,
        phases: [
          ...prev.phases,
          { id: `phase-${index}`, name: '', gateRule: '', stagePrompt: '', mentorRole: '' },
        ],
      };
    });
  };

  const removePhase = (phaseId: string) => {
    setEditingTemplate((prev) => {
      if (prev === null) return prev;
      return { ...prev, phases: prev.phases.filter((p) => p.id !== phaseId) };
    });
  };

  const handleSaveTemplate = async () => {
    if (!editingTemplate) return;
    setSaveError('');
    setSaveNotice('');

    const phases = editingTemplate.phases.map((p) => ({
      ...p,
      name: p.name.trim(),
      gateRule: p.gateRule.trim(),
      stagePrompt: p.stagePrompt.trim(),
      mentorRole: p.mentorRole.trim(),
    }));
    const title = editingTemplate.title.trim();
    const summary = editingTemplate.summary.trim();
    if (title.length === 0 || summary.length === 0) {
      setSaveError('模板标题与摘要不能为空');
      return;
    }
    if (phases.some((p) => p.name.length === 0)) {
      setSaveError('存在未命名的阶段：请填写阶段名称，或删除该阶段');
      return;
    }

    // 后端约束：published 模板不可改元数据（只能加新版本）；archived 模板两者都不行。
    const canUpdateMeta = editingTemplate.status !== 'published' && editingTemplate.status !== 'archived';
    const canCreateVersion = editingTemplate.status !== 'archived';
    if (!canUpdateMeta && !(canCreateVersion && phases.length > 0)) {
      setSaveError('已归档模板不能编辑，也不能生成新版本');
      return;
    }

    setSaving(true);
    try {
      let notice: string;
      if (canUpdateMeta) {
        const result = await updateAdminTemplate(editingTemplate.id, {
          title,
          summary,
          domain: editingTemplate.domain,
          ageRange: editingTemplate.ageRange,
          difficulty: editingTemplate.difficulty,
          estimatedDurationMinutes: editingTemplate.estimatedDurationMinutes,
          learningObjectives: editingTemplate.learningObjectives,
        });
        setTemplates((prev) =>
          prev.map((t) => (t.id === result.template.id ? { ...t, ...result.template } : t)),
        );
        notice = '基础信息已保存 ✔';
      } else {
        notice = '';
      }

      if (canCreateVersion && phases.length > 0) {
        const result = await createAdminTemplateVersion(editingTemplate.id, {
          stages: phases.map((phase) => ({ id: phase.id, label: phase.name })),
          content: {
            phases,
            linkedTeamId: editingTemplate.linkedTeamId || null,
          },
        });
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === editingTemplate.id
              ? { ...t, status: result.template.status, latestPublishedVersionId: result.template.latestPublishedVersionId }
              : t,
          ),
        );
        setEditingTemplate((prev) =>
          prev === null || prev.id !== editingTemplate.id
            ? prev
            : { ...prev, phases, title, summary, sourceVersion: result.version.version },
        );
        notice = `阶段设计已保存为新版本 ${result.version.version} ✔`;
      } else if (phases.length === 0) {
        notice = `${notice ? `${notice}；` : ''}尚未添加任何阶段，未生成新版本`;
      }

      setSaveNotice(notice);
      window.setTimeout(() => {
        setSaveNotice('');
        setEditingTemplate(null);
      }, 900);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '模板保存失败');
    } finally {
      setSaving(false);
    }
  };

  const state = AdminStateViews({ loading, error, onRetry: load });
  if (state && templates.length === 0) return <div className="admin-settings-page">{state}</div>;

  // 模板与 PBL 流程编辑器
  if (editingTemplate) {
    const boundTeam = teams.find((t) => t.id === editingTemplate.linkedTeamId);
    const linkedTeamMissing =
      editingTemplate.linkedTeamId.length > 0 && boundTeam === undefined;

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
              编辑模板：{editingTemplate.title || '(未命名)'}
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {saveNotice ? <span className="admin-save-notice">{saveNotice}</span> : null}
            {saveError ? (
              <span className="admin-save-notice" style={{ color: '#ef4444' }}>
                {saveError}
              </span>
            ) : null}
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={handleSaveTemplate}
              disabled={saving || versionsLoading}
            >
              保存模板与阶段设计
            </button>
            <button
              type="button"
              className="settings-action-btn is-danger"
              onClick={() => handleDeleteTemplate(editingTemplate.id, editingTemplate.title)}
            >
              🗑️ 归档
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
            PBL 阶段设计与专属 Prompt
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
                {editingTemplate.sourceVersion !== null
                  ? `以下阶段设计读取自最新版本 ${editingTemplate.sourceVersion}；保存会生成新版本（历史版本冻结不可改）。`
                  : '该模板还没有已保存的版本；添加阶段并保存后会生成第一个版本。'}
              </span>
            </div>

            {versionsLoading ? (
              <div className="admin-template-workflow-intro">
                <span>正在加载版本数据…</span>
              </div>
            ) : versionsError ? (
              <div className="admin-template-workflow-intro">
                <span>阶段设计加载失败：{versionsError.message}</span>
                <button
                  type="button"
                  className="settings-action-btn"
                  style={{ marginLeft: '10px' }}
                  onClick={() => void loadVersions(editingTemplate.id)}
                >
                  重试
                </button>
              </div>
            ) : (
              <>
                {editingTemplate.phases.length === 0 ? (
                  <div className="settings-empty" style={{ padding: '24px', textAlign: 'center' }}>
                    <strong>该模板暂无已保存的阶段设计</strong>
                    <p style={{ margin: '8px 0 0', color: '#86909c', fontSize: '13px' }}>
                      点击下方「添加阶段」创建第一个阶段：填写阶段名称、门禁规则、导师角色与引导
                      Prompt；保存后会写入新版本，供 AI 搭档与项目工作流读取。
                    </p>
                  </div>
                ) : (
                  <div className="admin-template-phases-list">
                    {editingTemplate.phases.map((phase, idx) => (
                      <div key={phase.id} className="admin-template-phase-card">
                        <div className="admin-phase-card-header">
                          <div className="admin-phase-header-left">
                            <span className="admin-phase-index-badge">{idx + 1}</span>
                            <input
                              className="admin-input-text admin-phase-title-text"
                              style={{ maxWidth: '280px' }}
                              value={phase.name}
                              placeholder="阶段名称（必填）"
                              onChange={(e) => updatePhase(phase.id, { name: e.target.value })}
                            />
                            <input
                              className="admin-input-text"
                              style={{ maxWidth: '200px', fontSize: '12px' }}
                              value={phase.mentorRole}
                              placeholder="绑定导师角色"
                              onChange={(e) => updatePhase(phase.id, { mentorRole: e.target.value })}
                            />
                          </div>
                          <button
                            type="button"
                            className="admin-skill-dot-btn"
                            style={{ color: '#ef4444' }}
                            title="删除该阶段"
                            onClick={() => removePhase(phase.id)}
                          >
                            🗑️
                          </button>
                        </div>

                        <div className="admin-phase-card-body">
                          <div className="admin-phase-gate-box">
                            <span className="admin-phase-gate-label">🛡️ 阶段硬性门禁规则:</span>
                            <input
                              className="admin-input-text"
                              style={{ flex: 1 }}
                              value={phase.gateRule}
                              placeholder="例如：未通过理论掌握度检测前不得进入实践"
                              onChange={(e) => updatePhase(phase.id, { gateRule: e.target.value })}
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
                              onChange={(e) => updatePhase(phase.id, { stagePrompt: e.target.value })}
                              placeholder="在此配置该阶段导师的苏格拉底式发问策略与引导约束..."
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: '12px' }}>
                  <button type="button" className="settings-action-btn" onClick={addPhase}>
                    + 添加阶段
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="admin-template-basic-container">
            {editingTemplate.status === 'published' ? (
              <div className="admin-template-workflow-intro">
                <span>
                  该模板已发布：基础信息不可再修改，保存只会把阶段设计写入新版本。
                </span>
              </div>
            ) : null}
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
                    disabled={!canEditMeta(editingTemplate.status)}
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
                    disabled={!canEditMeta(editingTemplate.status)}
                    onChange={(e) =>
                      setEditingTemplate({ ...editingTemplate, summary: e.target.value })
                    }
                  />
                </div>
                <div className="admin-form-row">
                  <label className="admin-form-label">绑定导师团队</label>
                  {teams.length === 0 && !linkedTeamMissing ? (
                    <span style={{ fontSize: '12px', color: '#86909c' }}>
                      暂无可选导师团队（团队数据为空）
                    </span>
                  ) : (
                    <select
                      className="admin-select"
                      value={editingTemplate.linkedTeamId}
                      onChange={(e) =>
                        setEditingTemplate({ ...editingTemplate, linkedTeamId: e.target.value })
                      }
                    >
                      <option value="">（未绑定）</option>
                      {linkedTeamMissing ? (
                        <option value={editingTemplate.linkedTeamId}>
                          {editingTemplate.linkedTeamId}（不在当前团队列表）
                        </option>
                      ) : null}
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.id})
                        </option>
                      ))}
                    </select>
                  )}
                  {boundTeam ? (
                    <span style={{ fontSize: '12px', color: '#86909c', marginLeft: '8px' }}>
                      当前绑定：{boundTeam.name}
                    </span>
                  ) : null}
                </div>
                <div className="admin-form-row">
                  <label className="admin-form-label">预计时长 (分钟)</label>
                  <input
                    type="number"
                    className="admin-input-text"
                    value={editingTemplate.estimatedDurationMinutes ?? ''}
                    disabled={!canEditMeta(editingTemplate.status)}
                    onChange={(e) =>
                      setEditingTemplate({
                        ...editingTemplate,
                        estimatedDurationMinutes:
                          e.target.value === '' ? null : Number(e.target.value) || null,
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
            Admin 统一维护项目式学习（PBL）模板。阶段设计与导师提示词随模板版本冻结保存，修改即产生新版本。
          </div>
        </div>
        <div className="settings-page-actions">
          <button
            type="button"
            className="settings-action-btn is-primary"
            onClick={handleCreateTemplate}
            disabled={saving}
          >
            + 新建项目模板
          </button>
        </div>
      </div>

      {saveError ? (
        <div className="admin-template-workflow-intro" style={{ color: '#ef4444' }}>
          <span>{saveError}</span>
        </div>
      ) : null}

      {templates.length === 0 ? (
        <div className="settings-empty" style={{ padding: '32px', textAlign: 'center' }}>
          <strong>模板库为空</strong>
          <p style={{ margin: '8px 0 0', color: '#86909c', fontSize: '13px' }}>
            点击右上角「新建项目模板」创建第一个模板，然后在编辑器中补全阶段设计。
          </p>
        </div>
      ) : (
        <div className="admin-templates-cards-grid">
          {templates.map((template) => (
            <div key={template.id} className="admin-template-item-card">
              <div className="admin-template-item-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '24px' }}>📦</span>
                  <strong className="admin-template-item-title">{template.title}</strong>
                </div>
                <span className="admin-template-status-pill">
                  {STATUS_LABELS[template.status] ?? template.status}
                </span>
              </div>

              <p className="admin-template-item-desc">{template.summary || '暂无描述'}</p>

              <div className="admin-template-info-list">
                <div className="admin-template-info-row">
                  <span className="admin-template-info-label">适用领域:</span>
                  <span className="admin-template-info-val">{template.domain || '未设置'}</span>
                </div>
                <div className="admin-template-info-row">
                  <span className="admin-template-info-label">发布版本:</span>
                  <span className="admin-template-info-val">
                    {template.latestPublishedVersionId ? '已有发布版本' : '尚无发布版本'}
                  </span>
                </div>
              </div>

              <div
                className="admin-template-card-footer"
                style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
              >
                <button
                  type="button"
                  className="settings-action-btn is-primary"
                  style={{ flex: 1 }}
                  onClick={() => openEditor(template)}
                >
                  配置团队与阶段设计 →
                </button>
                <button
                  type="button"
                  className="admin-skill-dot-btn"
                  style={{ color: '#ef4444' }}
                  onClick={() => handleDeleteTemplate(template.id, template.title)}
                  title="归档模板"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 与后端约束一致：published / archived 模板的元数据不可再修改。 */
function canEditMeta(status: string): boolean {
  return status !== 'published' && status !== 'archived';
}
