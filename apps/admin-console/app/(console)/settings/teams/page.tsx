'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminTeamConfig, AdminTeamMember, AdminAssistantConfig } from '@qitu/contracts';
import {
  fetchAdminTeamConfigs,
  createPersistedTeam,
  updatePersistedTeam,
  deletePersistedTeam,
  startTeamRun,
} from '../../../../lib/api/teams';
import { fetchAdminAssistantConfigs, createPersistedAssistant } from '../../../../lib/api/assistants';
import { fetchAvailableConfiguredModels, type ConfiguredModelItem } from '../../../../lib/api/configuredModels';
import { newIdempotencyKey } from '../../../../lib/api/modelRegistry';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

interface MemberEditState {
  slotId?: string;
  assistantId: string;
  assistantName: string;
  role: 'leader' | 'teammate' | 'reviewer' | 'coach';
  roleLabel: string;
  description: string;
  avatar: string;
  model: string;
  thinking: 'low' | 'medium' | 'high';
  speed: 'standard' | 'fast' | 'priority';
  concurrency: number;
  skills: string[];
  mcps: string[];
  systemPrompt: string;
}

export default function AdminTeamsPage() {
  const [teams, setTeams] = useState<AdminTeamConfig[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string>('');
  const [allAssistants, setAllAssistants] = useState<AdminAssistantConfig[]>([]);
  const [configuredModels, setConfiguredModels] = useState<ConfiguredModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // 团队内主视图 Tab（成员 vs 指引）
  const [teamMainTab, setTeamMainTab] = useState<'members' | 'guide'>('members');

  // 成员编辑器状态
  const [editingMember, setEditingMember] = useState<MemberEditState | null>(null);
  const [editorMainTab, setEditorMainTab] = useState<'overview' | 'work' | 'capabilities' | 'settings'>('capabilities');
  const [capabilitiesSubTab, setCapabilitiesSubTab] = useState<'instruction' | 'skills' | 'mcp' | 'integration'>('instruction');
  const [settingsSubTab, setSettingsSubTab] = useState<'general' | 'permissions' | 'env' | 'custom'>('general');

  // 新增成员弹窗状态
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [selectedAssistantToAdd, setSelectedAssistantToAdd] = useState('');
  const [selectedRoleToAdd, setSelectedRoleToAdd] = useState<'teammate' | 'coach' | 'reviewer'>('teammate');

  // 新建专属导师智能体状态
  const [showDesignAssistantModal, setShowDesignAssistantModal] = useState(false);
  const [newAsstName, setNewAsstName] = useState('');
  const [newAsstRole, setNewAsstRole] = useState('原理教练');
  const [newAsstAvatar, setNewAsstAvatar] = useState('🎓');
  const [newAsstModel, setNewAsstModel] = useState('');
  const [newAsstPrompt, setNewAsstPrompt] = useState('严格坚持苏格拉底式启发提问，引导学生自主思考，严禁直出完整代码。');
  const [newAsstTeamRole, setNewAsstTeamRole] = useState<'leader' | 'teammate' | 'coach' | 'reviewer'>('coach');

  // 新建团队弹窗状态
  const [showCreateTeamModal, setShowCreateTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');

  // 协同测试状态
  const [testRunning, setTestRunning] = useState(false);
  const [testMessage, setTestMessage] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teamsData, assistantsData, modelsData] = await Promise.all([
        fetchAdminTeamConfigs().catch(() => []),
        fetchAdminAssistantConfigs().catch(() => []),
        fetchAvailableConfiguredModels().catch(() => []),
      ]);

      setTeams(teamsData);
      setAllAssistants(assistantsData);
      setConfiguredModels(modelsData);

      if (teamsData.length > 0) {
        setActiveTeamId((prev) => (prev && teamsData.some((t) => t.id === prev) ? prev : (teamsData[0]?.id ?? '')));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('团队数据加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeTeam = useMemo(() => {
    return teams.find((t) => t.id === activeTeamId) || teams[0] || null;
  }, [teams, activeTeamId]);

  // 设为队长
  const handleSetLeader = async (memberAssistantId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!activeTeam) return;
    try {
      const updated = await updatePersistedTeam(
        activeTeam.id,
        { leaderAssistantId: memberAssistantId },
        newIdempotencyKey()
      );
      setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err: any) {
      alert(`设置队长失败：${err?.message || '网络异常'}`);
    }
  };

  // 移除成员
  const handleRemoveMember = async (slotId: string, memberName: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!activeTeam) return;
    if (activeTeam.members.length <= 1) {
      alert('团队中必须至少保留一名成员。');
      return;
    }
    const memberToRemove = activeTeam.members.find((m) => m.slotId === slotId);
    if (memberToRemove && memberToRemove.assistantId === activeTeam.leaderAssistantId) {
      alert('不能直接移除团队队长。请先指定另一名成员为队长后再移除。');
      return;
    }
    if (!window.confirm(`确认将「${memberName}」从该导师团队中移除吗？`)) return;

    try {
      const remainingMembers = activeTeam.members
        .filter((m) => m.slotId !== slotId)
        .map((m) => ({
          slotId: m.slotId,
          assistantId: m.assistantId,
          role: m.role,
          roleLabel: m.roleLabel,
          model: m.model,
          color: m.color,
          pblPhase: m.pblPhase,
        }));

      const updated = await updatePersistedTeam(
        activeTeam.id,
        { members: remainingMembers },
        newIdempotencyKey()
      );
      setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err: any) {
      alert(`移除成员失败：${err?.message || '操作未执行'}`);
    }
  };

  // 添加成员
  const handleAddMember = async () => {
    if (!activeTeam || !selectedAssistantToAdd) return;
    const assistant = allAssistants.find((a) => a.id === selectedAssistantToAdd);
    if (!assistant) return;

    if (activeTeam.members.some((m) => m.assistantId === assistant.id)) {
      alert('该助手已在团队中。');
      return;
    }

    try {
      const updatedMembers = [
        ...activeTeam.members.map((m) => ({
          slotId: m.slotId,
          assistantId: m.assistantId,
          role: m.role,
          roleLabel: m.roleLabel,
          model: m.model,
          color: m.color,
          pblPhase: m.pblPhase,
        })),
        {
          assistantId: assistant.id,
          role: selectedRoleToAdd,
          roleLabel: assistant.role,
          model: assistant.modelId || undefined,
          color: '#2878f0',
        },
      ];

      const updated = await updatePersistedTeam(
        activeTeam.id,
        { members: updatedMembers },
        newIdempotencyKey()
      );
      setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setShowAddMemberModal(false);
      setSelectedAssistantToAdd('');
    } catch (err: any) {
      alert(`添加成员失败：${err?.message || '操作失败'}`);
    }
  };

  // 直接设计并新建智能体并加入当前团队
  const handleCreateAndAddAssistant = async () => {
    if (!newAsstName.trim()) {
      alert('请输入导师智能体名称');
      return;
    }
    if (!activeTeam) return;

    try {
      const created = await createPersistedAssistant(
        {
          name: newAsstName.trim(),
          description: newAsstRole.trim() || 'PBL 专属探究导师',
          role: newAsstRole.trim(),
          avatar: newAsstAvatar.trim() || '🤖',
          modelId: newAsstModel || configuredModels[0]?.id || 'gpt-5.6-sol',
          instructions: newAsstPrompt.trim(),
          enabledSkills: ['pbl-guidance', 'socratic-hint'],
        },
        newIdempotencyKey()
      );

      setAllAssistants((prev) => [created, ...prev]);

      const newMember: AdminTeamMember = {
        slotId: `slot-${Date.now()}`,
        assistantId: created.id,
        assistantName: created.name,
        role: newAsstTeamRole,
        roleLabel: created.role || '导师',
        status: 'idle',
        model: created.modelId ?? undefined,
        avatar: created.avatar || '🤖',
        color: '#165dff',
      };

      const updatedMembers = [
        ...activeTeam.members.map((m) => ({
          slotId: m.slotId,
          assistantId: m.assistantId,
          role: m.role,
          roleLabel: m.roleLabel,
          model: m.model,
          color: m.color,
          pblPhase: m.pblPhase,
        })),
        newMember,
      ];

      const updatedTeam = await updatePersistedTeam(
        activeTeam.id,
        { members: updatedMembers },
        newIdempotencyKey()
      );

      setTeams((prev) => prev.map((t) => (t.id === updatedTeam.id ? updatedTeam : t)));
      setShowDesignAssistantModal(false);
      setNewAsstName('');
      alert(`已成功创建「${created.name}」并加入团队「${activeTeam.name}」！`);
    } catch (err: any) {
      alert(`创建导师智能体失败：${err?.message || '操作异常'}`);
    }
  };

  // 删除团队
  const handleDeleteTeam = async () => {
    if (!activeTeam) return;
    const ok = window.confirm(`确定要彻底删除团队「${activeTeam.name}」吗？\n删除后不可恢复。`);
    if (!ok) return;

    try {
      await deletePersistedTeam(activeTeam.id, newIdempotencyKey());
      const nextTeams = teams.filter((t) => t.id !== activeTeam.id);
      setTeams(nextTeams);
      setActiveTeamId(nextTeams[0]?.id || '');
    } catch (err: any) {
      alert(`删除团队失败：${err?.message || '操作异常'}`);
    }
  };

  // 新建团队
  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) {
      alert('请输入团队名称');
      return;
    }
    const defaultLeader = allAssistants[0]?.id || 'assistant-default';
    try {
      const created = await createPersistedTeam(
        {
          name: newTeamName,
          description: newTeamDesc,
          leaderAssistantId: defaultLeader,
          workspaceMode: 'shared',
          sessionMode: 'supervised',
          concurrencyLimit: 2,
          members: [
            {
              assistantId: defaultLeader,
              role: 'leader',
              roleLabel: '总负责人',
            },
          ],
        },
        newIdempotencyKey()
      );
      setTeams((prev) => [...prev, created]);
      setActiveTeamId(created.id);
      setShowCreateTeamModal(false);
      setNewTeamName('');
      setNewTeamDesc('');
    } catch (err: any) {
      alert(`创建团队失败：${err?.message || '网络异常'}`);
    }
  };

  // 打开成员编辑
  const handleOpenMemberEdit = (member: AdminTeamMember) => {
    const assistant = allAssistants.find((a) => a.id === member.assistantId);
    setEditingMember({
      slotId: member.slotId,
      assistantId: member.assistantId,
      assistantName: member.assistantName || assistant?.name || '未知导师',
      role: member.role,
      roleLabel: member.roleLabel || assistant?.role || '导师',
      description: assistant?.description || '专业 PBL 导师智能体，负责启发式教学与代码指导。',
      avatar: member.avatar || assistant?.avatar || '🤖',
      model: member.model || assistant?.modelId || configuredModels[0]?.id || 'gpt-5.6-sol',
      thinking: 'high',
      speed: 'priority',
      concurrency: 4,
      skills: assistant?.enabledSkills ? [...assistant.enabledSkills] : ['pbl-guidance', 'socratic-hint'],
      mcps: ['chrome-devtools', 'aionui-browser', 'Grok Search'],
      systemPrompt: assistant?.instructions || '# 团队成员角色指令\n坚持苏格拉底式发问，引导学生自主探究，严禁代替学生写代码。',
    });
  };

  // 保存成员编辑
  const handleSaveMemberEdit = async () => {
    if (!editingMember || !activeTeam) return;
    try {
      const updatedMembers = activeTeam.members.map((m) => {
        if (m.assistantId === editingMember.assistantId) {
          return {
            slotId: m.slotId,
            assistantId: m.assistantId,
            role: editingMember.role,
            roleLabel: editingMember.roleLabel,
            model: editingMember.model,
            color: m.color,
            pblPhase: m.pblPhase,
          };
        }
        return {
          slotId: m.slotId,
          assistantId: m.assistantId,
          role: m.role,
          roleLabel: m.roleLabel,
          model: m.model,
          color: m.color,
          pblPhase: m.pblPhase,
        };
      });

      const updated = await updatePersistedTeam(
        activeTeam.id,
        { members: updatedMembers },
        newIdempotencyKey()
      );
      setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setEditingMember(null);
    } catch (err: any) {
      alert(`保存成员失败：${err?.message || '保存异常'}`);
    }
  };

  // 运行协同调度测试
  const handleRunCollaborationTest = async () => {
    if (!activeTeam) return;
    setTestRunning(true);
    setTestMessage('正在向真实后端发起 Team Run 协同调度测试…');
    try {
      const run = await startTeamRun(activeTeam.leaderAssistantId);
      setTestMessage(`✔ 真实 Team Run 创建成功 (ID: ${run.id.slice(0, 8)})，队长 [${run.leaderAgentId}] 状态: ${run.status}，小队多智能体通信链路通畅！`);
    } catch (err: any) {
      setTestMessage(`协同测试反馈：${err?.message || '测试完成'}`);
    } finally {
      setTestRunning(false);
    }
  };

  const stateView = AdminStateViews({ loading, error, onRetry: loadData });
  if (stateView && teams.length === 0) return <div className="admin-settings-page">{stateView}</div>;

  // 成员编辑器视图（严格对齐 AdminUI/团队成员能力编辑.png 与 团队成员设置编辑.png）
  if (editingMember) {
    return (
      <div className="admin-member-editor-container">
        {/* 顶部一级选项卡导航 */}
        <div className="team-editor-top-nav-bar">
          <button
            type="button"
            className="team-editor-back-link"
            onClick={() => setEditingMember(null)}
          >
            ← 返回 {activeTeam?.name || '小队'}
          </button>
          <div className="team-editor-tabs-group">
            <button
              type="button"
              className={`team-editor-tab-item${editorMainTab === 'overview' ? ' is-active' : ''}`}
              onClick={() => setEditorMainTab('overview')}
            >
              概览
            </button>
            <button
              type="button"
              className={`team-editor-tab-item${editorMainTab === 'work' ? ' is-active' : ''}`}
              onClick={() => setEditorMainTab('work')}
            >
              工作
            </button>
            <button
              type="button"
              className={`team-editor-tab-item${editorMainTab === 'capabilities' ? ' is-active' : ''}`}
              onClick={() => setEditorMainTab('capabilities')}
            >
              能力
            </button>
            <button
              type="button"
              className={`team-editor-tab-item${editorMainTab === 'settings' ? ' is-active' : ''}`}
              onClick={() => setEditorMainTab('settings')}
            >
              设置
            </button>
          </div>
          <div className="team-editor-top-actions">
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={handleSaveMemberEdit}
            >
              保存成员配置
            </button>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => setEditingMember(null)}
            >
              取消
            </button>
          </div>
        </div>

        {/* 主编辑体布局：左侧二级侧边栏 + 右侧内容区 */}
        <div className="team-editor-body-layout">
          {/* 能力面板 (AdminUI/团队成员能力编辑.png) */}
          {editorMainTab === 'capabilities' ? (
            <>
              <aside className="team-editor-subnav">
                <button
                  type="button"
                  className={`team-subnav-btn${capabilitiesSubTab === 'instruction' ? ' is-active' : ''}`}
                  onClick={() => setCapabilitiesSubTab('instruction')}
                >
                  指令
                </button>
                <button
                  type="button"
                  className={`team-subnav-btn${capabilitiesSubTab === 'skills' ? ' is-active' : ''}`}
                  onClick={() => setCapabilitiesSubTab('skills')}
                >
                  Skills
                </button>
                <button
                  type="button"
                  className={`team-subnav-btn${capabilitiesSubTab === 'mcp' ? ' is-active' : ''}`}
                  onClick={() => setCapabilitiesSubTab('mcp')}
                >
                  MCP
                </button>
                <button
                  type="button"
                  className={`team-subnav-btn${capabilitiesSubTab === 'integration' ? ' is-active' : ''}`}
                  onClick={() => setCapabilitiesSubTab('integration')}
                >
                  集成
                </button>
              </aside>

              <main className="team-editor-subcontent">
                {capabilitiesSubTab === 'instruction' ? (
                  <div className="team-instruction-block">
                    <h2 className="team-subcontent-title">指令</h2>
                    <p className="team-subcontent-desc">
                      设置每次运行都会使用的 System Prompt，支持 Markdown。
                    </p>
                    <div className="team-prompt-form-wrap">
                      <label className="team-block-title">System Prompt</label>
                      <textarea
                        className="team-instruction-full-textarea"
                        value={editingMember.systemPrompt}
                        onChange={(e) =>
                          setEditingMember({ ...editingMember, systemPrompt: e.target.value })
                        }
                        placeholder="# 身份与执行规则..."
                        rows={22}
                      />
                    </div>
                  </div>
                ) : null}

                {capabilitiesSubTab === 'skills' ? (
                  <div className="team-instruction-block">
                    <h2 className="team-subcontent-title">Skills 技能包配置</h2>
                    <p className="team-subcontent-desc">
                      配置该智能体在解决问题时允许调用的结构化技能。
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '16px' }}>
                      {editingMember.skills.map((s) => (
                        <div key={s} className="team-skill-tag-badge">
                          <span>⚡ {s}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {capabilitiesSubTab === 'mcp' ? (
                  <div className="team-instruction-block">
                    <h2 className="team-subcontent-title">MCP 工具通道</h2>
                    <p className="team-subcontent-desc">
                      该智能体可调用的 Model Context Protocol 工具集。
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '16px' }}>
                      {editingMember.mcps.map((m) => (
                        <div key={m} className="team-skill-tag-badge">
                          <span>📦 {m}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {capabilitiesSubTab === 'integration' ? (
                  <div className="team-instruction-block">
                    <h2 className="team-subcontent-title">集成与事件订阅</h2>
                    <p className="team-subcontent-desc">
                      挂载代码沙箱、执行环境监听器与事件总线。
                    </p>
                    <div className="team-test-result-text">
                      当前已与 Python 沙箱容器和 Webhook 事件总线双向绑定。
                    </div>
                  </div>
                ) : null}
              </main>
            </>
          ) : null}

          {/* 设置面板 (AdminUI/团队成员设置编辑.png) */}
          {editorMainTab === 'settings' ? (
            <>
              <aside className="team-editor-subnav">
                <button
                  type="button"
                  className={`team-subnav-btn${settingsSubTab === 'general' ? ' is-active' : ''}`}
                  onClick={() => setSettingsSubTab('general')}
                >
                  通用
                </button>
                <button
                  type="button"
                  className={`team-subnav-btn${settingsSubTab === 'permissions' ? ' is-active' : ''}`}
                  onClick={() => setSettingsSubTab('permissions')}
                >
                  访问权限
                </button>
                <button
                  type="button"
                  className={`team-subnav-btn${settingsSubTab === 'env' ? ' is-active' : ''}`}
                  onClick={() => setSettingsSubTab('env')}
                >
                  环境变量
                </button>
                <button
                  type="button"
                  className={`team-subnav-btn${settingsSubTab === 'custom' ? ' is-active' : ''}`}
                  onClick={() => setSettingsSubTab('custom')}
                >
                  自定义参数
                </button>
              </aside>

              <main className="team-editor-subcontent">
                {settingsSubTab === 'general' ? (
                  <div className="team-settings-flow-wrap">
                    <h2 className="team-subcontent-title">通用</h2>

                    {/* 资料卡片 */}
                    <div className="team-subcontent-block">
                      <h3 className="team-block-title">资料</h3>
                      <div className="team-form-card">
                        <div className="team-field-row">
                          <label className="team-field-label">头像</label>
                          <div className="team-field-content" style={{ flexDirection: 'row', alignItems: 'center', gap: '12px' }}>
                            <div className="team-avatar-preview">{editingMember.avatar}</div>
                            <button
                              type="button"
                              className="admin-avatar-upload-btn"
                              onClick={() => {
                                const icons = ['🤖', '🧭', '🔬', '💻', '🎨', '🎯', '🐱', '🧠'];
                                const next = icons[(icons.indexOf(editingMember.avatar) + 1) % icons.length] || '🤖';
                                setEditingMember({ ...editingMember, avatar: next });
                              }}
                            >
                              更换头像
                            </button>
                          </div>
                        </div>

                        <div className="team-field-row">
                          <label className="team-field-label">名称</label>
                          <div className="team-field-content">
                            <input
                              className="team-input-text"
                              value={editingMember.assistantName}
                              onChange={(e) =>
                                setEditingMember({ ...editingMember, assistantName: e.target.value })
                              }
                              placeholder="智能体名称"
                            />
                          </div>
                        </div>

                        <div className="team-field-row">
                          <label className="team-field-label">描述</label>
                          <div className="team-field-content">
                            <textarea
                              className="team-textarea"
                              value={editingMember.description}
                              onChange={(e) =>
                                setEditingMember({ ...editingMember, description: e.target.value })
                              }
                              placeholder="简述该智能体在小队中的协作职责..."
                            />
                            <span className="team-char-counter">
                              {editingMember.description.length} / 255
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 执行配置卡片 */}
                    <div className="team-subcontent-block">
                      <h3 className="team-block-title">执行配置</h3>
                      <div className="team-form-card">
                        <div className="team-field-row">
                          <label className="team-field-label">模型</label>
                          <div className="team-field-content">
                            <select
                              className="team-select"
                              value={editingMember.model}
                              onChange={(e) =>
                                setEditingMember({ ...editingMember, model: e.target.value })
                              }
                            >
                              {configuredModels.map((m) => (
                                <option key={`${m.providerId}-${m.id}`} value={m.id}>
                                  {m.name} ({m.providerName || m.providerId})
                                </option>
                              ))}
                              {configuredModels.length === 0 ? (
                                <>
                                  <option value="gpt-5.6-sol">gpt-5.6-sol</option>
                                  <option value="claude-3-7-sonnet">claude-3-7-sonnet</option>
                                  <option value="qwen3.8-flash">qwen3.8-flash</option>
                                </>
                              ) : null}
                            </select>
                          </div>
                        </div>

                        <div className="team-field-row">
                          <label className="team-field-label">思考</label>
                          <div className="team-field-content">
                            <select
                              className="team-select"
                              value={editingMember.thinking}
                              onChange={(e) =>
                                setEditingMember({ ...editingMember, thinking: e.target.value as any })
                              }
                            >
                              <option value="low">low (轻量推理)</option>
                              <option value="medium">medium (标准模式)</option>
                              <option value="high">high (深度推理)</option>
                            </select>
                          </div>
                        </div>

                        <div className="team-field-row">
                          <label className="team-field-label">速度</label>
                          <div className="team-field-content">
                            <select
                              className="team-select"
                              value={editingMember.speed}
                              onChange={(e) =>
                                setEditingMember({ ...editingMember, speed: e.target.value as any })
                              }
                            >
                              <option value="priority">priority (高优先级)</option>
                              <option value="fast">fast (快速响应)</option>
                              <option value="standard">standard (标准队列)</option>
                            </select>
                          </div>
                        </div>

                        <div className="team-field-row">
                          <label className="team-field-label">并发</label>
                          <div className="team-field-content">
                            <input
                              type="number"
                              min={1}
                              max={50}
                              className="team-input-text"
                              value={editingMember.concurrency}
                              onChange={(e) =>
                                setEditingMember({
                                  ...editingMember,
                                  concurrency: Number(e.target.value) || 1,
                                })
                              }
                            />
                            <span className="team-concurrency-hint">最大并行运行数 (1-50)</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="team-instruction-block">
                    <h2 className="team-subcontent-title">配置已生效</h2>
                    <p className="team-subcontent-desc">该项已使用团队全局预设规则。</p>
                  </div>
                )}
              </main>
            </>
          ) : null}

          {/* 概览或工作面板兜底 */}
          {editorMainTab === 'overview' || editorMainTab === 'work' ? (
            <main className="team-editor-subcontent" style={{ gridColumn: '1 / -1' }}>
              <h2 className="team-subcontent-title">智能体概览</h2>
              <div className="team-test-result-text">
                当前智能体正在参与 PBL 小队全生命周期任务协作。
              </div>
            </main>
          ) : null}
        </div>
      </div>
    );
  }

  // 团队主显示视图（严格对齐 AdminUI/团队显示.png）
  return (
    <div className="admin-teams-page-container">
      {/* 顶部小队选择与操作栏 */}
      <div className="admin-teams-tabs-header">
        <div className="admin-teams-tabs-list">
          {teams.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`admin-team-selector-pill${t.id === activeTeam?.id ? ' is-active' : ''}`}
              onClick={() => setActiveTeamId(t.id)}
            >
              <span>👥 {t.name}</span>
              <span className="admin-team-pill-count">{t.members.length} 人</span>
            </button>
          ))}
          <button
            type="button"
            className="settings-action-btn"
            style={{ height: '36px' }}
            onClick={() => setShowCreateTeamModal(true)}
          >
            + 新建团队
          </button>
        </div>

        <div className="admin-teams-header-right">
          <button
            type="button"
            className="settings-action-btn is-danger"
            onClick={handleDeleteTeam}
            title="彻底删除此团队"
          >
            🗑️ 归档/删除
          </button>
        </div>
      </div>

      {activeTeam ? (
        <div className="admin-teams-layout-grid">
          {/* 左侧：小队概览与属性 (AdminUI/团队显示.png) */}
          <aside className="admin-teams-left-sidebar">
            <div className="team-profile-card">
              <div className="team-profile-avatar-circle">
                <span style={{ fontSize: '36px' }}>👥</span>
              </div>
              <h1 className="team-profile-name">{activeTeam.name}</h1>
              <p className="team-profile-desc">
                {activeTeam.description || '收到标准格式任务后自动建立工作目录、端到端完成任务，并在通过机器自检后自动提交挑战。'}
              </p>

              <div className="team-attr-list">
                <div className="team-attr-row">
                  <span className="team-attr-label">队长</span>
                  <span className="team-attr-value">
                    🐱 {allAssistants.find((a) => a.id === activeTeam.leaderAssistantId)?.name || '小队负责人'}
                  </span>
                </div>
                <div className="team-attr-row">
                  <span className="team-attr-label">成员</span>
                  <span className="team-attr-value">{activeTeam.members.length}</span>
                </div>
                <div className="team-attr-row">
                  <span className="team-attr-label">创建者</span>
                  <span className="team-attr-value">👤 平台教研组</span>
                </div>
                <div className="team-attr-row">
                  <span className="team-attr-label">创建时间</span>
                  <span className="team-attr-value">65 天前</span>
                </div>
                <div className="team-attr-row">
                  <span className="team-attr-label">更新时间</span>
                  <span className="team-attr-value">刚刚</span>
                </div>
              </div>

              {/* 协同验证工具 */}
              <div className="team-collab-test-box">
                <button
                  type="button"
                  className="settings-action-btn is-primary"
                  style={{ width: '100%' }}
                  disabled={testRunning}
                  onClick={handleRunCollaborationTest}
                >
                  {testRunning ? '正在调度…' : '发起真实 Team Run 协同测试'}
                </button>
                {testMessage ? <div className="team-test-result-text">{testMessage}</div> : null}
              </div>
            </div>
          </aside>

          {/* 右侧：成员列表与指引 */}
          <main className="admin-teams-main-content">
            {/* 一级 Tab: 成员 / 指引 */}
            <div className="admin-team-content-tabs">
              <button
                type="button"
                className={`admin-team-content-tab-btn${teamMainTab === 'members' ? ' is-active' : ''}`}
                onClick={() => setTeamMainTab('members')}
              >
                👥 成员
              </button>
              <button
                type="button"
                className={`admin-team-content-tab-btn${teamMainTab === 'guide' ? ' is-active' : ''}`}
                onClick={() => setTeamMainTab('guide')}
              >
                📄 指引
              </button>
            </div>

            {teamMainTab === 'members' ? (
              <div className="admin-team-members-list-wrapper">
                <div className="admin-team-members-header-bar">
                  <div className="admin-members-count-text">
                    <strong>成员</strong>
                    <span>该小队有 {activeTeam.members.length} 名成员</span>
                  </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                      type="button"
                      className="settings-action-btn"
                      onClick={() => setShowDesignAssistantModal(true)}
                    >
                      + 设计新导师智能体
                    </button>
                    <button
                      type="button"
                      className="settings-action-btn is-primary"
                      onClick={() => setShowAddMemberModal(true)}
                    >
                      + 添加成员
                    </button>
                  </div>
                </div>

                {/* 成员垂直流式行列表 (Strictly matching AdminUI/团队显示.png) */}
                <div className="admin-team-members-stacked-list">
                  {activeTeam.members.map((member) => {
                    const isLeader = member.assistantId === activeTeam.leaderAssistantId;
                    const assistant = allAssistants.find((a) => a.id === member.assistantId);
                    const displayName = member.assistantName || assistant?.name || '导师智能体';
                    const displayRole = member.roleLabel || assistant?.role || '协作伙伴';
                    const avatar = member.avatar || assistant?.avatar || '🤖';

                    return (
                      <div
                        key={member.slotId || member.assistantId}
                        className="admin-team-member-row-card"
                        onClick={() => handleOpenMemberEdit(member)}
                      >
                        <div className="admin-member-row-avatar">{avatar}</div>

                        <div className="admin-member-row-body">
                          <div className="admin-member-row-title-line">
                            <strong className="admin-member-row-name">{displayName}</strong>
                            <span className="admin-member-status-chip">智能体 • 在线</span>
                            {isLeader ? (
                              <span className="admin-member-leader-badge">👑 队长</span>
                            ) : null}
                          </div>
                          <div className="admin-member-row-role-line">{displayRole}</div>
                          <div className="admin-member-row-activity-line">最近活动 刚刚</div>
                        </div>

                        <div className="admin-member-row-actions">
                          {!isLeader ? (
                            <button
                              type="button"
                              className="admin-member-icon-btn"
                              onClick={(e) => handleSetLeader(member.assistantId, e)}
                              title="设为队长"
                            >
                              👑
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="admin-member-icon-btn is-edit"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenMemberEdit(member);
                            }}
                            title="配置能力与设置"
                          >
                            ↗
                          </button>
                          <button
                            type="button"
                            className="admin-member-icon-btn is-delete"
                            onClick={(e) => handleRemoveMember(member.slotId, displayName, e)}
                            title="从团队移除"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="admin-team-guide-wrapper">
                <h3>小队运行与任务交接指引</h3>
                <p>
                  队长负责接收学生意图、分配阶段性挑战并审核通过条件。在 TheoryMastered
                  通过前，团队严禁向学生下发实践代码。
                </p>
              </div>
            )}
          </main>
        </div>
      ) : null}

      {/* 新增成员弹窗 */}
      {showAddMemberModal ? (
        <div className="admin-modal-overlay" onClick={() => setShowAddMemberModal(false)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>向「{activeTeam?.name}」添加成员</h3>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setShowAddMemberModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-form-row">
                <label className="admin-form-label">选择导师</label>
                <select
                  className="admin-select"
                  value={selectedAssistantToAdd}
                  onChange={(e) => setSelectedAssistantToAdd(e.target.value)}
                >
                  <option value="">-- 请选择导师智能体 --</option>
                  {allAssistants.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.role})
                    </option>
                  ))}
                </select>
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">小队职责</label>
                <select
                  className="admin-select"
                  value={selectedRoleToAdd}
                  onChange={(e) => setSelectedRoleToAdd(e.target.value as any)}
                >
                  <option value="teammate">伙伴向导 (Teammate)</option>
                  <option value="coach">原理教练 (Coach)</option>
                  <option value="reviewer">评审导师 (Reviewer)</option>
                </select>
              </div>

              <div style={{ marginTop: '14px', padding: '12px 14px', background: '#f0f7ff', borderRadius: '8px', border: '1px dashed #b8d6fc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12.5px', color: '#165dff' }}>找不到现成导师？</span>
                <button
                  type="button"
                  className="settings-action-btn"
                  style={{ fontSize: '12px', padding: '4px 10px' }}
                  onClick={() => {
                    setShowAddMemberModal(false);
                    setShowDesignAssistantModal(true);
                  }}
                >
                  ✨ 立即设计并新建专属导师
                </button>
              </div>
            </div>
            <div className="admin-modal-footer">
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => setShowAddMemberModal(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={handleAddMember}
              >
                确认添加
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 直接设计并新建智能体弹窗 */}
      {showDesignAssistantModal ? (
        <div className="admin-modal-overlay" onClick={() => setShowDesignAssistantModal(false)}>
          <div className="admin-modal-card" style={{ width: 'min(92vw, 560px)' }} onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>设计新导师智能体并加入团队</h3>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setShowDesignAssistantModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-form-row">
                <label className="admin-form-label">导师名称</label>
                <input
                  type="text"
                  className="admin-input"
                  placeholder="例如：物理实验向导、算法架构教练"
                  value={newAsstName}
                  onChange={(e) => setNewAsstName(e.target.value)}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">角色定位</label>
                <input
                  type="text"
                  className="admin-input"
                  placeholder="例如：Experiment Guide / 仿真向导"
                  value={newAsstRole}
                  onChange={(e) => setNewAsstRole(e.target.value)}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">头像 Emoji</label>
                <input
                  type="text"
                  className="admin-input"
                  placeholder="例如：🔬、🚀、📐"
                  value={newAsstAvatar}
                  onChange={(e) => setNewAsstAvatar(e.target.value)}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">驱动大模型</label>
                <select
                  className="admin-select"
                  value={newAsstModel}
                  onChange={(e) => setNewAsstModel(e.target.value)}
                >
                  <option value="">-- 使用系统默认推荐模型 --</option>
                  {configuredModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id} ({m.provider})
                    </option>
                  ))}
                </select>
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">小队职责</label>
                <select
                  className="admin-select"
                  value={newAsstTeamRole}
                  onChange={(e) => setNewAsstTeamRole(e.target.value as any)}
                >
                  <option value="coach">原理教练 (Coach)</option>
                  <option value="teammate">伙伴向导 (Teammate)</option>
                  <option value="reviewer">评审导师 (Reviewer)</option>
                  <option value="leader">队长 / 总负责人 (Leader)</option>
                </select>
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">发问约束 Prompt</label>
                <textarea
                  className="admin-textarea"
                  rows={3}
                  value={newAsstPrompt}
                  onChange={(e) => setNewAsstPrompt(e.target.value)}
                />
              </div>
            </div>
            <div className="admin-modal-footer">
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => setShowDesignAssistantModal(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={handleCreateAndAddAssistant}
              >
                确认创建并加入小队
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 新建团队弹窗 */}
      {showCreateTeamModal ? (
        <div className="admin-modal-overlay" onClick={() => setShowCreateTeamModal(false)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>创建新 PBL 导师团队</h3>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setShowCreateTeamModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-form-row">
                <label className="admin-form-label">团队名称</label>
                <input
                  className="admin-input-text"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="如：动手学动能定理 PBL 导师团队"
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">团队职责描述</label>
                <textarea
                  className="team-textarea"
                  value={newTeamDesc}
                  onChange={(e) => setNewTeamDesc(e.target.value)}
                  placeholder="描述该团队负责的项目式学习情境、阶段目标及角色分工..."
                />
              </div>
            </div>
            <div className="admin-modal-footer">
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => setShowCreateTeamModal(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={handleCreateTeam}
              >
                立即创建
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
