'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AdminTeamConfig,
  AdminTeamMember,
  AdminAssistantConfig,
  AdminTeamUpdateInput,
} from '@qitu/contracts';
import {
  fetchAdminTeamConfigs,
  createPersistedTeam,
  updatePersistedTeam,
  deletePersistedTeam,
} from '../../../../lib/api/teams';
import { fetchAdminAssistantConfigs } from '../../../../lib/api/assistants';
import { fetchAvailableConfiguredModels, type ConfiguredModelItem } from '../../../../lib/api/configuredModels';
import { newIdempotencyKey } from '../../../../lib/api/modelRegistry';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { TeamCard } from './components/TeamCard';
import { TeamDetailView } from './components/TeamDetailView';
import { MemberEditor } from './components/MemberEditor';
import { AddMemberModal } from './components/AddMemberModal';
import './teams.css';
import './components/modals.css';

export default function AdminTeamsPage() {
  const [teams, setTeams] = useState<AdminTeamConfig[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string>('');
  const [allAssistants, setAllAssistants] = useState<AdminAssistantConfig[]>([]);
  const [configuredModels, setConfiguredModels] = useState<ConfiguredModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // 视图状态
  const [viewMode, setViewMode] = useState<'list' | 'detail' | 'member-edit'>('list');
  const [viewingTeamId, setViewingTeamId] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<AdminTeamMember | null>(null);

  // 模态框状态
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showCreateTeamModal, setShowCreateTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teamsData, assistantsData, modelsData] = await Promise.all([
        fetchAdminTeamConfigs().catch(() => []),
        fetchAdminAssistantConfigs().catch(() => []),
        fetchAvailableConfiguredModels().catch(() => []),
      ]);

      let customTeams: AdminTeamConfig[] = [];
      if (typeof window !== 'undefined') {
        try {
          const cached = localStorage.getItem('qitu.admin.custom_teams');
          if (cached) {
            customTeams = JSON.parse(cached);
          }
        } catch {}
      }

      const existingIds = new Set(teamsData.map((t) => t.id));
      const combined = [...customTeams.filter((t) => !existingIds.has(t.id)), ...teamsData];

      setTeams(combined);
      setAllAssistants(assistantsData);
      setConfiguredModels(modelsData);

      const firstTeam = combined[0];
      if (firstTeam !== undefined && !activeTeamId) {
        setActiveTeamId(firstTeam.id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('团队数据加载失败'));
    } finally {
      setLoading(false);
    }
  }, [activeTeamId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeTeam = useMemo(() => {
    return teams.find((t) => t.id === activeTeamId) || teams[0] || null;
  }, [teams, activeTeamId]);

  const viewingTeam = useMemo(() => {
    return viewingTeamId ? teams.find((t) => t.id === viewingTeamId) : null;
  }, [teams, viewingTeamId]);

  // 创建团队
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

  // 更新团队
  const handleUpdateTeam = async (teamId: string, updates: AdminTeamUpdateInput) => {
    try {
      const updated = await updatePersistedTeam(teamId, updates, newIdempotencyKey());
      setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err: any) {
      alert(`更新团队失败：${err?.message || '网络异常'}`);
      throw err;
    }
  };

  // 删除团队
  const handleDeleteTeam = async (teamId: string, teamName: string) => {
    const ok = window.confirm(`确定要彻底删除团队「${teamName}」吗？\n删除后不可恢复。`);
    if (!ok) return;

    try {
      await deletePersistedTeam(teamId, newIdempotencyKey());
      const nextTeams = teams.filter((t) => t.id !== teamId);
      setTeams(nextTeams);
      if (viewingTeamId === teamId) {
        setViewMode('list');
        setViewingTeamId(null);
      }
      if (activeTeamId === teamId) {
        setActiveTeamId(nextTeams[0]?.id || '');
      }
    } catch (err: any) {
      alert(`删除团队失败：${err?.message || '操作异常'}`);
    }
  };

  // 打开团队详情
  const handleOpenTeamDetail = (teamId: string) => {
    setViewingTeamId(teamId);
    setViewMode('detail');
  };

  // 返回团队列表
  const handleBackToList = () => {
    setViewMode('list');
    setViewingTeamId(null);
  };

  // 打开成员编辑器
  const handleOpenMemberEdit = (member: AdminTeamMember) => {
    setEditingMember(member);
    setViewMode('member-edit');
  };

  // 关闭成员编辑器
  const handleCloseMemberEdit = () => {
    setEditingMember(null);
    setViewMode('detail');
  };

  // 添加成员
  const handleAddMember = async (assistantId: string, role: 'leader' | 'teammate' | 'coach' | 'reviewer') => {
    if (!viewingTeam) return;

    const assistant = allAssistants.find((a) => a.id === assistantId);
    if (!assistant) return;

    if (viewingTeam.members.some((m) => m.assistantId === assistant.id)) {
      alert('该助手已在团队中。');
      return;
    }

    try {
      const updatedMembers = [
        ...viewingTeam.members.map((m) => ({
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
          role: role,
          roleLabel: assistant.role,
          model: assistant.modelId || undefined,
          color: '#2878f0',
        },
      ];

      await handleUpdateTeam(viewingTeam.id, { members: updatedMembers });
      setShowAddMemberModal(false);
    } catch (err: any) {
      alert(`添加成员失败：${err?.message || '操作失败'}`);
    }
  };

  // 移除成员
  const handleRemoveMember = async (slotId: string, memberName: string) => {
    if (!viewingTeam) return;

    if (viewingTeam.members.length <= 1) {
      alert('团队中必须至少保留一名成员。');
      return;
    }

    const memberToRemove = viewingTeam.members.find((m) => m.slotId === slotId);
    if (memberToRemove && memberToRemove.assistantId === viewingTeam.leaderAssistantId) {
      alert('不能直接移除团队队长。请先指定另一名成员为队长后再移除。');
      return;
    }

    if (!window.confirm(`确认将「${memberName}」从该导师团队中移除吗？`)) return;

    try {
      const remainingMembers = viewingTeam.members
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

      await handleUpdateTeam(viewingTeam.id, { members: remainingMembers });
    } catch (err: any) {
      alert(`移除成员失败：${err?.message || '操作未执行'}`);
    }
  };

  // 设为队长
  const handleSetLeader = async (assistantId: string) => {
    if (!viewingTeam) return;
    try {
      await handleUpdateTeam(viewingTeam.id, { leaderAssistantId: assistantId });
    } catch (err: any) {
      alert(`设置队长失败：${err?.message || '网络异常'}`);
    }
  };

  // 保存成员编辑
  const handleSaveMemberEdit = async (updates: Partial<AdminTeamMember>) => {
    if (!editingMember || !viewingTeam) return;

    try {
      const updatedMembers = viewingTeam.members.map((m) => {
        if (m.assistantId === editingMember.assistantId) {
          return {
            slotId: m.slotId,
            assistantId: m.assistantId,
            role: updates.role || m.role,
            roleLabel: updates.roleLabel || m.roleLabel,
            model: updates.model || m.model,
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

      await handleUpdateTeam(viewingTeam.id, { members: updatedMembers });
      handleCloseMemberEdit();
    } catch (err: any) {
      alert(`保存成员失败：${err?.message || '保存异常'}`);
    }
  };

  // 创建新助手
  const handleCreateNewAssistant = () => {
    // 跳转到助手创建页面
    window.location.href = '/settings/assistants?action=create';
  };

  const stateView = AdminStateViews({ loading, error, onRetry: loadData });
  if (stateView && teams.length === 0) {
    return <div className="admin-settings-page">{stateView}</div>;
  }

  // 成员编辑器视图
  if (viewMode === 'member-edit' && editingMember && viewingTeam) {
    const assistant = allAssistants.find((a) => a.id === editingMember.assistantId);
    return (
      <MemberEditor
        member={editingMember}
        assistant={assistant}
        configuredModels={configuredModels}
        onSave={handleSaveMemberEdit}
        onClose={handleCloseMemberEdit}
      />
    );
  }

  // 团队详情视图
  if (viewMode === 'detail' && viewingTeam) {
    return (
      <div className="admin-settings-page">
        <TeamDetailView
          team={viewingTeam}
          allAssistants={allAssistants}
          onBack={handleBackToList}
          onUpdateTeam={(updates) => handleUpdateTeam(viewingTeam.id, updates)}
          onOpenMemberEdit={handleOpenMemberEdit}
          onRemoveMember={handleRemoveMember}
          onSetLeader={handleSetLeader}
        />

        {showAddMemberModal && (
          <AddMemberModal
            isOpen={showAddMemberModal}
            allAssistants={allAssistants}
            existingMemberIds={viewingTeam.members.map((m) => m.assistantId)}
            onClose={() => setShowAddMemberModal(false)}
            onAdd={handleAddMember}
            onCreateNew={handleCreateNewAssistant}
          />
        )}
      </div>
    );
  }

  // 团队列表视图（卡片模式）
  return (
    <div className="admin-settings-page">
      <div className="settings-page-header">
        <div>
          <h1 className="settings-page-title">团队管理</h1>
          <p className="settings-page-desc">配置 PBL 导师团队与协作调度策略</p>
        </div>
        <button
          type="button"
          className="settings-action-btn is-primary"
          onClick={() => setShowCreateTeamModal(true)}
        >
          + 创建新团队
        </button>
      </div>

      {stateView ? (
        stateView
      ) : (
        <div className="teams-grid">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              isActive={team.id === activeTeamId}
              onClick={() => {
                setActiveTeamId(team.id);
                handleOpenTeamDetail(team.id);
              }}
              onDelete={(e) => {
                e.stopPropagation();
                handleDeleteTeam(team.id, team.name);
              }}
            />
          ))}
        </div>
      )}

      {/* 创建团队模态框 */}
      {showCreateTeamModal && (
        <div className="modal-overlay" onClick={() => setShowCreateTeamModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>创建新团队</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowCreateTeamModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>团队名称</label>
                <input
                  type="text"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="例如：Python 编程导师团"
                />
              </div>

              <div className="form-group">
                <label>团队描述</label>
                <textarea
                  value={newTeamDesc}
                  onChange={(e) => setNewTeamDesc(e.target.value)}
                  placeholder="简要描述团队职责和协作方式..."
                  rows={4}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="modal-action-btn is-primary"
                onClick={handleCreateTeam}
              >
                创建团队
              </button>
              <button
                type="button"
                className="modal-action-btn"
                onClick={() => setShowCreateTeamModal(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
