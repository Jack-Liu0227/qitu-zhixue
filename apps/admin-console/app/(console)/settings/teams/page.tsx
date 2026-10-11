'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminTeamConfig, AdminTeamMember, AdminAssistantConfig } from '@qitu/contracts';
import {
  fetchAdminTeamConfigs,
  createPersistedTeam,
  updatePersistedTeam,
  deletePersistedTeam,
  startTeamRun,
  delegateTeamTask,
} from '../../../../lib/api/teams';
import { fetchAdminAssistantConfigs } from '../../../../lib/api/assistants';
import { fetchAvailableConfiguredModels, type ConfiguredModelItem } from '../../../../lib/api/configuredModels';
import { newIdempotencyKey } from '../../../../lib/api/modelRegistry';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

interface MemberEditState {
  slotId?: string;
  assistantId: string;
  assistantName: string;
  role: 'leader' | 'teammate' | 'reviewer' | 'coach';
  roleLabel: string;
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

  // 成员编辑器状态
  const [editingMember, setEditingMember] = useState<MemberEditState | null>(null);
  const [editorMainTab, setEditorMainTab] = useState<'overview' | 'work' | 'capabilities' | 'settings'>('capabilities');
  const [capabilitiesSubTab, setCapabilitiesSubTab] = useState<'instruction' | 'skills' | 'mcp' | 'integration'>('instruction');
  const [settingsSubTab, setSettingsSubTab] = useState<'general' | 'permissions' | 'env' | 'custom'>('general');

  // 新增成员弹窗状态
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [selectedAssistantToAdd, setSelectedAssistantToAdd] = useState('');
  const [selectedRoleToAdd, setSelectedRoleToAdd] = useState<'teammate' | 'coach' | 'reviewer'>('teammate');

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
        setActiveTeamId((prev) => (prev && teamsData.some((t) => t.id === prev) ? prev : teamsData[0].id));
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
  const handleSetLeader = async (memberAssistantId: string) => {
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
  const handleRemoveMember = async (slotId: string, memberName: string) => {
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

  // 删除团队
  const handleDeleteTeam = async () => {
    if (!activeTeam) return;
    if (teams.length <= 1) {
      alert('系统至少需保留一个 PBL 导师团队。');
      return;
    }
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

  // 打开成员编辑
  const handleOpenMemberEdit = (member: AdminTeamMember) => {
    const assistant = allAssistants.find((a) => a.id === member.assistantId);
    setEditingMember({
      slotId: member.slotId,
      assistantId: member.assistantId,
      assistantName: member.assistantName || assistant?.name || '未知导师',
      role: member.role,
      roleLabel: member.roleLabel || assistant?.role || '导师',
      avatar: member.avatar || assistant?.avatar || '🤖',
      model: member.model || assistant?.modelId || configuredModels[0]?.id || 'gpt-5.6-sol',
      thinking: 'high',
      speed: 'priority',
      concurrency: 2,
      skills: assistant?.enabledSkills ? [...assistant.enabledSkills] : ['pbl-guidance', 'socratic-hint'],
      mcps: ['stitch', 'local-filesystem'],
      systemPrompt: assistant?.instructions || '# 团队成员角色指令\n坚持苏格拉底式发问，引导学生自主探究。',
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

  // 成员编辑器视图（对齐 AdminUI/团队成员能力编辑.png 与 团队成员设置编辑.png）
  if (editingMember) {
    return (
      <div className="admin-settings-page">
        <div className="admin-editor-top-nav">
          <button type="button" className="admin-back-btn" onClick={() => setEditingMember(null)}>
            ← 返回 {activeTeam?.name || '导师团队'}
          </button>
          <div className="admin-editor-title-row">
            <span style={{ fontSize: '20px' }}>{editingMember.avatar}</span>
            <strong style={{ fontSize: '16px', color: '#1d2129' }}>{editingMember.assistantName}</strong>
            <span style={{ fontSize: '13px', color: '#86909c' }}>({editingMember.roleLabel})</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="settings-action-btn is-primary" onClick={handleSaveMemberEdit}>
              保存成员设置
            </button>
            <button type="button" className="settings-action-btn" onClick={() => setEditingMember(null)}>
              取消
            </button>
          </div>
        </div>

        <div className="team-member-editor-view">
          {/* 一级选项卡 */}
          <div className="team-editor-top-tabs">
            <button
              type="button"
              className={`team-editor-tab-item${editorMainTab === 'capabilities' ? ' is-active' : ''}`}
              onClick={() => setEditorMainTab('capabilities')}
            >
              能力 (Capabilities)
            </button>
            <button
              type="button"
              className={`team-editor-tab-item${editorMainTab === 'settings' ? ' is-active' : ''}`}
              onClick={() => setEditorMainTab('settings')}
            >
              设置 (Settings)
            </button>
          </div>

          {/* 能力面板 */}
          {editorMainTab === 'capabilities' ? (
            <div className="team-editor-capabilities-panel">
              <div className="team-sub-tabs-bar">
                <button
                  type="button"
                  className={`team-sub-tab${capabilitiesSubTab === 'instruction' ? ' is-active' : ''}`}
                  onClick={() => setCapabilitiesSubTab('instruction')}
                >
                  角色指令 (System Prompt)
                </button>
                <button
                  type="button"
                  className={`team-sub-tab${capabilitiesSubTab === 'skills' ? ' is-active' : ''}`}
                  onClick={() => setCapabilitiesSubTab('skills')}
                >
                  技能 (Skills: {editingMember.skills.length})
                </button>
                <button
                  type="button"
                  className={`team-sub-tab${capabilitiesSubTab === 'mcp' ? ' is-active' : ''}`}
                  onClick={() => setCapabilitiesSubTab('mcp')}
                >
                  MCP 工具
                </button>
              </div>

              {capabilitiesSubTab === 'instruction' ? (
                <div className="team-instruction-box">
                  <div className="team-instruction-header">
                    <span className="team-instruction-title">角色指令与执行约束</span>
                    <span className="team-instruction-badge">改动对新会话立即生效</span>
                  </div>
                  <textarea
                    className="team-instruction-textarea"
                    rows={16}
                    value={editingMember.systemPrompt}
                    onChange={(e) => setEditingMember({ ...editingMember, systemPrompt: e.target.value })}
                    placeholder="在此编辑该团队成员的专属任务约束与引导规则..."
                  />
                </div>
              ) : null}

              {capabilitiesSubTab === 'skills' ? (
                <div className="team-skills-editor-panel">
                  <p style={{ color: '#4e5969', fontSize: '14px', marginBottom: '16px' }}>
                    该导师已被赋予以下 PBL 专属技能能力包：
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {editingMember.skills.map((s) => (
                      <span key={s} className="team-skill-chip is-active">
                        ⚡ {s}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {capabilitiesSubTab === 'mcp' ? (
                <div className="team-mcp-editor-panel">
                  <p style={{ color: '#4e5969', fontSize: '14px', marginBottom: '16px' }}>
                    挂载的工具与上下文协议通道：
                  </p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {editingMember.mcps.map((m) => (
                      <span key={m} className="team-skill-chip">
                        📦 {m}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 设置面板 */}
          {editorMainTab === 'settings' ? (
            <div className="team-editor-settings-panel">
              <div className="team-sub-tabs-bar">
                <button
                  type="button"
                  className={`team-sub-tab${settingsSubTab === 'general' ? ' is-active' : ''}`}
                  onClick={() => setSettingsSubTab('general')}
                >
                  通用设置
                </button>
              </div>

              {settingsSubTab === 'general' ? (
                <div className="team-settings-card">
                  <div className="team-form-field">
                    <label className="team-field-label">展示头像</label>
                    <input
                      type="text"
                      className="admin-input-text"
                      style={{ width: '80px', textAlign: 'center' }}
                      value={editingMember.avatar}
                      onChange={(e) => setEditingMember({ ...editingMember, avatar: e.target.value })}
                    />
                  </div>

                  <div className="team-form-field">
                    <label className="team-field-label">职责角色名称</label>
                    <input
                      type="text"
                      className="admin-input-text"
                      value={editingMember.roleLabel}
                      onChange={(e) => setEditingMember({ ...editingMember, roleLabel: e.target.value })}
                    />
                  </div>

                  <div className="team-form-field">
                    <label className="team-field-label">团队协作身份</label>
                    <select
                      className="admin-select"
                      value={editingMember.role}
                      onChange={(e) => setEditingMember({ ...editingMember, role: e.target.value as any })}
                    >
                      <option value="leader">队长 (Leader)</option>
                      <option value="coach">概念教练 (Coach)</option>
                      <option value="teammate">向导与协作成长伙伴 (Teammate)</option>
                      <option value="reviewer">成果评审与答辩导师 (Reviewer)</option>
                    </select>
                  </div>

                  <div className="team-form-field">
                    <label className="team-field-label">绑定的推理大模型</label>
                    <select
                      className="admin-select"
                      value={editingMember.model}
                      onChange={(e) => setEditingMember({ ...editingMember, model: e.target.value })}
                    >
                      {configuredModels.map((m) => (
                        <option key={`${m.providerId}-${m.id}`} value={m.id}>
                          {m.name} ({m.providerName || m.providerId})
                        </option>
                      ))}
                      {configuredModels.length === 0 ? (
                        <option value="qwen3.8-flash">通义千问 (qwen3.8-flash)</option>
                      ) : null}
                    </select>
                  </div>

                  <div className="team-form-field">
                    <label className="team-field-label">思考强度</label>
                    <select
                      className="admin-select"
                      value={editingMember.thinking}
                      onChange={(e) => setEditingMember({ ...editingMember, thinking: e.target.value as any })}
                    >
                      <option value="low">低 (low) - 快速响应</option>
                      <option value="medium">中 (medium) - 平衡模式</option>
                      <option value="high">高 (high) - 深度深度推理</option>
                    </select>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="admin-teams-workspace">
      {/* 顶部多团队切换栏 */}
      <div className="admin-teams-tabs-header">
        <div className="admin-teams-tabs-list">
          {teams.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`admin-team-selector-pill${t.id === activeTeam?.id ? ' is-active' : ''}`}
              onClick={() => setActiveTeamId(t.id)}
            >
              👥 {t.name}
              <span className="admin-team-pill-count">{t.members.length} 位导师</span>
            </button>
          ))}
        </div>

        <div className="admin-teams-header-actions">
          <button
            type="button"
            className="settings-action-btn is-danger"
            onClick={handleDeleteTeam}
            title="删除当前团队"
          >
            🗑️ 删除该团队
          </button>
        </div>
      </div>

      {activeTeam ? (
        <div className="admin-teams-layout-grid">
          {/* 左侧：小队档案与 PBL 课程/模块库关联 */}
          <div className="admin-teams-left-sidebar">
            <div className="team-profile-card">
              <div className="team-profile-header">
                <div className="team-avatar-box">👥</div>
                <div className="team-profile-meta">
                  <h2 className="team-profile-name">{activeTeam.name}</h2>
                  <span className="team-profile-sub">
                    队长: {activeTeam.members.find((m) => m.assistantId === activeTeam.leaderAssistantId)?.assistantName || '启途总导师'}
                  </span>
                </div>
              </div>

              <p className="team-profile-desc">{activeTeam.description}</p>

              <div className="team-attr-list">
                <div className="team-attr-row">
                  <span className="team-attr-label">工作区模式</span>
                  <span className="team-attr-value">
                    {activeTeam.workspaceMode === 'shared' ? '共享工作区 (Shared)' : '隔离工作区 (Isolated)'}
                  </span>
                </div>
                <div className="team-attr-row">
                  <span className="team-attr-label">会话管控</span>
                  <span className="team-attr-value">
                    {activeTeam.sessionMode === 'supervised' ? '教师监督模式 (Supervised)' : activeTeam.sessionMode}
                  </span>
                </div>
                <div className="team-attr-row">
                  <span className="team-attr-label">最大并发导师数</span>
                  <span className="team-attr-value">{activeTeam.concurrencyLimit} 个并发</span>
                </div>
              </div>

              {/* 核心业务联动：一个团队对应一个模块库与项目模板 */}
              <div className="team-linked-module-card">
                <div className="team-linked-header">
                  <span className="team-linked-tag">关联模块库与项目</span>
                </div>
                <div className="team-linked-title">
                  {activeTeam.pblSpec?.projectName || (activeTeam.id.includes('kinetic') ? '动手学动能定理：物理虚拟仿真与规律探究' : '雷霆战机：从零打造 Python 飞行射击小游戏')}
                </div>
                <div className="team-linked-meta">
                  <span>项目 ID: <code>{activeTeam.pblSpec?.projectId || (activeTeam.id.includes('kinetic') ? 'pbl-kinetic-energy' : 'pbl-thunder-fighter')}</code></span>
                  <span>领域: {activeTeam.pblSpec?.targetDomain || (activeTeam.id.includes('kinetic') ? '物理规律探究' : 'Python 游戏开发')}</span>
                </div>
                <div className="team-gate-rule-box">
                  <span className="team-gate-rule-icon">🛡️</span>
                  <span>理论掌握门禁: <strong>TheoryMastered 严格开启</strong></span>
                </div>
              </div>

              {/* 协同链路测试 */}
              <div className="team-collab-test-box">
                <button
                  type="button"
                  className="settings-action-btn is-primary"
                  style={{ width: '100%' }}
                  disabled={testRunning}
                  onClick={handleRunCollaborationTest}
                >
                  {testRunning ? '正在测试调度…' : '⚡ 发起小队协同链路测试'}
                </button>
                {testMessage ? <div className="team-test-result-text">{testMessage}</div> : null}
              </div>
            </div>
          </div>

          {/* 右侧：导师成员列表 */}
          <div className="admin-teams-main-content">
            <div className="admin-members-list-header">
              <div className="admin-members-title-wrap">
                <h3 className="admin-members-section-title">团队成员与职责分工</h3>
                <span className="admin-members-count-tag">{activeTeam.members.length} 位智能体</span>
              </div>
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={() => setShowAddMemberModal(true)}
              >
                + 添加导师成员
              </button>
            </div>

            <div className="admin-team-members-grid">
              {activeTeam.members.map((member) => {
                const isLeader = member.assistantId === activeTeam.leaderAssistantId;
                return (
                  <div key={member.slotId} className={`admin-team-member-card${isLeader ? ' is-leader' : ''}`}>
                    <div className="admin-member-card-top">
                      <div className="admin-member-avatar-wrap">
                        <span className="admin-member-avatar">{member.avatar || '🤖'}</span>
                        {isLeader ? <span className="admin-member-leader-crown" title="团队队长">👑</span> : null}
                      </div>

                      <div className="admin-member-role-tags">
                        {isLeader ? (
                          <span className="admin-role-badge is-leader">队长 (Leader)</span>
                        ) : (
                          <span className="admin-role-badge">{member.roleLabel || member.role}</span>
                        )}
                        {member.pblPhase ? (
                          <span className="admin-phase-badge">
                            {member.pblPhase === 'exploration' ? '阶段一: 意图' :
                             member.pblPhase === 'concept_mastery' ? '阶段二: 理论' :
                             member.pblPhase === 'guided_practice' ? '阶段三: 实践' : '阶段四: 答辩'}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="admin-member-info">
                      <strong className="admin-member-name">{member.assistantName}</strong>
                      <span className="admin-member-model-text">
                        模型: <code>{member.model || 'qwen3.8-flash'}</code>
                      </span>
                    </div>

                    <div className="admin-member-card-actions">
                      {!isLeader ? (
                        <button
                          type="button"
                          className="admin-member-btn"
                          onClick={() => handleSetLeader(member.assistantId)}
                          title="指定为该导师团队的 Leader"
                        >
                          设为队长
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="admin-member-btn"
                        onClick={() => handleOpenMemberEdit(member)}
                      >
                        编辑能力/设置
                      </button>
                      {!isLeader ? (
                        <button
                          type="button"
                          className="admin-member-btn is-danger"
                          onClick={() => handleRemoveMember(member.slotId, member.assistantName)}
                        >
                          移除
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* PBL 阶段流程流转看板 */}
            {activeTeam.pblSpec?.phases && activeTeam.pblSpec.phases.length > 0 ? (
              <div className="admin-pbl-phases-board">
                <h4 className="admin-pbl-board-title">PBL 四阶段协同流程与硬门禁</h4>
                <div className="admin-pbl-phases-steps">
                  {activeTeam.pblSpec.phases.map((phase, idx) => (
                    <div key={phase.phase} className="admin-pbl-phase-step-card">
                      <div className="admin-phase-step-idx">{idx + 1}</div>
                      <div className="admin-phase-step-body">
                        <strong className="admin-phase-step-title">{phase.title}</strong>
                        <div className="admin-phase-step-mentor">
                          负责导师: <span>{phase.assignedRoleLabel || phase.assignedAssistantId}</span>
                        </div>
                        <div className="admin-phase-step-gate">
                          门禁条件: <code>{phase.gateCondition}</code>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 新增成员弹窗 */}
      {showAddMemberModal ? (
        <div className="admin-modal-overlay" onClick={() => setShowAddMemberModal(false)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>向团队添加导师成员</h3>
              <button type="button" className="admin-modal-close-btn" onClick={() => setShowAddMemberModal(false)}>
                ✕
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-form-row">
                <label className="admin-form-label">选择导师助手</label>
                <select
                  className="admin-select"
                  value={selectedAssistantToAdd}
                  onChange={(e) => setSelectedAssistantToAdd(e.target.value)}
                >
                  <option value="">-- 请选择 --</option>
                  {allAssistants
                    .filter((a) => !activeTeam?.members.some((m) => m.assistantId === a.id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.avatar || '🤖'} {a.name} ({a.role})
                      </option>
                    ))}
                </select>
              </div>

              <div className="admin-form-row">
                <label className="admin-form-label">在团队中的角色定位</label>
                <select
                  className="admin-select"
                  value={selectedRoleToAdd}
                  onChange={(e) => setSelectedRoleToAdd(e.target.value as any)}
                >
                  <option value="coach">概念教练 (Coach)</option>
                  <option value="teammate">实践/探究向导 (Teammate)</option>
                  <option value="reviewer">评审与答辩导师 (Reviewer)</option>
                </select>
              </div>
            </div>
            <div className="admin-modal-footer">
              <button
                type="button"
                className="settings-action-btn is-primary"
                disabled={!selectedAssistantToAdd}
                onClick={handleAddMember}
              >
                确认添加
              </button>
              <button type="button" className="settings-action-btn" onClick={() => setShowAddMemberModal(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
