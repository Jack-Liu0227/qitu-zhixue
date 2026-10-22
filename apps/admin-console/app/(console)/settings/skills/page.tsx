'use client';

import { VisualAsset } from '@qitu/ui';

import { AssistantGlyph } from '@qitu/ui';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchAdminAssistantConfigs } from '../../../../lib/api/assistants';
import { persistAssistantBinding } from '../../../../lib/api/assistantBindings';
import { fetchRuntimeSnapshot } from '../../../../lib/api/runtime';
import { AdminApiError, AdminOfflineError, AdminPermissionError } from '../../../../lib/api/types';
import type { AdminAssistantConfig, AdminRuntimeSkill } from '@qitu/contracts';

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
  runtime?: AdminRuntimeSkill['runtime'];
  available?: boolean;
  /** 本地登记的草稿。运行时目录中的技能为只读来源（服务端暂不支持写入技能内容）。 */
  local?: boolean;
}

const SKILL_SOURCE_LABELS: Record<AdminRuntimeSkill['source'], string> = {
  builtin: '内置',
  configured: '已配置',
  runtime: '运行时',
  development: '开发环境',
  unknown: '未知来源',
};

function canBindSkill(skill: SkillItem): boolean {
  return !skill.local && skill.available !== false && (skill.runtime ?? 'teaching') === 'teaching';
}

function bindingNotice(skill: SkillItem): string {
  if (skill.runtime === 'admin') return 'Admin 专用技能由管家按需加载，不绑定普通助手。';
  if (skill.local) return '本地草稿尚未注册到运行时，不能绑定到助手。';
  return '技能不可用或运行范围未知，请检查服务端配置。';
}

function assistantBindingLoadError(error: unknown): string {
  if (error instanceof AdminOfflineError) return '助手绑定状态读取失败：网络不可用，请恢复连接后重试。';
  if (error instanceof AdminPermissionError) {
    return `助手绑定状态读取失败：${error.message}（HTTP ${error.status}）。当前会话不是未登录就是角色不是 admin，请重新登录管理员账号。`;
  }
  if (error instanceof AdminApiError) {
    const trace = error.traceId ? `，请求 ID ${error.traceId}` : '';
    return `助手绑定状态读取失败：${error.message}（HTTP ${error.status} / ${error.code}${trace}）。`;
  }
  return `助手绑定状态读取失败：${error instanceof Error ? error.message : '未知错误'}。`;
}

/** 技能目录来自 AI 运行时快照（GET /api/v1/admin/ai-runtime），不再内置任何编造条目。 */
function mapRuntimeSkill(skill: AdminRuntimeSkill): SkillItem {
  const content = skill.content ?? '';
  return {
    id: skill.id,
    name: skill.label,
    description: skill.description ?? '',
    tags: [SKILL_SOURCE_LABELS[skill.source] ?? skill.source, skill.runtime === 'admin' ? 'Admin 专用' : '教学技能'],
    runtime: skill.runtime ?? 'teaching',
    available: skill.status === 'ready',
    filesCount: 1,
    addedBy: SKILL_SOURCE_LABELS[skill.source] ?? skill.source,
    updatedAtText: skill.version ? `v${skill.version}` : '—',
    // Runtime Agent IDs are not AdminAssistantConfig IDs; binding state comes
    // from the persisted assistant configuration fetched separately.
    boundAssistantIds: [],
    files: [{ name: 'SKILL.md', sizeBytes: new TextEncoder().encode(content).length, content }],
  };
}

export default function SkillsSettingsPage() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [catalogPending, setCatalogPending] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingSkill, setEditingSkill] = useState<SkillItem | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'files'>('overview');
  const [showAddAssistantModal, setShowAddAssistantModal] = useState(false);
  const [selectedAsstToAdd, setSelectedAsstToAdd] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [skillsViewMode, setSkillsViewMode] = useState<'list' | 'matrix'>('list');
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const saveInFlightRef = useRef(false);

  // Normalize legacy display names before sending the full enabledSkills array.
  const normalizeSkillIds = useCallback((values: readonly string[]) => {
    const byId = new Set(skills.filter((skill) => !skill.local).map((skill) => skill.id));
    const byName = new Map(skills.filter((skill) => !skill.local).map((skill) => [skill.name, skill.id]));
    return [...new Set(values.flatMap((value) => {
      if (byId.has(value)) return [value];
      const canonicalId = byName.get(value);
      return canonicalId ? [canonicalId] : [];
    }))];
  }, [skills]);

  const hasUnmappedSkillValue = useCallback((values: readonly string[]) => {
    const runtimeSkills = skills.filter((skill) => !skill.local);
    const ids = new Set(runtimeSkills.map((skill) => skill.id));
    const names = new Set(runtimeSkills.map((skill) => skill.name));
    return values.some((value) => !ids.has(value) && !names.has(value));
  }, [skills]);

  // 技能目录从 AI 运行时快照读取；不再向 localStorage 写入任何伪造状态
  const loadSkillCatalog = useCallback(async () => {
    setCatalogPending(true);
    setCatalogError('');
    try {
      const snapshot = await fetchRuntimeSnapshot();
      const runtimeSkills = (snapshot.skills ?? []).map(mapRuntimeSkill);
      setSkills((prev) => [...runtimeSkills, ...prev.filter((s) => s.local)]);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : '技能目录读取失败');
    } finally {
      setCatalogPending(false);
    }
  }, []);
  useEffect(() => { void loadSkillCatalog(); }, [loadSkillCatalog]);

  // 文件管理状态
  const [selectedFileName, setSelectedFileName] = useState<string>('SKILL.md');
  const [fileViewMode, setFileViewMode] = useState<'edit' | 'preview'>('edit');
  const [fileContentDraft, setFileContentDraft] = useState<string>('');

  // 助手展示列表 (以 assistants 为唯一真实来源)
  const displayAssistants = useMemo(() => {
    if (assistants.length > 0) {
      return assistants.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role || '导师助手',
        avatar: a.avatar || '🤖',
        enabledSkills: (a.enabledSkills as string[]) || [],
      }));
    }
    return [];
  }, [assistants]);

  // 判断助手与技能是否已绑定：以助手实际的 enabledSkills 为 Single Source of Truth
  const isSkillBoundToAssistant = useCallback(
    (sk: SkillItem, asst: { id: string; name: string; enabledSkills?: string[] }) => {
      // 优先从最新的 assistants 状态中读取该助手的 enabledSkills
      const matched = assistants.find((a) => a.id === asst.id || a.name === asst.name);
      const enabledList = (matched?.enabledSkills as string[]) || asst.enabledSkills || [];
      if (enabledList.includes(sk.id)) {
        return true;
      }
      // 回退兼容：检查技能的 boundAssistantIds
      return (sk.boundAssistantIds || []).includes(asst.id);
    },
    [assistants]
  );

  const reloadBindings = useCallback(async () => {
    const latest = await fetchAdminAssistantConfigs();
    setAssistants(latest);
    setSkills((current) => current.map((skill) => ({
      ...skill,
      boundAssistantIds: latest
        .filter((assistant) => assistant.enabledSkills.includes(skill.id))
        .map((assistant) => assistant.id),
    })));
    return latest;
  }, []);

  const persistBindings = async (
    updates: Array<{ assistantId: string; enabledSkills: string[] }>,
    successMessage: string,
  ) => {
    if (saveInFlightRef.current) {
      setSaveNotice('上一项绑定仍在保存，请稍候。');
      return false;
    }
    if (catalogPending || catalogError) {
      setSaveNotice('运行时技能目录不可用，请刷新后再保存。');
      return false;
    }
    if (!skills.some((skill) => !skill.local)) {
      setSaveNotice('运行时技能目录为空，请刷新后核对。');
      return false;
    }
    // Never drop an unknown value when the catalog may be partial or stale:
    // silently removing a binding would overwrite state the admin cannot see.
    if (updates.some(({ enabledSkills }) => hasUnmappedSkillValue(enabledSkills))) {
      setSaveNotice('现有绑定包含目录未识别的技能，请刷新后核对，未覆盖原绑定。');
      return false;
    }
    if (updates.some(({ enabledSkills }) => normalizeSkillIds(enabledSkills).some(id => {
      const skill = skills.find(item => item.id === id);
      return skill !== undefined && !canBindSkill(skill);
    }))) {
      setSaveNotice('绑定包含 Admin 专用或不可用技能，请先移除这些绑定。');
      return false;
    }

    saveInFlightRef.current = true;
    try {
      const results = await Promise.allSettled(
        updates.map(({ assistantId, enabledSkills }) =>
          persistAssistantBinding(assistantId, 'enabledSkills', normalizeSkillIds(enabledSkills)),
        ),
      );
      let latest: AdminAssistantConfig[];
      try {
        latest = await reloadBindings();
      } catch {
        setSaveNotice('回读失败，绑定是否生效尚未确认。请刷新后核对。');
        return false;
      }
      const failures = updates.flatMap((update, index) => {
        const result = results[index];
        const actual = latest.find((assistant) => assistant.id === update.assistantId);
        const equal = actual && JSON.stringify([...actual.enabledSkills].sort()) === JSON.stringify(normalizeSkillIds(update.enabledSkills).sort());
        if (result?.status === 'fulfilled' && equal) return [];
        const reason = result?.status === 'rejected' && result.reason instanceof Error ? result.reason.message : '回读与请求不一致';
        return [`${actual?.name ?? update.assistantId}：${reason}`];
      });
      setSaveNotice(failures.length ? `已确认 ${updates.length - failures.length}/${updates.length} 位助手；失败：${failures.join('；')}` : `${successMessage} 已回读确认 ${updates.length} 位助手。`);
      return failures.length === 0;
    } finally {
      saveInFlightRef.current = false;
    }
  };
  // 矩阵中切换技能绑定 (打上✔ 立即生效)
  const toggleSkillForAssistant = async (skillId: string, asstIdentifier: string) => {
    const matchedAsst = assistants.find((a) => a.id === asstIdentifier || a.name === asstIdentifier);
    const currentSkill = skills.find((skill) => skill.id === skillId);
    if (!currentSkill) return;
    if (!matchedAsst) {
      setSaveNotice('未找到服务端助手配置，绑定未更改。');
      return;
    }
    if (!canBindSkill(currentSkill)) {
      setSaveNotice(bindingNotice(currentSkill));
      return;
    }

    const currentIds = normalizeSkillIds(matchedAsst.enabledSkills);
    const currentlyChecked = currentIds.includes(skillId);
    const updatedEnabled = currentlyChecked
      ? currentIds.filter((id) => id !== skillId)
      : [...new Set([...currentIds, skillId])];
    await persistBindings(
      [{ assistantId: matchedAsst.id, enabledSkills: updatedEnabled }],
      '技能绑定已保存。',
    );
  };

  // 加载真实助手用于绑定与展示头像（后端为唯一真实来源）
  useEffect(() => {
    void reloadBindings().catch((failure: unknown) => {
      setAssistants([]);
      setSaveNotice(assistantBindingLoadError(failure));
    });
  }, [reloadBindings]);

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

  const matrixSkills = useMemo(() => skills, [skills]);

  // 横向全选：为指定助手开启当前目录的所有技能
  const grantAllSkillsForAssistant = async (asstIdentifier: string) => {
    const matchedAsst = assistants.find((a) => a.id === asstIdentifier || a.name === asstIdentifier);
    if (!matchedAsst) return;
    const skillIds = matrixSkills.filter(canBindSkill).map((skill) => skill.id);
    const enabledSkills = [...new Set([...normalizeSkillIds(matchedAsst.enabledSkills), ...skillIds])];
    await persistBindings(
      [{ assistantId: matchedAsst.id, enabledSkills }],
      `已为【${matchedAsst.name}】保存当前目录的技能绑定。`,
    );
  };

  // 横向取消：清空指定助手在当前目录的所有技能
  const revokeAllSkillsForAssistant = async (asstIdentifier: string) => {
    const matchedAsst = assistants.find((a) => a.id === asstIdentifier || a.name === asstIdentifier);
    if (!matchedAsst) return;
    const idsToRemove = new Set(matrixSkills.map((skill) => skill.id));
    const enabledSkills = normalizeSkillIds(matchedAsst.enabledSkills).filter((id) => !idsToRemove.has(id));
    await persistBindings(
      [{ assistantId: matchedAsst.id, enabledSkills }],
      `已移除【${matchedAsst.name}】在当前目录的技能绑定。`,
    );
  };

  // 纵向全选：为某一技能绑定所有导师智能体
  const grantAllAssistantsForSkill = async (skillId: string) => {
    const targetSkill = skills.find((skill) => skill.id === skillId);
    if (!targetSkill) return;
    if (!canBindSkill(targetSkill)) {
      setSaveNotice(bindingNotice(targetSkill));
      return;
    }
    await persistBindings(
      assistants.map((assistant) => ({
        assistantId: assistant.id,
        enabledSkills: [...new Set([...normalizeSkillIds(assistant.enabledSkills), skillId])],
      })),
      `已保存所有助手对【${targetSkill.name}】的技能绑定。`,
    );
  };

  // 纵向取消：取消所有导师对某一技能的授权
  const revokeAllAssistantsForSkill = async (skillId: string) => {
    const targetSkill = skills.find((skill) => skill.id === skillId);
    if (!targetSkill) return;
    await persistBindings(
      assistants.map((assistant) => ({
        assistantId: assistant.id,
        enabledSkills: normalizeSkillIds(assistant.enabledSkills).filter((id) => id !== skillId),
      })),
      `已移除所有助手对【${targetSkill.name}】的技能绑定。`,
    );
  };

  // 全局全部全选
  const grantEntireSkillsMatrix = async () => {
    const skillIds = matrixSkills.filter(canBindSkill).map((skill) => skill.id);
    await persistBindings(
      assistants.map((assistant) => ({
        assistantId: assistant.id,
        enabledSkills: [...new Set([...normalizeSkillIds(assistant.enabledSkills), ...skillIds])],
      })),
      '已保存所有助手的技能绑定。',
    );
  };

  // 全局全部取消
  const revokeEntireSkillsMatrix = async () => {
    const idsToRemove = new Set(matrixSkills.map((skill) => skill.id));
    await persistBindings(
      assistants.map((assistant) => ({
        assistantId: assistant.id,
        enabledSkills: normalizeSkillIds(assistant.enabledSkills).filter((id) => !idsToRemove.has(id)),
      })),
      '已移除所有助手在当前目录的技能绑定。',
    );
  };

  // 新建 Skill（本地草稿：服务端暂未提供技能内容写入接口）
  const handleCreateSkill = () => {
    const newSkill: SkillItem = {
      id: `local-skill-${Date.now()}`,
      name: `custom-skill-${skills.length + 1}`,
      description: '',
      tags: ['本地草稿'],
      filesCount: 1,
      addedBy: '本地草稿（未保存到服务端）',
      updatedAtText: '刚刚',
      boundAssistantIds: [],
      local: true,
      files: [
        {
          name: 'SKILL.md',
          sizeBytes: 0,
          content: '',
        },
      ],
    };
    setSkills((prev) => [newSkill, ...prev]);
    setEditingSkill(newSkill);
    setSelectedFileName('SKILL.md');
    setFileContentDraft('');
    setSaveNotice('技能内容编辑仅保存在当前会话；服务端技能写入接口尚未提供。');
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
    setSaveNotice('已暂存到本页会话（服务端技能内容保存暂未提供）✔');
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
    setSaveNotice(`文件 ${selectedFileName} 已暂存到本页会话 ✔`);
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
    if (selectedFileName === fileName && updatedFiles[0]) {
      setSelectedFileName(updatedFiles[0].name);
      setFileContentDraft(updatedFiles[0].content);
    }
  };

  // 删除 Skill（仅限本地草稿；运行时目录由服务端管理）
  const handleDeleteSkill = (id: string, name: string) => {
    const target = skills.find((s) => s.id === id);
    if (target && !target.local) {
      alert(`技能「${name}」来自 AI 运行时目录，不能在前端删除；请在服务端调整。`);
      return;
    }
    if (!window.confirm(`确定要移除本地技能草稿「${name}」吗？`)) return;
    setSkills((prev) => prev.filter((s) => s.id !== id));
    if (editingSkill?.id === id) {
      setEditingSkill(null);
    }
  };

  // 批量开启 / 关闭选中技能
  const handleBulkSetSkillsEnabled = async (enable: boolean) => {
    if (selectedSkills.size === 0) return;
    const targetIds = Array.from(selectedSkills);
    const targetSkills = skills.filter((skill) => targetIds.includes(skill.id));
    const blockedSkill = targetSkills.find(skill => !canBindSkill(skill));
    if (blockedSkill) {
      setSaveNotice(bindingNotice(blockedSkill));
      return;
    }
    const skillIds = targetSkills.map((skill) => skill.id);
    const removeSet = new Set(targetSkills.map((skill) => skill.id));
    const updates = assistants.map((assistant) => ({
      assistantId: assistant.id,
      enabledSkills: enable
        ? [...new Set([...normalizeSkillIds(assistant.enabledSkills), ...skillIds])]
        : normalizeSkillIds(assistant.enabledSkills).filter((id) => !removeSet.has(id)),
    }));
    const saved = await persistBindings(
      updates,
      enable ? '已开启所选技能。' : '已关闭所选技能。',
    );
    if (saved) setSelectedSkills(new Set());
  };

  // 批量移除技能（仅限本地草稿）
  const handleBulkDeleteSkills = () => {
    if (selectedSkills.size === 0) return;
    const targetIds = Array.from(selectedSkills);
    const deletable = skills.filter((s) => targetIds.includes(s.id) && s.local);
    if (deletable.length === 0) {
      setSaveNotice('选中项均来自运行时目录，不能在前端删除；请在服务端调整。');
      setTimeout(() => setSaveNotice(''), 3000);
      setSelectedSkills(new Set());
      return;
    }
    if (!window.confirm(`确定要移除选中的 ${deletable.length} 个本地技能草稿吗？运行时目录技能将被跳过。`)) return;
    const deletableIds = new Set(deletable.map((s) => s.id));
    setSkills((prev) => prev.filter((s) => !deletableIds.has(s.id)));
    setSelectedSkills(new Set());
    setSaveNotice(`已移除 ${deletable.length} 个本地技能草稿 ✔`);
    setTimeout(() => setSaveNotice(''), 3000);
  };

  // 从技能中解除绑定助手 (立即生效并同步矩阵)
  const handleRemoveAssistantFromSkill = async (asstId: string) => {
    if (!editingSkill) return;
    await toggleSkillForAssistant(editingSkill.id, asstId);
  };

  // 向技能绑定助手 (立即生效并在矩阵方框中打上✔)
  const handleAddAssistantToSkill = async () => {
    if (!editingSkill || !selectedAsstToAdd) return;
    await toggleSkillForAssistant(editingSkill.id, selectedAsstToAdd);
    setShowAddAssistantModal(false);
    setSelectedAsstToAdd('');
  };

  // 技能编辑视图
  if (editingSkill) {
    const boundAssistants = assistants.filter(
      (a) =>
        editingSkill.boundAssistantIds.some((id) => id === a.id || id === a.name) ||
        ((a.enabledSkills as string[]) || []).includes(editingSkill.id)
    );
    const activeFile = editingSkill.files.find((f) => f.name === selectedFileName) || editingSkill.files[0] || { name: 'SKILL.md', sizeBytes: 0, content: '' };

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
              <span role="status" style={{ fontSize: '13px', color: '#334155', fontWeight: 600 }}>{saveNotice}</span>
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
            <span className="admin-skill-icon"><VisualAsset assetId="capability-skills-v1" size={32} /></span>
            <h1 className="admin-skill-main-title">{editingSkill.name}</h1>
          </div>
          <div className="admin-skill-meta-tags">
            <span className="admin-skill-meta-pill">{editingSkill.local ? '✎ 本地草稿' : `📦 ${editingSkill.addedBy}`}</span>
            <span className="admin-skill-meta-pill">📄 {editingSkill.filesCount} 个文件</span>
            <span className="admin-skill-meta-pill">{editingSkill.runtime === 'admin' ? 'Admin 管家专用' : `👥 ${editingSkill.boundAssistantIds.length} 个智能体在用`}</span>
            {!editingSkill.local && editingSkill.updatedAtText !== '—' ? (
              <span className="admin-skill-meta-pill">🕒 {editingSkill.updatedAtText}</span>
            ) : null}
          </div>
        </div>

        {!editingSkill.local ? (
          <div className="admin-skill-readonly-banner">
            此技能来自 AI 运行时目录（只读来源）。在本页修改属性或文件仅暂存于当前会话，不会写回服务器。
            {editingSkill.runtime === 'admin' ? ' Admin 管家按需加载已发布的专用技能，无需在助手矩阵中勾选。' : ' 与助手的绑定/解绑会通过助手接口真实持久化。'}
          </div>
        ) : null}

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
                  {editingSkill.runtime === 'admin' ? '使用范围：Admin 管家' : `被 ${editingSkill.boundAssistantIds.length} 个智能体使用`}
                </h2>
                <button
                  type="button"
                  className="settings-action-btn"
                  onClick={() => setShowAddAssistantModal(true)}
                  disabled={!canBindSkill(editingSkill)}
                >
                  + 添加到智能体
                </button>
              </div>

              {boundAssistants.length === 0 ? (
                <div className="admin-skill-empty-agents">
                  {editingSkill.runtime === 'admin'
                    ? '管家请求由服务端校验管理员权限后，加载此技能并执行受控操作；普通助手与学生 AI 搭档不加载管理技能。'
                    : '暂未绑定任何智能体，点击右上角“添加到智能体”进行挂载。'}
                </div>
              ) : (
                <div className="admin-skill-agents-list">
                  {boundAssistants.map((assistant) => (
                    <div key={assistant.id} className="admin-skill-agent-row">
                      <div className="admin-skill-agent-avatar-wrap">
                        <AssistantGlyph value={assistant.avatar} />
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
      <div className="admin-skills-top-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div className="admin-skills-title-group">
          <span className="admin-skills-top-icon"><VisualAsset assetId="capability-skills-v1" size={36} /></span>
          <h1 className="admin-skills-title">Skills (技能中心)</h1>
          <span className="admin-skills-total-count">{skills.length}</span>
          <span className="admin-skills-tagline">统一管理教学与 Admin 专用技能，按使用范围加载。</span>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ background: '#f1f5f9', padding: '3px', borderRadius: '8px', display: 'flex', border: '1px solid #e2e8f0' }}>
            <button
              type="button"
              style={{
                padding: '6px 14px',
                border: 'none',
                borderRadius: '6px',
                background: skillsViewMode === 'list' ? '#ffffff' : 'transparent',
                fontWeight: skillsViewMode === 'list' ? 600 : 400,
                boxShadow: skillsViewMode === 'list' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
                color: skillsViewMode === 'list' ? '#0f172a' : '#64748b',
                fontSize: '13px',
              }}
              onClick={() => setSkillsViewMode('list')}
            >
              📋 技能列表
            </button>
            <button
              type="button"
              style={{
                padding: '6px 14px',
                border: 'none',
                borderRadius: '6px',
                background: skillsViewMode === 'matrix' ? '#ffffff' : 'transparent',
                fontWeight: skillsViewMode === 'matrix' ? 600 : 400,
                boxShadow: skillsViewMode === 'matrix' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                cursor: 'pointer',
                color: skillsViewMode === 'matrix' ? '#0f172a' : '#64748b',
                fontSize: '13px',
              }}
              onClick={() => setSkillsViewMode('matrix')}
            >
              🔲 助手 × 技能绑定矩阵
            </button>
          </div>

          <button
            type="button"
            className="settings-action-btn is-primary"
            onClick={handleCreateSkill}
          >
            + 新建技能
          </button>
        </div>
      </div>

      {saveNotice ? <div role="status" className="settings-binding-notice">{saveNotice}<button type="button" className="qitu-button qitu-button-ghost" onClick={() => setSaveNotice('')}>关闭提示</button></div> : null}
      {catalogError ? (
        <div role="alert" style={{ marginTop: '12px', padding: '10px 14px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px', fontSize: '13px' }}>
          技能目录：{catalogError}
          <button type="button" onClick={() => void loadSkillCatalog()} style={{ marginLeft: '12px', color: '#165dff', border: 'none', background: 'none', cursor: 'pointer' }}>重试</button>
        </div>
      ) : null}

      {skillsViewMode === 'matrix' ? (
        /* 助手 × 技能绑定矩阵 (行=助手, 列=技能) */
        <div style={{ marginTop: '16px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <strong style={{ fontSize: '15px', color: '#0f172a' }}>技能分配矩阵 (Skills Matrix)</strong>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                当前矩阵包含 {assistants.length} 位助手、{matrixSkills.length} 项技能。勾选后保存并回读，结果以页面回执为准。
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span className="admin-matrix-scroll-hint">↔ 可横向滚动查看全部技能列</span>
            </div>
          </div>

          <div className="settings-permission-matrix" role="region" aria-label="授权矩阵，可横向滚动查看全部列" tabIndex={0} style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 16px', minWidth: '220px', color: '#334155', fontWeight: 600 }}>
                    <div>导师智能体 (行)</div>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 400, marginTop: '2px' }}>
                      支持纵向/横向一键批量授权
                    </div>
                    {/* 全局全部全选 / 全部取消 */}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <button
                        type="button"
                        onClick={grantEntireSkillsMatrix}
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: '1px solid #3b82f6',
                          background: '#2563eb',
                          color: '#ffffff',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                        title="全局全选：为所有导师开启当前目录的全部技能"
                      >
                        全部全选
                      </button>
                      <button
                        type="button"
                        onClick={revokeEntireSkillsMatrix}
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: '1px solid #cbd5e1',
                          background: '#ffffff',
                          color: '#64748b',
                          cursor: 'pointer',
                        }}
                        title="全部取消：清空所有导师在当前目录的全部技能"
                      >
                        全部取消
                      </button>
                    </div>
                  </th>
                  {matrixSkills.map((sk) => (
                    <th key={sk.id} style={{ padding: '12px 14px', color: '#0369a1', fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                        <span>📖 {sk.name}</span>
                        {sk.runtime === 'admin' ? <span>Admin 管家专用</span> : null}
                        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 400 }}>({sk.filesCount} 个规范文件)</span>
                      </div>
                      {/* 纵向全选 / 纵向取消 */}
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', marginTop: '6px' }}>
                        <button
                          type="button"
                          onClick={() => void grantAllAssistantsForSkill(sk.id)}
                          disabled={!canBindSkill(sk)}
                          style={{
                            fontSize: '10.5px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            border: '1px solid #bfdbfe',
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            cursor: 'pointer',
                            fontWeight: 600,
                          }}
                          title={`纵向全选：为所有导师开启【${sk.name}】`}
                        >
                          纵向全选
                        </button>
                        <button
                          type="button"
                          onClick={() => void revokeAllAssistantsForSkill(sk.id)}
                          disabled={sk.runtime === 'admin'}
                          style={{
                            fontSize: '10.5px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            border: '1px solid #fecaca',
                            background: '#fef2f2',
                            color: '#dc2626',
                            cursor: 'pointer',
                          }}
                          title={`纵向取消：取消所有导师对【${sk.name}】的授权`}
                        >
                          纵向取消
                        </button>
                      </div>
                    </th>
                  ))}
                  <th style={{ padding: '12px 16px', fontWeight: 700, color: '#334155', textAlign: 'center', minWidth: '160px', whiteSpace: 'nowrap' }}>
                    横向快捷操作 (整行)
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayAssistants.map((asst, idx) => {
                  const isEven = idx % 2 === 0;
                  return (
                    <tr key={asst.id} style={{ background: isEven ? '#ffffff' : '#fafafa', borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '18px' }}><AssistantGlyph value={asst.avatar} /></span>
                          <div>
                            <strong style={{ color: '#0f172a', display: 'block' }}>{asst.name}</strong>
                            <span style={{ fontSize: '12px', color: '#64748b' }}>{asst.role}</span>
                          </div>
                        </div>
                      </td>

                      {matrixSkills.map((sk) => {
                        if (sk.runtime === 'admin') return (
                          <td key={sk.id} style={{ padding: '12px 14px', textAlign: 'center', color: '#64748b' }}>
                            Admin 专用
                          </td>
                        );
                        const isChecked = isSkillBoundToAssistant(sk, asst);
                        return (
                          <td key={sk.id} style={{ padding: '12px 14px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => canBindSkill(sk) && void toggleSkillForAssistant(sk.id, asst.id)}
                              role="checkbox"
                              aria-label={`${asst.name} · ${sk.name}`}
                              disabled={!canBindSkill(sk)}
                              aria-disabled={!canBindSkill(sk)}
                              aria-checked={isChecked}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '22px',
                                height: '22px',
                                borderRadius: '5px',
                                border: isChecked ? '1.5px solid #165dff' : '1.5px solid #cbd5e1',
                                background: isChecked ? '#165dff' : '#ffffff',
                                color: '#ffffff',
                                fontSize: '14px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease-in-out',
                                boxShadow: isChecked ? '0 1px 3px rgba(22, 93, 255, 0.25)' : 'none',
                                userSelect: 'none',
                                margin: '0 auto',
                              }}
                              title={
                                isChecked
                                  ? `${asst.name} 已绑定 ${sk.name}；点击提交取消绑定，回读后确认`
                                    : !canBindSkill(sk) ? bindingNotice(sk) : `${asst.name} 未绑定 ${sk.name}；点击提交绑定，回读后确认`
                              }
                            >
                              {isChecked ? '✓' : ''}
                            </button>
                          </td>
                        );
                      })}

                      {/* 横向批量快捷操作 */}
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            type="button"
                            onClick={() => void grantAllSkillsForAssistant(asst.id)}
                            style={{
                              fontSize: '11px',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              border: '1px solid #bfdbfe',
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              cursor: 'pointer',
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                            title={`横向全选：为【${asst.name}】开启当前目录的所有技能`}
                          >
                            横向全选
                          </button>
                          <button
                            type="button"
                            onClick={() => void revokeAllSkillsForAssistant(asst.id)}
                            style={{
                              fontSize: '11px',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              border: '1px solid #fecaca',
                              background: '#fef2f2',
                              color: '#dc2626',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                            title={`横向取消：清空【${asst.name}】在当前目录的所有技能`}
                          >
                            横向取消
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
      ) : (
        <>
          {/* 搜索与筛选控制栏 */}
          <div className="admin-skills-filter-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div className="admin-skills-search-input-wrap">
              <span aria-hidden="true">🔍</span>
              <input
                type="text"
                placeholder="搜索 skill..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {selectedSkills.size > 0 && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="settings-action-btn"
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                  onClick={() => void handleBulkSetSkillsEnabled(true)}
                  title="为全部导师启用选中的技能"
                >
                  批量全部开启
                </button>
                <button
                  type="button"
                  className="settings-action-btn"
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                  onClick={() => void handleBulkSetSkillsEnabled(false)}
                  title="关闭所有导师对选中技能的授权"
                >
                  批量全部关闭
                </button>
                <button
                  type="button"
                  className="settings-action-btn is-danger"
                  style={{ padding: '4px 12px', fontSize: '12px', color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2' }}
                  onClick={handleBulkDeleteSkills}
                  title="批量移除选中的本地技能草稿（运行时目录技能不可前端删除）"
                >
                  批量删除 ({selectedSkills.size})
                </button>
              </div>
            )}
          </div>

          {/* 技能表格 */}
          <div className="admin-skills-table-card">
        <table className="admin-skills-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>
                <input
                  type="checkbox"
                  checked={filteredSkills.length > 0 && filteredSkills.every((s) => selectedSkills.has(s.id))}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedSkills(new Set(filteredSkills.map((s) => s.id)));
                    else setSelectedSkills(new Set());
                  }}
                  style={{ cursor: 'pointer' }}
                />
              </th>
              <th>名称</th>
              <th>被谁使用</th>
              <th>来源</th>
              <th>版本 / 更新</th>
              <th style={{ textAlign: 'right', width: '80px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {catalogPending ? (
              <tr>
                <td colSpan={6} style={{ padding: '28px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>正在读取 AI 运行时技能目录…</td>
              </tr>
            ) : filteredSkills.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '28px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                  {searchQuery ? '没有找到符合条件的技能' : 'AI 运行时暂未提供技能目录；可点击右上角「+ 新建技能」登记本地草稿。'}
                </td>
              </tr>
            ) : null}
            {filteredSkills.map((skill) => {
              const bound = assistants.filter(
                (a) =>
                  skill.boundAssistantIds.some((id) => id === a.id || id === a.name) ||
                  ((a.enabledSkills as string[]) || []).includes(skill.id)
              );

              const isChecked = selectedSkills.has(skill.id);

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
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        const next = new Set(selectedSkills);
                        if (e.target.checked) next.add(skill.id);
                        else next.delete(skill.id);
                        setSelectedSkills(next);
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
                  <td>
                    <strong className="admin-skill-table-name">{skill.name}</strong>
                    {skill.runtime === 'admin' ? <span className="admin-skill-meta-pill">Admin 专用</span> : null}
                  </td>
                  <td>
                    <div className="admin-skill-avatar-stack">
                      {bound.slice(0, 3).map((a) => (
                        <div key={a.id} className="admin-skill-avatar-circle" title={a.name}>
                          <AssistantGlyph value={a.avatar} />
                        </div>
                      ))}
                      {bound.length > 3 ? (
                        <span className="admin-skill-avatar-more">+{bound.length - 3}</span>
                      ) : null}
                      {skill.runtime === 'admin' ? <span>Admin 管家 · 按需加载</span> : null}
                      {bound.length === 0 && skill.runtime !== 'admin' ? (
                        <span className="admin-skill-none-used">— 未使用</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div className="admin-skill-added-by-cell">
                      <span className="admin-skill-user-badge">{skill.local ? '✎' : '📦'}</span>
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
                        title="删除（仅限本地草稿；运行时目录技能需在服务端调整）"
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
      </>
      )}
    </div>
  );
}
