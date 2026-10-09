'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdminAssistantConfig,
  AdminTeamConfig,
  AdminTeamCreateInput,
  AdminTeamMember,
  AdminTeamMemberInput,
  AdminTeamUpdateInput,
  TeamSessionMode,
  TeammateRole,
  WorkspaceMode,
} from '@qitu/contracts';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { createIdempotentRetryKey, AdminApiError } from '../../../../lib/api/types';
import { createAdminTeam, fetchAdminTeams, updateAdminTeam } from '../../../../lib/api/teams';
import { fetchAdminAssistants } from '../../../../lib/api/assistants';
import { WriteErrorPanel } from '../../../../components/settings/WriteErrorPanel';
import { NetworkOfflineBanner, useBrowserOnline } from '../../../../components/settings/NetworkOffline';
import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';
import Link from 'next/link';

/**
 * 「团队」表（设置页左侧第二张表，位置/名称/层级为冻结信息架构，保持不变）。
 *
 * 数据来源只有真实接口 `GET /api/v1/admin/ai-runtime/teams`：旧版在请求失败时
 * 静默回退 `THUNDER_FIGHTER_TEAM_CONFIG` 的兜底已删除，失败一定渲染成
 * error / 断网 / 权限失败可见状态。五种状态：
 *  - loading / error / 断网 → AdminStateViews（骨架、ErrorState、OfflineBanner）
 *  - empty → EmptyTeamsPanel（接口成功、列表为空）
 *  - 权限失败(403) → AdminPermissionError → 「权限不足」渲染，前端不做最终判断
 * 写操作（POST/PATCH）携带 `Idempotency-Key`，未确认的重试复用同一键；
 * 服务端校验失败（空 PATCH、leaderAssistantId 不在成员里、theoryMasteredGate
 * 被写成 false 等）以 WriteErrorPanel 原样显示错误码与字段级提示。
 */

/** 客户端编辑草稿：只携带契约允许写入的字段 + 展示用的服务端派生值。 */
interface TeamDraft {
  /** 空串 = 新建；正式 id 只能由服务端生成。 */
  id: string;
  name: string;
  description: string;
  workspaceMode: WorkspaceMode;
  sessionMode: TeamSessionMode;
  leaderAssistantId: string;
  concurrencyLimit: number;
  enabled: boolean;
  members: AdminTeamMember[];
}

function toTeamDraft(team: AdminTeamConfig): TeamDraft {
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    workspaceMode: team.workspaceMode,
    sessionMode: team.sessionMode,
    leaderAssistantId: team.leaderAssistantId,
    concurrencyLimit: team.concurrencyLimit,
    enabled: team.enabled,
    members: team.members.map((m) => ({ ...m })),
  };
}

function emptyTeamDraft(): TeamDraft {
  return {
    id: '',
    name: '新创 PBL 协作小队',
    description: '针对特定项目式学习目标的多智能体协同研发小队。',
    workspaceMode: 'shared',
    sessionMode: 'supervised',
    leaderAssistantId: '',
    concurrencyLimit: 1,
    enabled: true,
    members: [],
  };
}

/** 持久化成员 → 写侧成员：只发送契约允许的字段（派生字段由服务端回填）。 */
function toMemberInput(member: AdminTeamMember): AdminTeamMemberInput {
  const input: AdminTeamMemberInput = {
    assistantId: member.assistantId,
    role: member.role,
    roleLabel: member.roleLabel,
  };
  // 尚未保存的新增成员不带 slotId，由服务端生成稳定 slotId（契约：省略时服务端生成）。
  if (!member.slotId.startsWith('slot-pending-')) input.slotId = member.slotId;
  if (member.model !== undefined) input.model = member.model;
  if (member.color !== undefined) input.color = member.color;
  if (member.pblPhase !== undefined) input.pblPhase = member.pblPhase;
  return input;
}

function memberInputsEqual(a: readonly AdminTeamMemberInput[], b: readonly AdminTeamMemberInput[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => JSON.stringify(item) === JSON.stringify(b[index]));
}

function buildTeamPatch(original: AdminTeamConfig, draft: TeamDraft): AdminTeamUpdateInput {
  const patch: AdminTeamUpdateInput = {};
  if (draft.name !== original.name) patch.name = draft.name;
  if (draft.description !== original.description) patch.description = draft.description;
  if (draft.workspaceMode !== original.workspaceMode) patch.workspaceMode = draft.workspaceMode;
  if (draft.sessionMode !== original.sessionMode) patch.sessionMode = draft.sessionMode;
  if (draft.leaderAssistantId !== original.leaderAssistantId) patch.leaderAssistantId = draft.leaderAssistantId;
  if (draft.concurrencyLimit !== original.concurrencyLimit) patch.concurrencyLimit = draft.concurrencyLimit;
  if (draft.enabled !== original.enabled) patch.enabled = draft.enabled;
  const nextMembers = draft.members.map(toMemberInput);
  if (!memberInputsEqual(nextMembers, original.members.map(toMemberInput))) {
    patch.members = nextMembers;
  }
  return patch;
}

function buildTeamCreateInput(draft: TeamDraft): AdminTeamCreateInput {
  return {
    name: draft.name,
    description: draft.description,
    leaderAssistantId: draft.leaderAssistantId,
    members: draft.members.map(toMemberInput),
    workspaceMode: draft.workspaceMode,
    sessionMode: draft.sessionMode,
    concurrencyLimit: draft.concurrencyLimit,
    enabled: draft.enabled,
  };
}

/** 从真实团队数据推导只读「指引」文本；契约中没有客户端可写的协议字段，因此不做假保存。 */
function teamProtocolMarkdown(team: AdminTeamConfig, assistantNames: Map<string, string>): string {
  const lines: string[] = [];
  lines.push(`# ${team.name}`);
  lines.push(team.description);
  lines.push('');
  lines.push('## 编排与运行边界');
  lines.push(`- 队长：${assistantNames.get(team.leaderAssistantId) ?? team.leaderAssistantId}`);
  lines.push(`- 工作区模式：${team.workspaceMode === 'shared' ? 'shared（共享工程目录）' : 'isolated（隔离沙箱）'}`);
  lines.push(`- 会话策略：${team.sessionMode}`);
  lines.push(`- 并发上限：${team.concurrencyLimit}`);
  lines.push('');
  lines.push('## 固定编制与成员职责');
  for (const member of team.members) {
    const star = member.assistantId === team.leaderAssistantId ? '⭐ ' : '';
    lines.push(
      `- ${star}${assistantNames.get(member.assistantId) ?? member.assistantName}（${member.roleLabel || member.role}）`,
    );
  }
  if (team.pblSpec !== undefined) {
    lines.push('');
    lines.push(`## PBL 阶段编排 · ${team.pblSpec.projectName}`);
    lines.push(`- 目标领域：${team.pblSpec.targetDomain}`);
    lines.push(
      `- 理论门禁：TheoryMastered 之前不得进入实践阶段（服务端强制，theoryMasteredGate=${String(
        team.pblSpec.theoryMasteredGate,
      )}，客户端不可关闭）`,
    );
    for (const phase of team.pblSpec.phases) {
      const objectives = phase.learningObjectives.length > 0 ? ` · 目标：${phase.learningObjectives.join('；')}` : '';
      lines.push(`- [${phase.phase}] ${phase.title} → 门禁 ${phase.gateCondition}${objectives}`);
    }
  }
  lines.push('');
  lines.push('## 执行原则（硬约束）');
  lines.push('- 项目状态流转、AI 决策、成长档案与审计日志一律由服务端写入，本页面只是显示层。');
  lines.push('- 学生未确认意图时不得创建正式项目；一个学生同一时间只能有一个当前班主任。');
  lines.push('- 一切写操作以 Idempotency-Key 头幂等，阶段切换必须支持幂等重放与审计追踪。');
  return lines.join('\n');
}

export default function AdminTeamsPage() {
  const [teams, setTeams] = useState<AdminTeamConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);
  const [assistantsError, setAssistantsError] = useState<unknown>(null);

  const [draft, setDraft] = useState<TeamDraft | null>(null);
  const [baseline, setBaseline] = useState<AdminTeamConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'members' | 'protocol'>('members');
  const [protocolExpanded, setProtocolExpanded] = useState(false);

  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [selectedAssistantToAdd, setSelectedAssistantToAdd] = useState('');
  const [newMemberRoleLabel, setNewMemberRoleLabel] = useState('协同助理');

  const online = useBrowserOnline();
  const retryKeys = useRef(createIdempotentRetryKey()).current;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchAdminTeams();
      setTeams(data);
    } catch (error) {
      // 已删除「失败 → 内置常量兜底」：失败必须抛出并渲染成可见错误态。
      setTeams([]);
      setLoadError(error instanceof Error ? error : new Error('团队列表加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAssistants = useCallback(async () => {
    try {
      const data = await fetchAdminAssistants();
      setAssistants(data.filter((a) => a.teamSelectable && a.enabled));
      setAssistantsError(null);
    } catch (error) {
      setAssistantsError(error);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadAssistants();
  }, [load, loadAssistants]);

  const wasOffline = useRef(!online);
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      void load();
      void loadAssistants();
    }
  }, [online, load, loadAssistants]);

  const assistantNames = useMemo(
    () => new Map(assistants.map((a) => [a.id, a.name] as const)),
    [assistants],
  );

  const readyCount = useMemo(
    () => teams.filter((t) => t.enabled && t.members.length > 0).length,
    [teams],
  );

  const tabs = useMemo(
    () => [
      { id: 'all', label: '全部小队', count: teams.length },
      { id: 'ready', label: '就绪可用', count: readyCount },
    ],
    [teams.length, readyCount],
  );

  const filtered = useMemo(() => {
    return teams.filter((team) => {
      if (activeTab === 'ready' && !(team.enabled && team.members.length > 0)) return false;
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
  }, [teams, search, activeTab]);

  const startCreateTeam = () => {
    setBaseline(null);
    setSaveError(null);
    setNotice(null);
    setDraft(emptyTeamDraft());
  };

  const startEditTeam = (team: AdminTeamConfig) => {
    setBaseline(team);
    setSaveError(null);
    setNotice(null);
    setDraft(toTeamDraft(team));
  };

  const handleSaveTeam = async () => {
    if (draft === null) return;
    if (!draft.name.trim()) {
      setNotice('请填写小队名称。');
      return;
    }
    if (draft.members.length === 0) {
      // 前端只负责显示这条预检；即便提交，服务端 members.length>=1 校验仍会兜底。
      setNotice('团队至少需要 1 名成员（最终校验以服务端为准）。');
      return;
    }
    if (!draft.leaderAssistantId) {
      setNotice('请从成员中指定队长（leaderAssistantId）。');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      if (draft.id === '') {
        const signature = `create:${JSON.stringify(draft)}`;
        await createAdminTeam(buildTeamCreateInput(draft), retryKeys.keyFor(signature));
      } else {
        if (baseline === null) throw new Error('编辑基线丢失，请返回列表重新进入。');
        const patch = buildTeamPatch(baseline, draft);
        if (Object.keys(patch).length === 0) {
          setNotice('没有任何改动可以保存（服务端也会拒绝空 PATCH）。');
          return;
        }
        const signature = `patch:${draft.id}:${JSON.stringify(patch)}`;
        await updateAdminTeam(draft.id, patch, retryKeys.keyFor(signature));
      }
      retryKeys.acknowledge();
      setDraft(null);
      setBaseline(null);
      await Promise.all([load(), loadAssistants()]);
    } catch (error) {
      setSaveError(error);
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setDraft(null);
    setBaseline(null);
    setSaveError(null);
    setNotice(null);
  };

  const handleSetLeader = (assistantId: string) => {
    if (draft === null) return;
    setDraft({
      ...draft,
      leaderAssistantId: assistantId,
      members: draft.members.map((m) => ({
        ...m,
        role: m.assistantId === assistantId ? 'leader' : m.role === 'leader' ? 'teammate' : m.role,
      })),
    });
  };

  const handleRemoveMember = (slotId: string) => {
    if (draft === null) return;
    if (draft.members.length <= 1) {
      setNotice('团队至少需保留 1 名成员（服务端同样会拒绝更少的成员数）。');
      return;
    }
    const members = draft.members.filter((m) => m.slotId !== slotId);
    const leaderStillThere = members.some((m) => m.assistantId === draft.leaderAssistantId);
    setDraft({
      ...draft,
      members,
      leaderAssistantId: leaderStillThere ? draft.leaderAssistantId : (members[0]?.assistantId ?? ''),
    });
  };

  const openAddMember = () => {
    const first = assistants[0];
    setSelectedAssistantToAdd((current) => current || first?.id || '');
    setNewMemberRoleLabel('协同助理');
    setShowAddMemberModal(true);
  };

  const handleAddMemberSubmit = () => {
    if (draft === null) return;
    if (draft.members.some((m) => m.assistantId === selectedAssistantToAdd)) {
      setNotice('该助手已在小队成员中。');
      setShowAddMemberModal(false);
      return;
    }
    const candidate = assistants.find((a) => a.id === selectedAssistantToAdd);
    if (candidate === undefined) return;
    const newMember: AdminTeamMember = {
      slotId: `slot-pending-${Date.now()}`,
      assistantId: candidate.id,
      assistantName: candidate.name,
      role: draft.members.length === 0 ? 'leader' : 'teammate',
      roleLabel: newMemberRoleLabel.trim() || candidate.role,
      status: 'pending',
      color: '#165dff',
    };
    setDraft({
      ...draft,
      leaderAssistantId: draft.leaderAssistantId === '' ? candidate.id : draft.leaderAssistantId,
      members: [...draft.members, newMember],
    });
    setShowAddMemberModal(false);
  };

  // -------------------------------------------------------------
  // 视图 1：团队详情 / 工作台
  // -------------------------------------------------------------
  if (draft !== null) {
    const leaderMember =
      draft.members.find((m) => m.assistantId === draft.leaderAssistantId) ?? draft.members[0];
    const protocolSource: AdminTeamConfig = {
      id: draft.id || '(未保存)',
      name: draft.name,
      description: draft.description,
      workspaceMode: draft.workspaceMode,
      sessionMode: draft.sessionMode,
      leaderAssistantId: draft.leaderAssistantId,
      members: draft.members,
      concurrencyLimit: draft.concurrencyLimit,
      enabled: draft.enabled,
      createdAt: baseline?.createdAt ?? '',
      updatedAt: baseline?.updatedAt ?? '',
      ...(baseline?.pblSpec !== undefined ? { pblSpec: baseline.pblSpec } : {}),
    };

    return (
      <div style={{ maxWidth: '1020px', margin: '0 auto' }}>
        <div className="multica-breadcrumb-bar">
          <div className="multica-crumb-path">
            <span className="multica-crumb-link" onClick={cancelEdit}>
              小队
            </span>
            <span>&gt;</span>
            <span style={{ color: '#1d2129', fontWeight: 600 }}>
              {draft.id === '' ? '🆕 新建小队' : `${draft.name}`}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button type="button" className="settings-action-btn" onClick={cancelEdit}>
              ← 返回小队列表
            </button>
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={() => void handleSaveTeam()}
              disabled={saving}
            >
              {saving ? '保存中...' : draft.id === '' ? '创建小队' : '保存修改'}
            </button>
          </div>
        </div>

        <NetworkOfflineBanner online={online} />
        {saveError !== null && <WriteErrorPanel error={saveError} />}
        {notice !== null && (
          <div
            role="status"
            style={{
              border: '1px solid #bfd4ff',
              background: '#f0f6ff',
              borderRadius: 10,
              padding: '8px 14px',
              margin: '10px 0',
              fontSize: 13,
              color: '#165dff',
            }}
          >
            {notice}
          </div>
        )}

        <div className="multica-team-grid">
          <aside className="multica-profile-card">
            <div className="multica-profile-header">
              <div className="multica-profile-avatar">
                {draft.id.includes('thunder') ? '🚀' : draft.id === '' ? '🆕' : '👥'}
              </div>
              <div>
                <input
                  type="text"
                  className="settings-input"
                  style={{ fontWeight: 700, fontSize: '15px' }}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div>
                <textarea
                  className="settings-textarea"
                  style={{ fontSize: '12px', minHeight: '64px' }}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
            </div>

            <div className="multica-meta-list">
              <div className="multica-meta-item">
                <span className="multica-meta-k">队长</span>
                <span className="multica-meta-v">
                  <span style={{ fontSize: '14px' }}>⭐</span>
                  {leaderMember?.assistantName || '未指定'}
                </span>
              </div>
              <div className="multica-meta-item">
                <span className="multica-meta-k">成员数</span>
                <span className="multica-meta-v">{draft.members.length}</span>
              </div>
              <div className="multica-meta-item">
                <span className="multica-meta-k">并发上限</span>
                <span className="multica-meta-v">
                  <input
                    type="number"
                    className="settings-input"
                    min={1}
                    max={8}
                    style={{ width: '72px', height: '28px', fontSize: '12px' }}
                    value={draft.concurrencyLimit}
                    onChange={(e) => {
                      const raw = Number.parseInt(e.target.value, 10);
                      const next = Number.isFinite(raw) ? Math.min(8, Math.max(1, raw)) : 1;
                      setDraft({ ...draft, concurrencyLimit: next });
                    }}
                  />
                  <span style={{ fontSize: '11px', color: '#86909c' }}> 1–8（服务端强校验）</span>
                </span>
              </div>
              <div className="multica-meta-item">
                <span className="multica-meta-k">启用</span>
                <span className="multica-meta-v">
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}>
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                    />
                    {draft.enabled ? '已启用' : '已停用'}
                  </label>
                </span>
              </div>
              <div className="multica-meta-item">
                <span className="multica-meta-k">工作区模式</span>
                <span className="multica-meta-v">
                  <select
                    className="settings-select"
                    style={{ height: '28px', fontSize: '11.5px', padding: '0 4px', width: 'auto' }}
                    value={draft.workspaceMode}
                    onChange={(e) => setDraft({ ...draft, workspaceMode: e.target.value as WorkspaceMode })}
                  >
                    <option value="shared">shared (共享工作区)</option>
                    <option value="isolated">isolated (隔离沙箱)</option>
                  </select>
                </span>
              </div>
              <div className="multica-meta-item">
                <span className="multica-meta-k">会话策略</span>
                <span className="multica-meta-v">
                  <select
                    className="settings-select"
                    style={{ height: '28px', fontSize: '11.5px', padding: '0 4px', width: 'auto' }}
                    value={draft.sessionMode}
                    onChange={(e) => setDraft({ ...draft, sessionMode: e.target.value as TeamSessionMode })}
                  >
                    <option value="plan">plan (规划驱动)</option>
                    <option value="auto">auto (全自动)</option>
                    <option value="supervised">supervised (监督)</option>
                  </select>
                </span>
              </div>
              <div className="multica-meta-item">
                <span className="multica-meta-k">更新时间</span>
                <span className="multica-meta-v">
                  {baseline?.updatedAt ? new Date(baseline.updatedAt).toLocaleString() : '未保存'}
                </span>
              </div>
            </div>
          </aside>

          <main style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '20px', borderBottom: '1px solid #e5e6eb', marginBottom: '14px' }}>
              <button
                type="button"
                className={`settings-tab-btn ${activeSubTab === 'members' ? 'is-active' : ''}`}
                onClick={() => setActiveSubTab('members')}
              >
                👥 成员 <span className="settings-tab-cnt">{draft.members.length}</span>
              </button>
              <button
                type="button"
                className={`settings-tab-btn ${activeSubTab === 'protocol' ? 'is-active' : ''}`}
                onClick={() => setActiveSubTab('protocol')}
              >
                📜 指引与协作协议
              </button>
            </div>

            {activeSubTab === 'members' && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '12px',
                  }}
                >
                  <span style={{ fontSize: '13px', color: '#4e5969' }}>
                    该小队共有 <strong>{draft.members.length}</strong> 名智能体成员
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Link href="/settings/assistants" className="settings-pill-btn" style={{ textDecoration: 'none' }}>
                      + 创建智能体
                    </Link>
                    <button
                      type="button"
                      className="settings-action-btn is-primary"
                      style={{ height: '30px', fontSize: '12px', padding: '0 12px' }}
                      onClick={openAddMember}
                      disabled={assistants.length === 0}
                    >
                      + 添加成员
                    </button>
                  </div>
                </div>

                {draft.members.length === 0 ? (
                  <div className="settings-empty">暂无成员：请从「可编排助手」目录中添加（目录来自真实 API）。</div>
                ) : (
                  draft.members.map((member) => {
                    const isLeader =
                      member.assistantId === draft.leaderAssistantId || member.role === 'leader';
                    return (
                      <div key={member.slotId} className="multica-member-row">
                        <div className="multica-member-avatar" style={{ background: member.color || '#165dff' }}>
                          {member.assistantName.slice(0, 1)}
                        </div>
                        <div className="multica-member-info">
                          <div className="multica-member-top">
                            <span className="multica-member-name">{member.assistantName}</span>
                            <span className="multica-member-tag">智能体</span>
                            {member.slotId.startsWith('slot-pending-') ? (
                              <span className="multica-member-tag" title="尚未保存">待保存</span>
                            ) : (
                              <span className={`multica-member-tag ${member.status === 'active' ? 'is-online' : ''}`}>
                                {member.status === 'active' ? '运行中' : member.status === 'failed' ? '失败' : '就绪'}
                              </span>
                            )}
                            {isLeader && <span className="multica-member-tag is-leader">⭐ 队长</span>}
                          </div>
                          <div className="multica-member-role">{member.roleLabel || `${member.role} 角色`}</div>
                        </div>
                        <div className="multica-member-actions">
                          {!isLeader && (
                            <button
                              type="button"
                              className="multica-icon-btn"
                              title="设为队长"
                              onClick={() => handleSetLeader(member.assistantId)}
                            >
                              ⭐
                            </button>
                          )}
                          <Link
                            href="/settings/assistants"
                            className="multica-icon-btn"
                            title="查看并配置助手"
                            style={{ textDecoration: 'none' }}
                          >
                            ↗
                          </Link>
                          <button
                            type="button"
                            className="multica-icon-btn is-danger"
                            title="从团队移除"
                            onClick={() => handleRemoveMember(member.slotId)}
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {activeSubTab === 'protocol' && (
              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #e5e6eb',
                  borderRadius: '12px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 18px',
                    borderBottom: '1px solid #f2f3f5',
                    background: '#ffffff',
                  }}
                >
                  <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1d2129' }}>
                    小队协议与协作规范（按服务端配置生成，只读）
                  </span>
                  <button
                    type="button"
                    className="settings-pill-btn"
                    style={{ fontSize: '11px', height: '24px' }}
                    onClick={() => setProtocolExpanded((p) => !p)}
                  >
                    {protocolExpanded ? '收起' : '展开'}
                  </button>
                </div>
                <div
                  style={{
                    height: protocolExpanded ? '520px' : '340px',
                    overflowY: 'auto',
                    padding: '20px 24px',
                    background: '#fafafa',
                    fontSize: '13px',
                    lineHeight: '1.75',
                    color: '#272e3b',
                  }}
                >
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'inherit' }}>
                    {teamProtocolMarkdown(protocolSource, assistantNames)}
                  </pre>
                </div>
              </div>
            )}
          </main>
        </div>

        {showAddMemberModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
          >
            <div
              style={{
                width: '420px',
                background: '#ffffff',
                borderRadius: '12px',
                padding: '20px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
              }}
            >
              <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 600 }}>添加团队成员</h3>

              {assistantsError !== null ? (
                <AdminStateViews
                  loading={false}
                  error={
                    assistantsError instanceof Error ? assistantsError : new Error('助手目录加载失败')
                  }
                  onRetry={() => void loadAssistants()}
                />
              ) : assistants.length === 0 ? (
                <div className="settings-empty" style={{ margin: '8px 0' }}>
                  暂无可编排的助手（需 `teamSelectable` 且已启用）。请先到「助手」表创建。
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: '#4e5969', display: 'block', marginBottom: '4px' }}>
                      选择智能体 / 导师（来自真实助手目录）
                    </label>
                    <select
                      className="settings-select"
                      value={selectedAssistantToAdd}
                      onChange={(e) => setSelectedAssistantToAdd(e.target.value)}
                    >
                      {assistants.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}（{a.role}）
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#4e5969', display: 'block', marginBottom: '4px' }}>
                      在小队中的职责描述
                    </label>
                    <input
                      type="text"
                      className="settings-input"
                      value={newMemberRoleLabel}
                      onChange={(e) => setNewMemberRoleLabel(e.target.value)}
                      placeholder="例如：物理规律与碰撞理论教学"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#4e5969', display: 'block', marginBottom: '4px' }}>
                      角色
                    </label>
                    <span style={{ fontSize: '12px', color: '#86909c' }}>
                      新成员默认以 teammate 加入；点「⭐ 设为队长」调整 leaderAssistantId，保存时由服务端最终校验。
                    </span>
                  </div>
                </div>
              )}

              <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" className="settings-action-btn" onClick={() => setShowAddMemberModal(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="settings-action-btn is-primary"
                  onClick={handleAddMemberSubmit}
                  disabled={assistants.length === 0 || selectedAssistantToAdd === ''}
                >
                  确认添加
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------
  // 视图 2：小队列表概览（真实 API + 五态）
  // -------------------------------------------------------------
  const listBody = (() => {
    if (loading) {
      return <AdminStateViews loading={true} error={null} onRetry={() => void load()} />;
    }
    if (loadError !== null) {
      // 服务端业务失败：带错误码的可见面板；断网/权限：AdminStateViews。
      if (loadError instanceof AdminApiError) {
        return <WriteErrorPanel error={loadError} onRetry={() => void load()} />;
      }
      return <AdminStateViews loading={false} error={loadError} onRetry={() => void load()} />;
    }
    if (teams.length === 0) {
      return (
        <div className="settings-empty" style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: '34px', marginBottom: '10px' }}>👥</div>
          <strong style={{ fontSize: '14px', color: '#1d2129' }}>暂无协作团队</strong>
          <p style={{ color: '#4e5969', fontSize: '12.5px', margin: '6px 0 14px' }}>
            服务端团队目录为空。创建第一支小队后即可编排多 Agent 协作。
          </p>
          <button type="button" className="settings-action-btn is-primary" onClick={startCreateTeam}>
            新建团队
          </button>
        </div>
      );
    }
    if (filtered.length === 0) {
      return <div className="settings-empty">暂无匹配的团队</div>;
    }
    return filtered.map((team) => {
      const ready = team.enabled && team.members.length > 0;
      return (
        <RowCard
          key={team.id}
          avatarText={team.id.includes('thunder') ? '🚀' : '👥'}
          avatarBg="#eff6ff"
          name={team.name}
          statusText={team.enabled ? (ready ? '就绪' : '无成员') : '已停用'}
          statusType={ready ? 'ok' : 'off'}
          description={`${team.workspaceMode === 'shared' ? '共享工作区 (shared)' : '独立沙箱 (isolated)'} · ${team.members.length} 名成员 · ${team.description}`}
          avatarStack={team.members.map((m) => m.assistantName.slice(0, 1))}
          editLabel="查看小队"
          onEdit={() => startEditTeam(team)}
        />
      );
    });
  })();

  return (
    <>
      <NetworkOfflineBanner online={online} onRetry={() => void load()} />
      <AionSettingsParadigm
        title="团队"
        description={
          <span>
            配置多 Agent 协作研发团队，支持 Multica 风格工作区共享与监督会话模式。可自定义成员分工、指定队长，并维护小队研发与 PBL 交付协议。
          </span>
        }
        searchPlaceholder="搜索团队名称、职责..."
        searchQuery={search}
        onSearchChange={setSearch}
        primaryActionLabel="新建团队"
        onPrimaryAction={startCreateTeam}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {listBody}
      </AionSettingsParadigm>
    </>
  );
}
