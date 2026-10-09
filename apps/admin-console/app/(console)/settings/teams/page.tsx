'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminTeamConfig, AdminTeamMember, PblPhaseSpec } from '@qitu/contracts';
import { Badge, Button, EmptyState, InfoRow, SectionCard } from '@qitu/ui';
import { fetchAdminTeams, updateAdminTeam } from '../../../../lib/api/teams';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { SettingsSubNav } from '../../../../lib/components/SettingsSubNav';
import '../ai-runtime/ai-runtime.css';

function pblPhaseBadge(phase: string) {
  switch (phase) {
    case 'exploration':
      return <Badge tone="primary">阶段一 · 意图确认</Badge>;
    case 'concept_mastery':
      return <Badge tone="completed">阶段二 · 概念掌握</Badge>;
    case 'guided_practice':
      return <Badge tone="primary">阶段三 · 代码实践</Badge>;
    case 'deliverable_review':
      return <Badge tone="neutral">阶段四 · 作品评审</Badge>;
    default:
      return <Badge tone="neutral">{phase}</Badge>;
  }
}

export default function AdminTeamsPage() {
  const [teams, setTeams] = useState<AdminTeamConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AdminTeamConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminTeams();
      setTeams(data);
      if (data.length > 0 && !selectedId) {
        setSelectedId(data[0]?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('加载团队列表失败'));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [teams, search]);

  const activeTeam = useMemo(
    () => teams.find((t) => t.id === selectedId) ?? teams[0] ?? null,
    [teams, selectedId],
  );

  const handleEditOpen = (team: AdminTeamConfig) => {
    setEditing({ ...team });
    setSaveMessage(null);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const updated = await updateAdminTeam(
        editing.id,
        {
          name: editing.name,
          description: editing.description,
          workspaceMode: editing.workspaceMode,
          sessionMode: editing.sessionMode,
          concurrencyLimit: editing.concurrencyLimit,
          enabled: editing.enabled,
        },
        `team-${editing.id}-${Date.now()}`,
      );
      setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setSaveMessage('团队配置已保存并同步至运行时');
      setEditing(null);
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : '更新团队失败');
    } finally {
      setSaving(false);
    }
  };

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) {
    return (
      <div className="admin-page-container">
        <SettingsSubNav />
        {stateView}
      </div>
    );
  }

  return (
    <div className="admin-page-container">
      <SettingsSubNav />

      <div className="admin-page-header">
        <div className="admin-page-header-title">
          <h1>团队设置 (Teams)</h1>
          <Badge tone="completed">已配置 {teams.length} 组协作团队</Badge>
        </div>
        <p>参考 Multica 团队编排架构，管理多智能体协作团队成员配属、工作空间模式与 PBL 学习流程</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '24px', marginTop: '20px' }}>
        {/* Left: Teams Table */}
        <div>
          <SectionCard
            title="团队列表"
            action={
              <input
                type="search"
                placeholder="搜索团队名称..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--qitu-border)',
                  fontSize: '0.85rem',
                }}
              />
            }
          >
            {filtered.length === 0 ? (
              <EmptyState title="未找到团队" description="暂无符合搜索条件的团队。" />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--qitu-border)', color: 'var(--qitu-muted)' }}>
                      <th style={{ padding: '10px 8px' }}>团队名称</th>
                      <th style={{ padding: '10px 8px' }}>Leader 助手</th>
                      <th style={{ padding: '10px 8px' }}>成员数</th>
                      <th style={{ padding: '10px 8px' }}>工作区模式</th>
                      <th style={{ padding: '10px 8px' }}>执行模式</th>
                      <th style={{ padding: '10px 8px', textAlign: 'right' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => {
                      const isSelected = item.id === activeTeam?.id;
                      return (
                        <tr
                          key={item.id}
                          onClick={() => setSelectedId(item.id)}
                          style={{
                            borderBottom: '1px solid var(--qitu-border-subtle, #eee)',
                            backgroundColor: isSelected ? 'var(--qitu-bg-hover, #f0f7ff)' : 'transparent',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease',
                          }}
                        >
                          <td style={{ padding: '12px 8px', fontWeight: 600 }}>
                            <span style={{ marginRight: '6px' }}>👥</span>
                            {item.name}
                            {item.pblSpec && (
                              <span style={{ marginLeft: '6px', fontSize: '0.72rem', color: 'var(--qitu-primary)' }}>
                                [PBL专属]
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '12px 8px', color: 'var(--qitu-text-secondary, #555)' }}>
                            <code>{item.leaderAssistantId}</code>
                          </td>
                          <td style={{ padding: '12px 8px' }}>{item.members.length} 人</td>
                          <td style={{ padding: '12px 8px' }}>
                            <Badge tone={item.workspaceMode === 'shared' ? 'completed' : 'primary'}>
                              {item.workspaceMode === 'shared' ? '共享工作区' : '独立隔离'}
                            </Badge>
                          </td>
                          <td style={{ padding: '12px 8px' }}>
                            <span style={{ fontSize: '0.82rem', color: '#666' }}>{item.sessionMode}</span>
                          </td>
                          <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e: React.MouseEvent) => {
                                e.stopPropagation();
                                handleEditOpen(item);
                              }}
                            >
                              配置
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        {/* Right: Team Inspector */}
        <div>
          {activeTeam ? (
            <div style={{ display: 'grid', gap: '18px' }}>
              <SectionCard
                title={`团队架构 · ${activeTeam.name}`}
                action={
                  <Button size="sm" onClick={() => handleEditOpen(activeTeam)}>
                    团队设定
                  </Button>
                }
              >
                <div style={{ display: 'grid', gap: '12px' }}>
                  <InfoRow label="团队 ID" value={<code>{activeTeam.id}</code>} />
                  <InfoRow label="团队说明" value={activeTeam.description} />
                  <InfoRow
                    label="工作区共享 (Multica)"
                    value={
                      activeTeam.workspaceMode === 'shared'
                        ? 'Shared (成员共享同一项目工作区与上下文)'
                        : 'Isolated (成员隔离独立工作区)'
                    }
                  />
                  <InfoRow
                    label="会话管控模式"
                    value={
                      activeTeam.sessionMode === 'supervised'
                        ? 'Supervised (导师全程协同监管与门禁把控)'
                        : activeTeam.sessionMode
                    }
                  />
                  <InfoRow label="最大并发数" value={String(activeTeam.concurrencyLimit)} />
                </div>
              </SectionCard>

              {/* Multica-style Member Roster */}
              <SectionCard title="成员花名册 (Team Roster)">
                <div style={{ display: 'grid', gap: '10px' }}>
                  {activeTeam.members.map((member: AdminTeamMember) => (
                    <div
                      key={member.slotId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        border: '1px solid var(--qitu-border)',
                        borderRadius: '6px',
                        backgroundColor: '#fff',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '1.25rem' }}>{member.avatar || '🤖'}</span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                            {member.assistantName}
                            {member.role === 'leader' && (
                              <span style={{ marginLeft: '6px', fontSize: '0.72rem', color: '#c05621' }}>
                                ★ Leader
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--qitu-muted)' }}>
                            {member.roleLabel}
                          </div>
                        </div>
                      </div>
                      <div>
                        {member.pblPhase && pblPhaseBadge(member.pblPhase)}
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              {/* PBL Workflow Spec (OpenMAIC) */}
              {activeTeam.pblSpec && (
                <SectionCard title="PBL 全流程任务链路 (OpenMAIC 互动课堂)">
                  <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--qitu-muted)' }}>
                    目标项目：<strong>{activeTeam.pblSpec.projectName}</strong>
                  </p>
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {activeTeam.pblSpec.phases.map((phase: PblPhaseSpec) => (
                      <div
                        key={phase.phase}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '6px',
                          border: '1px solid var(--qitu-border)',
                          backgroundColor: 'var(--qitu-bg-subtle, #f9fafb)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                            {phase.title}
                          </span>
                          <span style={{ fontSize: '0.78rem', color: 'var(--qitu-primary)' }}>
                            责任导师: {phase.assignedRoleLabel}
                          </span>
                        </div>
                        <div style={{ marginTop: '6px', fontSize: '0.8rem', color: '#555' }}>
                          <strong>门禁条件：</strong>
                          <code>{phase.gateCondition}</code>
                        </div>
                        <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '0.78rem', color: '#666' }}>
                          {phase.learningObjectives.map((obj: string, oIdx: number) => (
                            <li key={oIdx}>{obj}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}
            </div>
          ) : (
            <EmptyState title="请选择团队" description="在左侧表格中点击任一团队查看配置详情。" />
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editing && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setEditing(null)}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: '8px',
              padding: '24px',
              width: '90%',
              maxWidth: '600px',
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 16px', fontSize: '1.2rem' }}>
              编辑团队：{editing.name}
            </h2>

            <div style={{ display: 'grid', gap: '14px' }}>
              <div className="admin-agent-field">
                <span>团队名称</span>
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>

              <div className="admin-agent-field">
                <span>团队描述</span>
                <textarea
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="admin-agent-field">
                <span>工作空间模式 (Workspace Mode)</span>
                <select
                  value={editing.workspaceMode}
                  onChange={(e) => setEditing({ ...editing, workspaceMode: e.target.value as AdminTeamConfig['workspaceMode'] })}
                >
                  <option value="shared">shared (所有成员共享同一项目工作区代码与资源)</option>
                  <option value="isolated">isolated (成员独立代码隔离区，由 Leader 合并推进)</option>
                </select>
              </div>

              <div className="admin-agent-field">
                <span>会话管控模式 (Session Mode)</span>
                <select
                  value={editing.sessionMode}
                  onChange={(e) => setEditing({ ...editing, sessionMode: e.target.value as AdminTeamConfig['sessionMode'] })}
                >
                  <option value="supervised">supervised (受控模式：门禁检查 + 防答案泄露)</option>
                  <option value="auto">auto (自动推进)</option>
                  <option value="plan">plan (计划先行)</option>
                </select>
              </div>

              <div className="admin-agent-field">
                <span>最大并行任务数 (Concurrency Limit)</span>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={editing.concurrencyLimit}
                  onChange={(e) => setEditing({ ...editing, concurrencyLimit: parseInt(e.target.value, 10) || 1 })}
                />
              </div>
            </div>

            {saveMessage && (
              <p style={{ marginTop: '12px', color: saveMessage.includes('失败') ? 'crimson' : 'green', fontSize: '0.88rem' }}>
                {saveMessage}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                取消
              </Button>
              <Button variant="primary" onClick={handleSave} loading={saving}>
                保存团队设定
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
