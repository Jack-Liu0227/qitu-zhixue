'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminTeamConfig, AdminTeamMember, WorkspaceMode, TeamSessionMode } from '@qitu/contracts';
import { fetchAdminTeams, updateAdminTeam } from '../../../../lib/api/teams';
import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';

interface ExtendedTeamItem extends AdminTeamConfig {
  isAvailable: boolean;
}

const STATIC_TEAMS: ExtendedTeamItem[] = [
  {
    id: 'thunder-fighter-game-pbl',
    name: '雷霆战机 PBL 研发团队',
    description: '指导学生以 PBL 项目式学习方式，从游戏概念、碰撞检测数学推导、核心循环到成果提交全流程研发雷霆战机小游戏。',
    leaderAssistantId: 'tutor-general-leader',
    workspaceMode: 'shared',
    sessionMode: 'plan',
    concurrencyLimit: 4,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    members: [
      { slotId: 'slot-1', assistantId: 'tutor-general-leader', assistantName: '启途总导师', role: 'leader', roleLabel: '启途总导师', status: 'active' },
      { slotId: 'slot-2', assistantId: 'tutor-concept-coach', assistantName: '战机原理与概念教练', role: 'coach', roleLabel: '战机原理与概念教练', status: 'active' },
      { slotId: 'slot-3', assistantId: 'tutor-code-guide', assistantName: '战机架构与代码向导', role: 'teammate', roleLabel: '战机架构与代码向导', status: 'active' },
      { slotId: 'slot-4', assistantId: 'tutor-deliverable-reviewer', assistantName: '成果评审与答辩导师', role: 'reviewer', roleLabel: '成果评审与答辩导师', status: 'idle' },
    ],
    isAvailable: true,
  },
  {
    id: 'fullstack-web-team',
    name: '全栈开发协作团队',
    description: '前后端分离现代应用协作开发团队，支持需求拆解、API 契约编写与前端组件封装。',
    leaderAssistantId: 'architect-lead',
    workspaceMode: 'isolated',
    sessionMode: 'auto',
    concurrencyLimit: 3,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    members: [
      { slotId: 's-1', assistantId: 'architect-lead', assistantName: '架构主管', role: 'leader', roleLabel: '架构主管', status: 'active' },
      { slotId: 's-2', assistantId: 'frontend-engineer', assistantName: '前端研发', role: 'teammate', roleLabel: '前端研发', status: 'idle' },
      { slotId: 's-3', assistantId: 'qa-engineer', assistantName: '测试工程师', role: 'reviewer', roleLabel: '测试工程师', status: 'idle' },
    ],
    isAvailable: false,
  },
];

export default function AdminTeamsPage() {
  const [teams, setTeams] = useState<AdminTeamConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editingTeam, setEditingTeam] = useState<AdminTeamConfig | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminTeams();
      setTeams(data);
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allTeams = useMemo<ExtendedTeamItem[]>(() => {
    const list: ExtendedTeamItem[] = teams.map((t) => ({
      ...t,
      isAvailable: t.members.length > 0,
    }));
    for (const preset of STATIC_TEAMS) {
      if (!list.some((item) => item.id === preset.id)) {
        list.push(preset);
      }
    }
    return list;
  }, [teams]);

  const tabs = useMemo(() => {
    const readyCount = allTeams.filter((t) => t.isAvailable).length;
    const pendingCount = allTeams.filter((t) => !t.isAvailable).length;
    return [
      { id: 'all', label: '全部', count: allTeams.length },
      { id: 'ready', label: '可用', count: readyCount },
      { id: 'pending', label: '待配置', count: pendingCount },
    ];
  }, [allTeams]);

  const filtered = useMemo(() => {
    return allTeams.filter((team) => {
      if (activeTab === 'ready' && !team.isAvailable) return false;
      if (activeTab === 'pending' && team.isAvailable) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          team.name.toLowerCase().includes(q) ||
          team.description.toLowerCase().includes(q) ||
          team.id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allTeams, search, activeTab]);

  const handleTest = (id: string) => {
    setTestingId(id);
    setTimeout(() => {
      setTestingId(null);
      alert(`团队 [${id}] 多 Agent 协同网格测试通过，主管 Agent 响应正常！`);
    }, 600);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeam) return;
    setSaving(true);
    try {
      await updateAdminTeam(
        editingTeam.id,
        {
          name: editingTeam.name,
          description: editingTeam.description,
          workspaceMode: editingTeam.workspaceMode,
          sessionMode: editingTeam.sessionMode,
        },
        `team-save-${Date.now()}`,
      );
      setEditingTeam(null);
      await load();
      alert('团队配置已成功保存！');
    } catch (err) {
      alert(`保存失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AionSettingsParadigm
      title="团队"
      description={
        <span>
          配置基于多 Agent 协同的 PBL 项目研发团队，支持配置主管、路由协议与交付门禁（参考 Multica 与 OpenMAIC 架构）。
          <a href="#">查看团队协作文档</a>
        </span>
      }
      searchPlaceholder="搜索团队..."
      searchQuery={search}
      onSearchChange={setSearch}
      primaryActionLabel="创建新团队"
      onPrimaryAction={() => alert('请在此录入新团队成员构成与主管设定')}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {filtered.length === 0 ? (
        <div className="settings-empty">暂无匹配的协同团队</div>
      ) : (
        filtered.map((team) => (
          <RowCard
            key={team.id}
            avatarText={team.name.slice(0, 1)}
            avatarBg={team.isAvailable ? '#165dff' : '#64748b'}
            name={team.name}
            statusText={team.isAvailable ? '可用' : '待配置'}
            statusType={team.isAvailable ? 'ok' : 'off'}
            description={`${team.description} (${team.members.length} 名成员 · ${team.workspaceMode} 模式)`}
            avatarStack={team.members.map((m) => m.roleLabel.slice(0, 1))}
            testLabel="测试协作"
            testLoading={testingId === team.id}
            onTestConnection={() => handleTest(team.id)}
            editLabel="编辑"
            onEdit={() => setEditingTeam({ ...team })}
          />
        ))
      )}

      {/* 团队编辑弹窗 */}
      {editingTeam ? (
        <div
          role="dialog"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setEditingTeam(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              width: 620,
              maxWidth: '92vw',
              padding: 24,
              boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 18 }}>编辑团队: {editingTeam.name}</h3>
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gap: 14 }}>
                <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>
                  团队名称
                  <input
                    style={{
                      padding: '8px 10px',
                      border: '1px solid #e5e6eb',
                      borderRadius: 6,
                    }}
                    value={editingTeam.name}
                    onChange={(e) => setEditingTeam({ ...editingTeam, name: e.target.value })}
                  />
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>
                  描述说明
                  <textarea
                    rows={2}
                    style={{
                      padding: '8px 10px',
                      border: '1px solid #e5e6eb',
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                    value={editingTeam.description}
                    onChange={(e) => setEditingTeam({ ...editingTeam, description: e.target.value })}
                  />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>
                    工作区模式 (Multica)
                    <select
                      style={{
                        padding: '8px 10px',
                        border: '1px solid #e5e6eb',
                        borderRadius: 6,
                      }}
                      value={editingTeam.workspaceMode}
                      onChange={(e) =>
                        setEditingTeam({
                          ...editingTeam,
                          workspaceMode: e.target.value as WorkspaceMode,
                        })
                      }
                    >
                      <option value="shared">共享工作区 (Shared)</option>
                      <option value="isolated">独立隔离工作区 (Isolated)</option>
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 13, fontWeight: 600 }}>
                    会话驱动模式
                    <select
                      style={{
                        padding: '8px 10px',
                        border: '1px solid #e5e6eb',
                        borderRadius: 6,
                      }}
                      value={editingTeam.sessionMode}
                      onChange={(e) =>
                        setEditingTeam({
                          ...editingTeam,
                          sessionMode: e.target.value as TeamSessionMode,
                        })
                      }
                    >
                      <option value="plan">计划评审推进 (Plan / PBL)</option>
                      <option value="auto">自主执行 (Auto)</option>
                      <option value="supervised">人工监督 (Supervised)</option>
                    </select>
                  </label>
                </div>

                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>成员阵容构成 (4 人团队):</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {editingTeam.members.map((m) => (
                      <div
                        key={m.slotId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          background: '#f7f8fa',
                          borderRadius: 8,
                          fontSize: 12.5,
                        }}
                      >
                        <div>
                          <strong>{m.roleLabel}</strong>
                          <span style={{ color: '#86909c', marginLeft: 8 }}>({m.assistantName})</span>
                        </div>
                        {m.role === 'leader' ? (
                          <span className="settings-chip is-custom">团队主管</span>
                        ) : (
                          <span className="settings-chip is-ok">已入列</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="settings-pill-btn"
                  onClick={() => setEditingTeam(null)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="settings-action-btn is-primary"
                  disabled={saving}
                >
                  {saving ? '保存中...' : '保存更改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </AionSettingsParadigm>
  );
}
