'use client';

import { TemplateDeleteDialog } from '../../../../lib/components/template-library/TemplateDeleteDialog';
import { TemplateLibraryCard } from '../../../../lib/components/template-library/TemplateLibraryCard';
import libraryStyles from '../../../../lib/components/template-library/TemplateLibrary.module.css';
import { TemplateTeamBindingPanel } from '../../../../lib/components/TemplateTeamBindingPanel';
import { CourseVersionActions } from '../../../../lib/components/teaching-binding/CourseVersionActions';
import { canonicalCourseJson } from '../../../../lib/components/teaching-binding/lesson-draft';
import { parseProjectTemplateSpec } from '@qitu/contracts';
import { newIdempotencyKey } from '../../../../lib/api/types';
import { VisualSelector } from '../../../../lib/components/VisualAssetPicker';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminProjectTemplate, AdminTemplateVersionDetail } from '../../../../lib/api/content';
import {
  createAdminTemplate,
  createAdminTemplateVersion,
  fetchAdminTemplateVersions,
  fetchAdminTemplates,
  updateAdminTemplate,
  restoreAdminTemplate,
} from '../../../../lib/api/content';
import { fetchAdminTeamConfigs } from '../../../../lib/api/teams';
import type {
  AdminTeamConfig,
  ProjectTemplateSpec,
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
  draft: '编辑中',
  piloting: '已上架',
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
  const courseSaveAttempt = useRef<{ signature: string; key: string; version: string } | null>(null);
  const restoreAttempt = useRef<{ signature: string; key: string } | null>(null);
  const restoreInFlight = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const [filterArchived, setFilterArchived] = useState<'active' | 'all'>('active');
  const displayedTemplates = useMemo(() => {
    if (filterArchived === 'active') {
      return templates.filter((t) => t.status === 'published' || t.status === 'piloting');
    }
    return templates;
  }, [templates, filterArchived]);

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

  const handleRestoreTemplate = async (template: AdminProjectTemplate) => {
    if (restoreInFlight.current || saving) return;
    if (!navigator.onLine) { setSaveError('网络已断开，联网后可恢复课程。'); return; }
    const signature = `${template.id}:${template.updatedAt}`;
    if (restoreAttempt.current?.signature !== signature) restoreAttempt.current = { signature, key: newIdempotencyKey() };
    const request = versionRequest.current;
    restoreInFlight.current = true; setRestoringId(template.id); setSaving(true); setSaveError(''); setSaveNotice('');
    try {
      const result = await restoreAdminTemplate(template, restoreAttempt.current.key);
      setTemplates(previous => previous.map(entry => entry.id === result.template.id ? result.template : entry));
      restoreAttempt.current = null;
      if (request === versionRequest.current) {
        openEditor(result.template, result.version?.id);
        setSaveNotice('课程已恢复，可继续编辑。上架前请完成教学安排。');
      }
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : '课程恢复未确认，请重新加载核对。'); }
    finally { restoreInFlight.current = false; setRestoringId(null); setSaving(false); }
  };

  const closeEditor = () => {
    versionRequest.current++;
    const params = new URLSearchParams(window.location.search);
    params.delete('templateId'); params.delete('versionId');
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
    setEditingTemplate(null);
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

    let courseSpec: ProjectTemplateSpec | null = null;
    try { courseSpec = editingTemplate.pblSpec ? parseProjectTemplateSpec(editingTemplate.pblSpec) : null; }
    catch (failure) { setSaveError(failure instanceof Error ? failure.message : '课程配置校验失败'); return; }
    const courseChanged = courseSpec !== null && canonicalCourseJson(courseSpec) !== canonicalCourseJson(editingTemplate.sourceContent.pbl);
    const versionChanged = courseChanged || !courseSpec && phases.length > 0
      && (!editingTemplate.sourceVersionId || JSON.stringify(phases) !== JSON.stringify(editingTemplate.sourcePhases));
    const signature = canonicalCourseJson({ id: editingTemplate.id, sourceVersionId: editingTemplate.sourceVersionId, courseSpec, phases });
    if (courseSaveAttempt.current?.signature !== signature) courseSaveAttempt.current = {
      signature, key: newIdempotencyKey(), version: `${courseSpec?.version ?? 'v1'}.edit-${Date.now()}`,
    };
    const attempt = courseSaveAttempt.current;
    const nextCourseSpec = courseSpec ? { ...courseSpec, version: attempt.version } : null;
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
        if (nextCourseSpec) delete content.phases;
        const result = await createAdminTemplateVersion(editingTemplate.id, {
          stages: editingTemplate.pblSpec ? editingTemplate.sourceStages : phases.map((phase) => ({ id: phase.id, label: phase.name })),
          rubric: editingTemplate.sourceRubric,
          content: {
            ...content,
            ...(nextCourseSpec ? { pbl: nextCourseSpec } : { phases }),
          },
        }, attempt.key);
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === editingTemplate.id
              ? { ...t, status: result.template.status, latestPublishedVersionId: result.template.latestPublishedVersionId }
              : t,
          ),
        );
        const readback = (await fetchAdminTemplateVersions(editingTemplate.id)).find((version) => version.id === result.version.id);
        if (!readback || (nextCourseSpec ? canonicalCourseJson(parseProjectTemplateSpec(readback.content.pbl)) !== canonicalCourseJson(nextCourseSpec)
          : JSON.stringify(parsePhasesFromVersion(readback)) !== JSON.stringify(phases))) throw new Error('课程配置保存后的回读不一致，请重新加载核对。');
        setTemplateVersions((previous) => [...previous.filter((item) => item.id !== readback.id), readback]);
        const params = new URLSearchParams(window.location.search);
        params.set('versionId', readback.id);
        window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
        setEditingTemplate((prev) =>
          prev === null || prev.id !== editingTemplate.id
            ? prev
            : { ...prev, phases, sourcePhases: phases, title, summary, pblSpec: nextCourseSpec,
              sourceVersion: readback.version, sourceVersionId: readback.id, sourceContent: readback.content, sourceStages: readback.stages, sourceRubric: readback.rubric },
        );
        courseSaveAttempt.current = null;
        notice = `课程配置已保存为新版本 ${result.version.version}，上架并启用教学安排后供新项目使用。`;
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
  if (state && templates.length === 0) return <div className={`admin-settings-page ${libraryStyles.page}`}>{state}</div>;

  // 模板与 PBL 流程编辑器
  if (editingTemplate) {
    const restoreTarget = templates.find(entry => entry.id === editingTemplate.id);
    const selectedVersion = templateVersions.find((version) => version.id === editingTemplate.sourceVersionId);
    const courseDirty = !!editingTemplate.pblSpec && canonicalCourseJson(editingTemplate.pblSpec) !== canonicalCourseJson(editingTemplate.sourceContent.pbl);
    const lessonProfile = editingTemplate.pblSpec?.curriculum?.profiles?.[0];
    const lessonSessions = lessonProfile?.sessions ?? [];
    const lessonCount = lessonProfile?.schedule.lessonCount ?? lessonSessions.length;

    const basicFields = (
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
    );

    return (
      <div className={`admin-template-editor-view ${libraryStyles.editorPage}`}>
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
              课程：{editingTemplate.title || '(未命名)'}
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {saveNotice ? <span className="admin-save-notice">{saveNotice}</span> : null}
            {saveError ? (
              <span className="admin-save-notice" style={{ color: '#ef4444' }}>
                {saveError}
              </span>
            ) : null}
            {editingTemplate.status === 'archived' ? <button type="button" className="settings-action-btn is-primary"
              disabled={saving || !restoreTarget} onClick={() => { if (restoreTarget) void handleRestoreTemplate(restoreTarget); }}>
              {restoringId === editingTemplate.id ? '正在恢复并核对…' : '恢复并编辑'}
            </button> : <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={handleSaveTemplate}
              disabled={saving || versionsLoading || !!versionsError}
              title={editingTemplate.pblSpec ? '采用 ProjectTemplateSpec 治理，保存内容会创建新的课程版本' : undefined}
            >
              {saving ? '正在保存并回读…' : editingTemplate.pblSpec ? '保存课程配置' : '保存模板与阶段设计'}
            </button>}
          </div>
        </div>

        {editingTemplate.status === 'archived' && <p role="status" className="admin-template-workflow-intro">课程已归档，点击“恢复并编辑”后继续配置。恢复会保留历史版本与已有项目，生成新的可编辑版本，不自动上架。</p>}
        <TemplateTeamBindingPanel key={editingTemplate.sourceVersionId} templateId={editingTemplate.id}
          versionId={versionsLoading || versionsError ? null : editingTemplate.sourceVersionId}
          versionStatus={selectedVersion?.status ?? 'draft'} profiles={editingTemplate.pblSpec?.curriculum?.profiles ?? []}
          phases={editingTemplate.pblSpec?.phases ?? []} requiresBundle={editingTemplate.pblSpec !== null} teams={teams}
          courseSpec={editingTemplate.pblSpec ?? undefined} courseDirty={courseDirty}
          courseDisabled={saving || editingTemplate.status === 'archived'}
          onCourseChange={spec => setEditingTemplate(previous => previous ? { ...previous, pblSpec: spec } : previous)}
          versionControls={<>
            <details><summary>课程基本信息</summary>{basicFields}</details>
            <label>课程版本 <select className="admin-select" aria-label="课程版本" value={editingTemplate.sourceVersionId ?? ''} disabled={versionsLoading || saving}
              onChange={event => { setSaveNotice(''); setSaveError(''); void loadVersions(editingTemplate.id, event.target.value); }}>
              {!selectedVersion && <option value="">尚无版本</option>}
              {templateVersions.map(version => <option key={version.id} value={version.id}>{version.version} · {STATUS_LABELS[version.status] ?? version.status}</option>)}
            </select></label>
            {selectedVersion && editingTemplate.pblSpec ? <CourseVersionActions key={selectedVersion.id}
              templateId={editingTemplate.id} versionId={selectedVersion.id} status={selectedVersion.status}
              disabled={saving || courseDirty || editingTemplate.status === 'archived'} onChanged={() => void loadVersions(editingTemplate.id, selectedVersion.id)} /> : null}
          </>} />
        {!editingTemplate.pblSpec && <div className="team-editor-top-tabs">
          {editingTemplate.pblSpec ? (
            <button
              type="button"
              className={`team-editor-tab-item${editorTab === 'sessions' ? ' is-active' : ''}`}
              onClick={() => setEditorTab('sessions')}
            >
              教学安排
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
        </div>}


        {editingTemplate.pblSpec ? null : editorTab === 'workflow' ? (
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
                                  <select

                                    className="admin-select"

                                    style={{ maxWidth: '200px', fontSize: '12px' }}

                                    value={phase.mentorRole}

                                    onChange={(e) => updatePhase(phase.id, { mentorRole: e.target.value })}

                                  >

                                    <option value="">未指定导师角色</option>

                                    {phase.mentorRole && !teams.some(t => t.members.some(m => m.assistantName === phase.mentorRole || m.role === phase.mentorRole)) ? (

                                      <option value={phase.mentorRole}>{phase.mentorRole}（当前设定）</option>

                                    ) : null}

                                    {teams.flatMap(t => t.members.map(m => (

                                      <option key={`${t.id}-${m.assistantId}`} value={m.assistantName}>

                                        {m.assistantName}（{m.roleLabel || m.role} · {t.name}）

                                      </option>

                                    )))}

                                  </select>
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
          basicFields
        )}
      </div>
    );
  }

  return (
    <div className={`admin-settings-page ${libraryStyles.page}`}>
      <div className="settings-pagehead">
        <div className="settings-titlebox">
          <h1>项目模板库</h1>
          <div className="settings-desc">
            管理可以开展的项目课程，查看每节课的任务与学习成果。
          </div>
        </div>
        <div className="settings-page-actions">
          <button
            type="button"
            className="settings-action-btn is-primary"
            onClick={handleCreateTemplate}
            disabled={saving}
          >
            + 新建课程
          </button>
        </div>
      </div>

      {saveError ? (
        <div className="admin-template-workflow-intro" style={{ color: '#ef4444' }}>
          <span>{saveError}</span>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
        <button
          type="button"
          className={`settings-action-btn ${filterArchived === 'active' ? 'is-primary' : ''}`}
          onClick={() => setFilterArchived('active')}
        >
          已上架 ({templates.filter((t) => t.status === 'published' || t.status === 'piloting').length})
        </button>
        <button
          type="button"
          className={`settings-action-btn ${filterArchived === 'all' ? 'is-primary' : ''}`}
          onClick={() => setFilterArchived('all')}
        >
          全部课程 ({templates.length})
        </button>
      </div>

      {displayedTemplates.length === 0 ? (
        <div className="settings-empty" style={{ padding: '32px', textAlign: 'center' }}>
          <strong>{filterArchived === 'active' ? '暂无已上架课程' : '暂无项目模板'}</strong>
          <p style={{ margin: '8px 0 0', color: '#86909c', fontSize: '13px' }}>
            {filterArchived === 'active' && templates.length > 0
              ? '切换“全部课程”查看编辑中和已归档的课程。'
              : '点击右上角“新建课程”创建新模板。'}
          </p>
        </div>
      ) : (
        <div className={libraryStyles.grid}>
          {displayedTemplates.map(template => (
            <TemplateLibraryCard key={template.id} template={template}
              onOpen={() => openEditor(template)}
              onDelete={() => setDeleteTarget(template.id)}
              deleting={false} deleteDisabled={saving}
              onSaved={() => void load()}
              onRestore={() => void handleRestoreTemplate(template)} restoring={restoringId === template.id} restoreDisabled={saving} />
          ))}
        </div>
      )}
      {deleteTarget && <TemplateDeleteDialog key={deleteTarget} templateId={deleteTarget}
        onCancel={() => setDeleteTarget(null)} onDeleted={() => {
          setTemplates(previous => previous.filter(item => item.id !== deleteTarget));
          setDeleteTarget(null);
        }} />}
    </div>
  );
}

/** 与后端约束一致：published / archived 模板的元数据不可再修改。 */
function canEditMeta(status: string): boolean {
  return status !== 'published' && status !== 'archived';
}
