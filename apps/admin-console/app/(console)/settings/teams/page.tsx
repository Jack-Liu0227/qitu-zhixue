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
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teamsData, assistantsData, modelsData] = await Promise.all([
        fetchAdminTeamConfigs(),
        fetchAdminAssistantConfigs(),
        fetchAvailableConfiguredModels(),
      ]);

      // The server registry is the only source of truth. Do not merge
      // browser-local drafts here: deleted teams/assistants would reappear
      // after a refresh and could be shown as selectable runtime objects.
      setTeams(teamsData);
      setAllAssistants(assistantsData);
      setConfiguredModels(modelsData);

      const firstTeam = teamsData[0];
      setActiveTeamId((current) => teamsData.some((team) => team.id === current) ? current : firstTeam?.id ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('团队数据加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // 当带有 ?teamId=... 或 ?id=... 参数时，自动切换到该团队的详情/成员编辑视图
  useEffect(() => {
    if (typeof window !== 'undefined' && teams.length > 0) {
      const params = new URLSearchParams(window.location.search);
      const targetId = params.get('teamId') || params.get('id');
      if (targetId) {
        const found = teams.find((t) => t.id === targetId);
        if (found) {
          setActiveTeamId(targetId);
          setViewingTeamId(targetId);
          setViewMode('detail');
        }
      }
    }
  }, [teams]);

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
    const defaultLeader = allAssistants.find((assistant) => assistant.enabled && assistant.teamSelectable)?.id || 'assistant-default';
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

  // 切换团队启用状态
  const handleToggleTeamEnabled = async (teamId: string, currentEnabled: boolean) => {
    const next = !currentEnabled;
    try {
      await handleUpdateTeam(teamId, { enabled: next });
    } catch (err: any) {
      alert(`更新团队状态失败：${err?.message || '异常'}`);
    }
  };

  // 批量启用/停用团队
  const handleBulkSetEnabled = async (enabled: boolean) => {
    const ids = [...selected];
    const results = await Promise.allSettled(ids.map((id) => updatePersistedTeam(id, { enabled }, newIdempotencyKey())));
    const failed = ids.filter((_, index) => results[index]?.status === 'rejected');
    try {
      setTeams(await fetchAdminTeamConfigs()); setSelected(new Set(failed));
      if (failed.length) setError(new Error(`${ids.length - failed.length} 项已回读确认，${failed.length} 项失败，请重试选中项。`));
    } catch (cause) { setError(cause instanceof Error ? cause : new Error('批量结果回读失败')); }
  };

  const handleBulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length || !window.confirm(`确认删除选中的 ${ids.length} 个未使用团队？`)) return;
    const results = await Promise.allSettled(ids.map((id) => deletePersistedTeam(id, newIdempotencyKey())));
    try {
      const current = await fetchAdminTeamConfigs();
      const failed = ids.filter((id, index) => results[index]?.status === 'rejected' || current.some((team) => team.id === id));
      setTeams(current); setSelected(new Set(failed));
      if (failed.length) setError(new Error(`${failed.length} 项未删除，已保留选中状态。历史引用的团队请停用。`));
    } catch (cause) { setError(cause instanceof Error ? cause : new Error('删除结果回读失败')); }
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
        if (m.slotId === editingMember.slotId) {
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
      throw err;
    }
  };

  // 创建新助手
  const handleCreateNewAssistant = () => {
    // 跳转到助手创建页面
    window.location.href = '/admin/settings/assistants?action=create';
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
          onAddMember={() => setShowAddMemberModal(true)}
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
      <div className="settings-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 className="settings-page-title">团队管理</h1>
          <p className="settings-page-desc">配置 PBL 导师团队与协作调度策略</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#475569', cursor: 'pointer', marginRight: '6px' }}>
            <input
              type="checkbox"
              checked={teams.length > 0 && teams.every((t) => selected.has(t.id))}
              onChange={(e) => {
                if (e.target.checked) setSelected(new Set(teams.map((t) => t.id)));
                else setSelected(new Set());
              }}
              style={{ width: '15px', height: '15px', cursor: 'pointer' }}
            />
            <span>全选 ({selected.size}/{teams.length})</span>
          </label>
          {selected.size > 0 && (
            <>
              <button
                type="button"
                className="settings-action-btn"
                style={{ padding: '6px 12px', fontSize: '12.5px' }}
                onClick={() => void handleBulkSetEnabled(true)}
              >
                批量启用
              </button>
              <button
                type="button"
                className="settings-action-btn"
                style={{ padding: '6px 12px', fontSize: '12.5px' }}
                onClick={() => void handleBulkSetEnabled(false)}
              >
                批量停用
              </button>
              <button
                type="button"
                className="settings-action-btn is-danger"
                style={{ padding: '6px 12px', fontSize: '12.5px', color: '#dc2626', borderColor: '#fecaca', background: '#fef2f2' }}
                onClick={() => void handleBulkDelete()}
              >
                批量删除 ({selected.size})
              </button>
            </>
          )}
          <button
            type="button"
            className="settings-action-btn is-primary"
            onClick={() => setShowCreateTeamModal(true)}
          >
            + 创建新团队
          </button>
        </div>
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
              isSelected={selected.has(team.id)}
              onToggleSelect={() => {
                const next = new Set(selected);
                if (next.has(team.id)) next.delete(team.id);
                else next.add(team.id);
                setSelected(next);
              }}
              onToggleEnabled={() => void handleToggleTeamEnabled(team.id, team.enabled !== false)}
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
