'use client';

import { VisualAsset } from '@qitu/ui';
import { TemplateTeamBindingPanel } from '../../../../lib/components/TemplateTeamBindingPanel';
import { VisualSelector } from '../../../../lib/components/VisualAssetPicker';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminProjectTemplate, AdminTemplateVersionDetail } from '../../../../lib/api/content';
import {
  deleteAdminTemplate,
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
  phases: PblPhaseDesign[];
  sourcePhases: PblPhaseDesign[];
  /** 阶段设计取自哪个版本；null = 该模板还没有任何版本。 */
  sourceVersion: string | null;
  sourceVersionId: string | null;
  sourceContent: Record<string, unknown>;
  sourceStages: AdminTemplateVersionDetail['stages'];
  sourceRubric: unknown[];
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
  theory: { label: '理论探究', icon: 'activity-concept-v1', color: '#1d4ed8', bg: '#dbeafe' },
  practice: { label: '实验操作', icon: 'activity-experiment-v1', color: '#15803d', bg: '#dcfce7' },
  review: { label: '答辩归档', icon: 'activity-reflection-v1', color: '#7e22ce', bg: '#f3e8ff' },
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
  const [templateVersions, setTemplateVersions] = useState<AdminTemplateVersionDetail[]>([]);
  const [editorTab, setEditorTab] = useState<'sessions' | 'workflow' | 'basic'>('workflow');

  const [saveNotice, setSaveNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const displayedTemplates = templates;

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
  const versionRequest = useRef(0);
  const loadVersions = useCallback(async (templateId: string, preferredVersionId?: string) => {
    const request = ++versionRequest.current;
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const versions = await fetchAdminTemplateVersions(templateId);
      if (request !== versionRequest.current) return;
      setTemplateVersions(versions);
      const latest = versions.find((version) => version.id === preferredVersionId)
        ?? versions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
      const params = new URLSearchParams(window.location.search);
      params.set('templateId', templateId);
      if (latest) params.set('versionId', latest.id); else params.delete('versionId');
      window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
      setEditingTemplate((prev) => {
        if (prev === null || prev.id !== templateId) return prev;
        if (latest === null) return prev;
        const content = (latest.content ?? {}) as Record<string, unknown>;
        const pblSpec =
          content.pbl && typeof content.pbl === 'object'
            ? (content.pbl as ProjectTemplateSpec)
            : null;
        if (pblSpec) {
          setEditorTab('sessions');
        }
        return {
          ...prev,
          phases: parsePhasesFromVersion(latest),
          sourcePhases: parsePhasesFromVersion(latest),
          sourceVersion: latest.version,
          sourceVersionId: latest.id, sourceContent: latest.content, sourceStages: latest.stages, sourceRubric: latest.rubric,
          pblSpec,
        };
      });
    } catch (cause) {
      if (request !== versionRequest.current) return;
      setVersionsError(cause instanceof Error ? cause : new Error('版本数据加载失败'));
    } finally {
      if (request === versionRequest.current) setVersionsLoading(false);
    }
  }, []);

  const openEditor = useCallback((template: AdminProjectTemplate, versionId?: string) => {
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
      phases: [],
      sourcePhases: [],
      sourceVersion: null,
      sourceVersionId: null, sourceContent: {}, sourceStages: [], sourceRubric: [],
      pblSpec: null,
    });
    void loadVersions(template.id, versionId);
  }, [loadVersions]);

  useEffect(() => {
    if (loading || error || editingTemplate) return;
    const params = new URLSearchParams(window.location.search);
    const template = templates.find((item) => item.id === params.get('templateId'));
    if (template) openEditor(template, params.get('versionId') ?? undefined);
  }, [loading, error, templates, editingTemplate, openEditor]);

  const closeEditor = () => {
    versionRequest.current++;
    const params = new URLSearchParams(window.location.search);
    params.delete('templateId'); params.delete('versionId');
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
    setEditingTemplate(null);
  };

  const handleDeleteTemplate = async (id: string, title: string) => {
    if (!window.confirm(`确定要彻底删除项目模板「${title}」吗？
此操作将直接从数据库中物理删除该模板及其全部版本，无法恢复。`)) return;
    setSaving(true);
    setSaveError('');
    try {
      await deleteAdminTemplate(id);
      setTemplates((prev) => prev.filter((item) => item.id !== id));
      if (editingTemplate?.id === id) closeEditor();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '模板删除失败');
    } finally {
      setSaving(false);
    }
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
    if (!canUpdateMeta && !(canCreateVersion && (editingTemplate.pblSpec || phases.length > 0))) {
      setSaveError('已归档模板不能编辑，也不能生成新版本');
      return;
    }

    const versionChanged = !editingTemplate.pblSpec && phases.length > 0
      && (!editingTemplate.sourceVersionId || JSON.stringify(phases) !== JSON.stringify(editingTemplate.sourcePhases));
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
        const readback = (await fetchAdminTemplates()).find((row) => row.id === result.template.id);
        if (!readback || readback.updatedAt !== result.template.updatedAt) throw new Error('基础信息回读未确认，请重新加载核对');
        notice = '基础信息已保存并回读确认';
      } else {
        notice = '';
      }

      if (canCreateVersion && versionChanged) {
        const content = { ...editingTemplate.sourceContent };
        delete content.bootstrapKey;
        const result = await createAdminTemplateVersion(editingTemplate.id, {
          stages: editingTemplate.pblSpec ? editingTemplate.sourceStages : phases.map((phase) => ({ id: phase.id, label: phase.name })),
          rubric: editingTemplate.sourceRubric,
          content: {
            ...content,
            ...(!editingTemplate.pblSpec ? { phases } : {}),
          },
        });
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === editingTemplate.id
              ? { ...t, status: result.template.status, latestPublishedVersionId: result.template.latestPublishedVersionId }
              : t,
          ),
        );
        const readback = (await fetchAdminTemplateVersions(editingTemplate.id)).find((version) => version.id === result.version.id);
        if (!readback || JSON.stringify(parsePhasesFromVersion(readback)) !== JSON.stringify(phases)) throw new Error('版本保存后的阶段设计回读不一致，请重新加载核对。');
        setTemplateVersions((previous) => [...previous.filter((item) => item.id !== readback.id), readback]);
        const params = new URLSearchParams(window.location.search);
        params.set('versionId', readback.id);
        window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
        setEditingTemplate((prev) =>
          prev === null || prev.id !== editingTemplate.id
            ? prev
            : { ...prev, phases, sourcePhases: phases, title, summary, sourceVersion: readback.version, sourceVersionId: readback.id, sourceContent: readback.content, sourceStages: readback.stages, sourceRubric: readback.rubric },
        );
        notice = `阶段设计已保存为新版本 ${result.version.version} ✔`;
      } else if (phases.length === 0) {
        notice = `${notice ? `${notice}；` : ''}尚未添加任何阶段，未生成新版本`;
      }

      setSaveNotice(notice || '课程内容未变更，保留当前版本和团队绑定。');

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
    const selectedVersion = templateVersions.find((version) => version.id === editingTemplate.sourceVersionId);
    const lessonProfile = editingTemplate.pblSpec?.curriculum?.profiles?.[0];
    const lessonSessions = lessonProfile?.sessions ?? [];
    const lessonCount = lessonProfile?.schedule.lessonCount ?? lessonSessions.length;
    const lessonMinutes = lessonProfile?.schedule.lessonMinutes ?? lessonSessions[0]?.durationMinutes ?? 60;

    return (
      <div className="admin-template-editor-view">
        <div className="admin-template-editor-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              className="admin-assistant-back-btn"
              onClick={closeEditor}
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
            {editingTemplate.pblSpec ? (
              <span
                style={{
                  backgroundColor: '#e8f3ff',
                  color: '#165dff',
                  border: '1px solid #bedaff',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
                title="该模板由 ProjectTemplateSpec 治理，需通过版本发布流程更新"
              >
                课程合同受保护 · 团队配置可编辑
              </span>
            ) : null}
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={handleSaveTemplate}
              disabled={saving || versionsLoading || !!versionsError || (editingTemplate.pblSpec !== null && !canEditMeta(editingTemplate.status))}
              title={editingTemplate.pblSpec ? '采用 ProjectTemplateSpec 治理，需通过版本发布流程更新' : undefined}
            >
              {editingTemplate.pblSpec ? canEditMeta(editingTemplate.status) ? '保存基础信息' : '课程已发布' : '保存模板与阶段设计'}
            </button>
            <button
              type="button"
              className="settings-action-btn is-danger"
              onClick={() => handleDeleteTemplate(editingTemplate.id, editingTemplate.title)}
            >
              🗑️ 删除模板
            </button>
            <button
              type="button"
              className="settings-action-btn"
              onClick={closeEditor}
            >
              取消
            </button>
          </div>
        </div>

        {/* 选项卡：课时教学主线 vs 基础配置 */}
        <label>课程版本 <select className="admin-select" aria-label="课程版本" value={editingTemplate.sourceVersionId ?? ''} disabled={versionsLoading || saving}
          onChange={(event) => { setSaveNotice(''); setSaveError(''); void loadVersions(editingTemplate.id, event.target.value); }}>
          {!selectedVersion && <option value="">尚无版本</option>}
          {templateVersions.map((version) => <option key={version.id} value={version.id}>{version.version} · {STATUS_LABELS[version.status] ?? version.status}</option>)}
        </select></label>
        <TemplateTeamBindingPanel key={editingTemplate.sourceVersionId} templateId={editingTemplate.id} versionId={versionsLoading || versionsError ? null : editingTemplate.sourceVersionId}
          versionStatus={selectedVersion?.status ?? 'draft'} profiles={editingTemplate.pblSpec?.curriculum?.profiles ?? []} phases={editingTemplate.pblSpec?.phases ?? []} requiresBundle={editingTemplate.pblSpec !== null} teams={teams} />
        <div className="team-editor-top-tabs">
          {editingTemplate.pblSpec ? (
            <button
              type="button"
              className={`team-editor-tab-item${editorTab === 'sessions' ? ' is-active' : ''}`}
              onClick={() => setEditorTab('sessions')}
            >
              📅 课时教学主线（{lessonCount} 课时）
            </button>
          ) : (
            <button
              type="button"
              className={`team-editor-tab-item${editorTab === 'workflow' ? ' is-active' : ''}`}
              onClick={() => setEditorTab('workflow')}
            >
              PBL 教学编排与专属 Prompt
            </button>
          )}
          <button
            type="button"
            className={`team-editor-tab-item${editorTab === 'basic' ? ' is-active' : ''}`}
            onClick={() => setEditorTab('basic')}
          >
            基础信息
          </button>
        </div>

        {editorTab === 'sessions' && editingTemplate.pblSpec ? (
          <div className="admin-template-workflow-container">
            {/* 顶栏宏观概览 */}
            <div
              className="admin-template-workflow-intro"
              style={{
                borderLeft: '4px solid #165dff',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                padding: '16px 20px',
                borderRadius: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <strong style={{ fontSize: '15px', color: '#0f172a' }}>
                    🛡️ {lessonCount} 课时教学主线（ProjectTemplateSpec 治理版 · {editingTemplate.pblSpec.version || editingTemplate.sourceVersion || 'v2'}）
                  </strong>
                  <span
                    style={{
                      fontSize: '12px',
                      background: '#e8f3ff',
                      color: '#165dff',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontWeight: 600,
                    }}
                  >
                    治理策略解耦架构 · standard-stem-pbl:v1
                  </span>
                </div>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  共 {lessonCount} 课时（每课时 {lessonMinutes} 分钟）
                </span>
              </div>
              <p style={{ margin: '8px 0 4px', color: '#334155', fontSize: '13px', lineHeight: 1.6 }}>
                <strong>驱动性问题：</strong> {editingTemplate.pblSpec.theme?.drivingQuestion || editingTemplate.pblSpec.description}
              </p>
              {editingTemplate.pblSpec.safetyRequirements && editingTemplate.pblSpec.safetyRequirements.length > 0 ? (
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', padding: '8px 12px', borderRadius: '6px' }}>
                  <strong>⚠️ 安全与实践要求：</strong> {editingTemplate.pblSpec.safetyRequirements.join('；')}
                </div>
              ) : null}
            </div>

            {/* A lesson card is the schedule unit; phase is shown only as governance metadata. */}
            <div className="admin-template-phases-list">
              {lessonSessions.map((session: PblTemplateSession) => {
                const phaseMeta = PHASE_META[session.phase] ?? {
                  label: session.phase,
                  tag: session.phase,
                  color: '#4e5969',
                  bg: '#f2f3f5',
                  border: '#e5e6eb',
                  mentor: '导师',
                  defaultGate: '无',
                };
                const typeMeta = SESSION_TYPE_META[session.sessionType] ?? {
                  label: session.sessionType,
                  icon: '📌',
                  color: '#4e5969',
                  bg: '#f2f3f5',
                };
                const gateId = session.checkpoint?.requiredGate;
                const gateInfo = gateId ? GATE_DESCRIPTIONS[gateId] : null;

                return (
                  <div
                    key={session.id || `session-${session.sessionIndex}`}
                    className="admin-template-phase-card"
                    style={{ borderLeft: `5px solid ${phaseMeta.color}` }}
                  >
                    {/* 头部标题与标签 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            background: phaseMeta.color,
                            color: '#ffffff',
                            fontSize: '13px',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {session.sessionIndex}
                        </span>
                        <strong style={{ fontSize: '16px', color: '#1d2129' }}>
                          第 {session.sessionIndex} 课时：{session.title}
                        </strong>
                        <span
                          style={{
                            fontSize: '12px',
                            color: typeMeta.color,
                            background: typeMeta.bg,
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontWeight: 500,
                          }}
                        >
                          <VisualAsset assetId={typeMeta.icon} size={20} /> {typeMeta.label}
                        </span>
                      </div>
                      <span style={{ fontSize: '12px', color: '#4e5969', fontWeight: 600 }}>
                        ⏱️ {session.durationMinutes} 分钟
                      </span>
                    </div>

                    {/* 门禁卡片 */}
                    {gateInfo ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '10px',
                          padding: '10px 14px',
                          background: gateInfo.bg,
                          border: `1px solid ${gateInfo.border}`,
                          borderRadius: '8px',
                        }}
                      >
                        <span style={{ fontSize: '16px' }}>🚩</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <strong style={{ color: gateInfo.color, fontSize: '13px' }}>{gateInfo.title}</strong>
                            <span style={{ fontSize: '11px', background: '#ffffff', color: gateInfo.color, border: `1px solid ${gateInfo.border}`, padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                              {gateInfo.badge}
                            </span>
                          </div>
                          <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: gateInfo.color, lineHeight: 1.5 }}>
                            {gateInfo.desc}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {/* 微观仿真挂载 */}
                    {session.interactiveSpec?.enabled ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px 12px',
                          background: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          borderRadius: '6px',
                          fontSize: '12.5px',
                          color: '#166534',
                        }}
                      >
                        <span><VisualAsset assetId="activity-experiment-v1" size={24} /></span>
                        <span>
                          <strong>挂载微观仿真原型：</strong>
                          <code style={{ background: '#dcfce7', padding: '2px 6px', borderRadius: '4px', margin: '0 4px', fontFamily: 'monospace' }}>
                            {session.interactiveSpec.domainTopic}
                          </code>
                          （{session.interactiveSpec.allowHypothesisPrediction ? '支持' : '限制'}假设预测对比；区分模型计算、模拟观察与真实测量）
                        </span>
                      </div>
                    ) : null}

                    {/* 课时目标 */}
                    {session.learningGoal ? (
                      <div style={{ fontSize: '13px', color: '#1d2129', lineHeight: 1.6, background: '#f7f8fa', padding: '10px 14px', borderRadius: '8px' }}>
                        <strong>🎯 本节学习目标：</strong>
                        <span>{session.learningGoal}</span>
                      </div>
                    ) : null}

                    {/* 5 步教学活动时间分配 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#86909c' }}>
                        <span>⏳ 课堂教学活动时间分配：</span>
                        <span>
                          回顾 {session.blocks.review}m · 理论 {session.blocks.theory}m · 测验 {session.blocks.check}m · 实践 {session.blocks.practice}m · 反思 {session.blocks.reflect}m
                        </span>
                      </div>
                      <div style={{ display: 'flex', height: '10px', borderRadius: '5px', overflow: 'hidden', background: '#e5e6eb' }}>
                        {session.blocks.review > 0 ? (
                          <div style={{ width: `${(session.blocks.review / session.durationMinutes) * 100}%`, background: '#f59e0b' }} title={`回顾: ${session.blocks.review}分钟`} />
                        ) : null}
                        {session.blocks.theory > 0 ? (
                          <div style={{ width: `${(session.blocks.theory / session.durationMinutes) * 100}%`, background: '#3b82f6' }} title={`理论探究: ${session.blocks.theory}分钟`} />
                        ) : null}
                        {session.blocks.check > 0 ? (
                          <div style={{ width: `${(session.blocks.check / session.durationMinutes) * 100}%`, background: '#ef4444' }} title={`检查测验: ${session.blocks.check}分钟`} />
                        ) : null}
                        {session.blocks.practice > 0 ? (
                          <div style={{ width: `${(session.blocks.practice / session.durationMinutes) * 100}%`, background: '#10b981' }} title={`实践模拟: ${session.blocks.practice}分钟`} />
                        ) : null}
                        {session.blocks.reflect > 0 ? (
                          <div style={{ width: `${(session.blocks.reflect / session.durationMinutes) * 100}%`, background: '#8b5cf6' }} title={`总结反思: ${session.blocks.reflect}分钟`} />
                        ) : null}
                      </div>
                    </div>

                    {/* 证据链要求 */}
                    {session.evidenceRequirements && session.evidenceRequirements.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#4e5969' }}>
                          📋 课堂证据链要求（收口凭据）：
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {session.evidenceRequirements.map((ev, i) => (
                            <span
                              key={i}
                              style={{
                                fontSize: '12px',
                                color: '#334155',
                                background: '#f1f5f9',
                                border: '1px solid #e2e8f0',
                                padding: '3px 8px',
                                borderRadius: '6px',
                              }}
                            >
                              ✓ {ev}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* 教学活动指导 */}
                    {session.activityGuidance ? (
                      <details style={{ fontSize: '12px', color: '#4e5969', borderTop: '1px dashed #e5e6eb', paddingTop: '8px' }}>
                        <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#165dff' }}>
                          展开查看 5 步教学活动指导建议 ▾
                        </summary>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', marginTop: '8px' }}>
                          {session.activityGuidance.review ? (
                            <div style={{ background: '#fdf6ec', padding: '6px 8px', borderRadius: '4px' }}>
                              <strong style={{ color: '#b45309' }}>[回顾]</strong> {session.activityGuidance.review}
                            </div>
                          ) : null}
                          {session.activityGuidance.theory ? (
                            <div style={{ background: '#eff6ff', padding: '6px 8px', borderRadius: '4px' }}>
                              <strong style={{ color: '#1d4ed8' }}>[理论]</strong> {session.activityGuidance.theory}
                            </div>
                          ) : null}
                          {session.activityGuidance.check ? (
                            <div style={{ background: '#fef2f2', padding: '6px 8px', borderRadius: '4px' }}>
                              <strong style={{ color: '#b91c1c' }}>[检查]</strong> {session.activityGuidance.check}
                            </div>
                          ) : null}
                          {session.activityGuidance.practice ? (
                            <div style={{ background: '#f0fdf4', padding: '6px 8px', borderRadius: '4px' }}>
                              <strong style={{ color: '#15803d' }}>[实践]</strong> {session.activityGuidance.practice}
                            </div>
                          ) : null}
                          {session.activityGuidance.reflect ? (
                            <div style={{ background: '#faf5ff', padding: '6px 8px', borderRadius: '4px' }}>
                              <strong style={{ color: '#7e22ce' }}>[反思]</strong> {session.activityGuidance.reflect}
                            </div>
                          ) : null}
                        </div>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : editorTab === 'workflow' ? (
          <div className="admin-template-workflow-container">
            <div className="admin-template-workflow-intro" style={{ borderLeft: editingTemplate.pblSpec ? '4px solid #165dff' : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <strong>
                  {editingTemplate.pblSpec ? '🛡️ 平台治理策略（Governance Policy 解耦模式）：' : 'PBL 教学全流程设计与门禁管控：'}
                </strong>
                {editingTemplate.pblSpec ? (
                  <span
                    style={{
                      backgroundColor: '#e6fffa',
                      color: '#0f766e',
                      border: '1px solid #99f6e4',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 600,
                    }}
                  >
                    已绑定策略：standard-stem-pbl:v1（STEM 物理探究标准治理策略）
                  </span>
                ) : null}
              </div>
              <p style={{ margin: '8px 0 0', color: '#475569', fontSize: '13px', lineHeight: 1.6 }}>
                {editingTemplate.pblSpec
                  ? '在下方查看每节课的任务与学习证据，在教学编排中安排导师、教学方法和资料。课时完成不代表通过理论核验；实践仍须满足服务端门禁。'
                  : editingTemplate.sourceVersion !== null
                  ? `以下阶段设计读取自最新版本 ${editingTemplate.sourceVersion}；保存会生成新版本（历史版本冻结不可改）。`
                  : '该模板还没有已保存的版本；添加阶段并保存后会生成第一个版本。'}
              </p>
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
                    {editingTemplate.phases.map((phase, idx) => {
                      const meta = PHASE_META[phase.id] ?? {
                        label: phase.name,
                        color: '#165dff',
                        bg: '#eff6ff',
                        border: '#bfdbfe',
                        mentor: phase.mentorRole || '未分配',
                        defaultGate: phase.gateRule || '无门禁',
                      };
                      const isLocked = Boolean(editingTemplate.pblSpec);

                      return (
                        <div
                          key={phase.id}
                          className="admin-template-phase-card"
                          style={{ borderLeft: `5px solid ${meta.color}` }}
                        >
                          <div className="admin-phase-card-header">
                            <div className="admin-phase-header-left">
                              <span
                                className="admin-phase-index-badge"
                                style={{ background: meta.color }}
                              >
                                {idx + 1}
                              </span>
                              {isLocked ? (
                                <>
                                  <strong style={{ fontSize: '15px', color: '#1d2129' }}>
                                    {phase.name || meta.label}
                                  </strong>
                                  <span
                                    style={{
                                      fontSize: '12px',
                                      background: '#f2f3f5',
                                      color: '#4e5969',
                                      padding: '2px 8px',
                                      borderRadius: '4px',
                                    }}
                                  >
                                    ID: <code>{phase.id}</code>
                                  </span>
                                  <span
                                    style={{
                                      fontSize: '12px',
                                      background: meta.bg,
                                      color: meta.color,
                                      border: `1px solid ${meta.border}`,
                                      padding: '2px 8px',
                                      borderRadius: '4px',
                                      fontWeight: 600,
                                    }}
                                  >
                                    责任导师：{phase.mentorRole || meta.mentor}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: '12px',
                                      background: '#f7f8fa',
                                      color: '#86909c',
                                      padding: '2px 8px',
                                      borderRadius: '4px',
                                    }}
                                  >
                                    🔒 只读锁定
                                  </span>
                                </>
                              ) : (
                                <>
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
                                </>
                              )}
                            </div>
                            {!isLocked ? (
                              <button
                                type="button"
                                className="admin-skill-dot-btn"
                                style={{ color: '#ef4444' }}
                                title="删除该阶段"
                                onClick={() => removePhase(phase.id)}
                              >
                                🗑️
                              </button>
                            ) : null}
                          </div>

                          <div className="admin-phase-card-body">
                            <div
                              className="admin-phase-gate-box"
                              style={{
                                background: phase.id === 'concept_mastery' ? '#fef2f2' : meta.bg,
                                borderColor: phase.id === 'concept_mastery' ? '#fecaca' : meta.border,
                              }}
                            >
                              <span
                                className="admin-phase-gate-label"
                                style={{
                                  color: phase.id === 'concept_mastery' ? '#dc2626' : meta.color,
                                }}
                              >
                                🛡️ 阶段硬性门禁规则:
                              </span>
                              {isLocked ? (
                                <span style={{ fontSize: '13px', color: '#1d2129', fontWeight: 600 }}>
                                  {phase.gateRule || meta.defaultGate}
                                </span>
                              ) : (
                                <input
                                  className="admin-input-text"
                                  style={{ flex: 1 }}
                                  value={phase.gateRule}
                                  placeholder="例如：未通过理论掌握度检测前不得进入实践"
                                  onChange={(e) => updatePhase(phase.id, { gateRule: e.target.value })}
                                />
                              )}
                            </div>

                            <div className="admin-phase-prompt-box">
                              <label className="admin-phase-prompt-label">
                                阶段引导 Prompt (系统提示词):
                              </label>
                              {isLocked ? (
                                <div
                                  style={{
                                    background: '#f7f8fa',
                                    border: '1px solid #e5e6eb',
                                    borderRadius: '8px',
                                    padding: '12px 14px',
                                    fontSize: '13px',
                                    color: '#334155',
                                    lineHeight: 1.6,
                                    whiteSpace: 'pre-wrap',
                                  }}
                                >
                                  {phase.stagePrompt || '（系统默认阶段引导策略）'}
                                </div>
                              ) : (
                                <textarea
                                  className="admin-prompt-editor-box"
                                  rows={6}
                                  value={phase.stagePrompt}
                                  onChange={(e) => updatePhase(phase.id, { stagePrompt: e.target.value })}
                                  placeholder="在此配置该阶段导师的苏格拉底式发问策略与引导约束..."
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!editingTemplate.pblSpec ? (
                  <div style={{ marginTop: '12px' }}>
                    <button type="button" className="settings-action-btn" onClick={addPhase}>
                      + 添加阶段
                    </button>
                  </div>
                ) : null}
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
            Admin 统一维护项目式学习（PBL）模板。全面以课时为基本教学单元进行编排与交付收口。
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

      {displayedTemplates.length === 0 ? (
        <div className="settings-empty" style={{ padding: '32px', textAlign: 'center' }}>
          <strong>暂无项目模板</strong>
          <p style={{ margin: '8px 0 0', color: '#86909c', fontSize: '13px' }}>
            点击右上角「新建项目模板」创建新模板。
          </p>
        </div>
      ) : (
        <div className="admin-templates-cards-grid">
          {displayedTemplates.map((template) => {
            const is16Sessions =
              template.slug.includes('16s') || template.title.includes('16');
            return (
              <div key={template.id} className="admin-template-item-card">
                <div className="admin-template-item-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <VisualAsset assetId={template.iconAssetId ?? 'subject-interdisciplinary-v1'} size={40} />
                    <strong className="admin-template-item-title">{template.title}</strong>
                  </div>
                  <span
                    className="admin-template-status-pill"
                    style={{
                      backgroundColor:
                        template.status === 'published'
                          ? '#e6f8ea'
                          : template.status === 'archived'
                            ? '#f2f3f5'
                            : '#e8f3ff',
                      color:
                        template.status === 'published'
                          ? '#00b42a'
                          : template.status === 'archived'
                            ? '#86909c'
                            : '#165dff',
                    }}
                  >
                    {STATUS_LABELS[template.status] ?? template.status}
                  </span>
                </div>

                {is16Sessions ? (
                  <div
                    className="admin-template-16session-tag"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      backgroundColor: '#eff6ff',
                      color: '#1d4ed8',
                      border: '1px solid #bfdbfe',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      fontSize: '12px',
                      fontWeight: 600,
                      marginTop: '6px',
                      marginBottom: '8px',
                    }}
                  >
                    <span>📅 16 课时项目教学编排</span>
                  </div>
                ) : null}

                <p className="admin-template-item-desc">{template.summary || '暂无描述'}</p>
                <div style={{ display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' }}>
                  <VisualSelector owner={{ kind: 'template', id: template.id }} usage="icon" label="选择主题图标" onSaved={() => void load()} />
                  <VisualSelector owner={{ kind: 'template', id: template.id }} usage="cover" label="选择主题封面" onSaved={() => void load()} />
                  {template.latestPublishedVersionId && <VisualSelector owner={{ kind: 'template-version', id: template.latestPublishedVersionId }} usage="icon" label="版本图标" onSaved={() => void load()} />}
                </div>

                <div className="admin-template-info-list">
                  <div className="admin-template-info-row">
                    <span className="admin-template-info-label">适用领域:</span>
                    <span className="admin-template-info-val">{template.domain || '未设置'}</span>
                  </div>
                  <div className="admin-template-info-row">
                    <span className="admin-template-info-label">课时规划:</span>
                    <span
                      className="admin-template-info-val"
                      style={{
                        fontWeight: is16Sessions ? 600 : 'normal',
                        color: is16Sessions ? '#165dff' : undefined,
                      }}
                    >
                      {is16Sessions ? '16 课时（60 分钟/课时）' : '课时轨道尚未配置'}
                    </span>
                  </div>
                  {is16Sessions ? (
                    <>
                      <div className="admin-template-info-row">
                        <span className="admin-template-info-label">治理策略:</span>
                        <span
                          className="admin-template-info-val"
                          style={{ color: '#0f766e', fontWeight: 600 }}
                          title="解耦治理：STEM 物理项目式探究标准治理策略 (standard-stem-pbl:v1)"
                        >
                          🛡️ standard-stem-pbl:v1
                        </span>
                      </div>
                      <div className="admin-template-info-row">
                        <span className="admin-template-info-label">核心门禁:</span>
                        <span
                          className="admin-template-info-val"
                          style={{ color: '#dc2626', fontWeight: 600 }}
                        >
                          理论核验通过后开放实践
                        </span>
                      </div>
                    </>
                  ) : null}
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
                    {is16Sessions ? '查看 16 课时教学编排 →' : '配置项目与团队绑定 →'}
                  </button>
                  <button
                    type="button"
                    className="settings-action-btn is-danger"
                    onClick={() => handleDeleteTemplate(template.id, template.title)}
                    title="删除项目模板"
                  >
                    🗑️ 删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 与后端约束一致：published / archived 模板的元数据不可再修改。 */
function canEditMeta(status: string): boolean {
  return status !== 'published' && status !== 'archived';
}
