'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminTeamConfig, AdminTeamMember, WorkspaceMode, TeamSessionMode } from '@qitu/contracts';
import { fetchAdminTeams, updateAdminTeam } from '../../../../lib/api/teams';
import { AionSettingsParadigm, RowCard } from '../AionSettingsParadigm';
import Link from 'next/link';

interface ExtendedTeamItem extends AdminTeamConfig {
  isAvailable: boolean;
  avatarIcon?: string;
  creatorName?: string;
  protocolMarkdown?: string;
}

const DEFAULT_THUNDER_PROTOCOL = `# 雷霆战机 PBL 研发小队协议
本小队负责引导学生通过 PBL（项目式学习）完成雷霆战机小游戏全流程研发：
从物理概念理解、碰撞检测数学推导，到代码实战与成果提交答辩。

## 触发与常驻授权
学生在灵感空间完成意图确认后，自动立项独立工程工作目录，无需反复确认，直接开工。

## 固定编制与成员职责
- Leader: 启途总导师 (调度总控，把控整体进度与目标达成)
- 原理教练: 战机原理教练 (飞行力学、矢量位移、AABB碰撞；TheoryMastered 责任人)
- 代码向导: 战机代码向导 (Canvas 渲染循环、按键事件绑定、敌人波次生成)
- 答辩导师: 答辩导师 (代码规范审查、成果答辩、成长档案归档)

## 工作目录规范
WORK_ROOT 为学生专属工程目录: \`student-projects/thunder-fighter/\`

## 执行原则与状态门禁 (硬约束)
- 理论门禁: \`TheoryMastered\` 判定通过前，严禁越级进入实践代码编写阶段！
- 循序渐进: 每次仅给出一小步引导与关键思考题，绝不替学生直接代写全部代码。
- 幂等性: 任何阶段切换与成果生成必须支持幂等重放与审计追踪。`;

const STATIC_TEAMS: ExtendedTeamItem[] = [
  {
    id: 'thunder-fighter-game-pbl',
    name: '雷霆战机 PBL 研发小队',
    description: '指导学生以 PBL 项目式学习方式，从游戏概念、碰撞检测数学推导、核心循环到成果提交全流程研发雷霆战机小游戏。',
    leaderAssistantId: 'tutor-general-leader',
    workspaceMode: 'shared',
    sessionMode: 'plan',
    concurrencyLimit: 4,
    enabled: true,
    avatarIcon: '🚀',
    creatorName: 'Qitu Admin',
    createdAt: '2026-09-01T08:00:00Z',
    updatedAt: new Date().toISOString(),
    protocolMarkdown: DEFAULT_THUNDER_PROTOCOL,
    members: [
      { slotId: 'slot-1', assistantId: 'tutor-general-leader', assistantName: '启途总导师', role: 'leader', roleLabel: '启途总导师 · 调度总控', status: 'active', color: '#165dff' },
      { slotId: 'slot-2', assistantId: 'tutor-concept-coach', assistantName: '战机原理与概念教练', role: 'coach', roleLabel: '物理规律与碰撞理论教学 (TheoryMastered 责任人)', status: 'active', color: '#059669' },
      { slotId: 'slot-3', assistantId: 'tutor-code-guide', assistantName: '战机架构与代码向导', role: 'teammate', roleLabel: 'Canvas 渲染循环与按键交互向导', status: 'active', color: '#f77234' },
      { slotId: 'slot-4', assistantId: 'tutor-deliverable-reviewer', assistantName: '成果评审与答辩导师', role: 'reviewer', roleLabel: '成果评审、反思答辩与档案归档', status: 'idle', color: '#722ed1' },
    ],
    isAvailable: true,
  },
  {
    id: 'general-problem-solving-team',
    name: '通用解题小队',
    description: '拿到前端给的任务后立项独立工作目录，拆解重跑实验任务，并在通过引言门槛后自动提交挑战。',
    leaderAssistantId: 'result-review-lead',
    workspaceMode: 'isolated',
    sessionMode: 'auto',
    concurrencyLimit: 5,
    enabled: true,
    avatarIcon: '🦊',
    creatorName: 'Yujie Liu',
    createdAt: '2026-08-05T10:00:00Z',
    updatedAt: new Date().toISOString(),
    protocolMarkdown: `# 通用解题小队协议
本小队是通用解题执行体：收到一个任务后就自己开工，建目录、查资料、写代码、出结果，能提交的就是提交，不限于论文复现。

## 触发与常驻授权
任何满足派单形状的留言视为有效派单，无需再向用户确认，直接开工。

## 固定编制
- Leader: 论文复现方案架构师 (生产流程 Leader)
- 验收师: 结果复现与量化验收师 (RESULT_REVIEW 结果与量化验收)
- 检验师: 方法与实验策略检验师 (METHOD_REVIEW 方法与实验检验)
- 交付师: 提交准备与平台交付师 (AUDIT/SUBMIT 独立审计与唯一提交)
- 教练: 复现实验执行教练 (EXECUTE 实验复现与调优)`,
    members: [
      { slotId: 's-1', assistantId: 'paper-arch-lead', assistantName: '论文复现方案架构师', role: 'leader', roleLabel: '生产流程 Leader', status: 'active', color: '#d97706' },
      { slotId: 's-2', assistantId: 'result-review-lead', assistantName: '结果复现与量化验收师', role: 'leader', roleLabel: 'RESULT_REVIEW 结果与量化验收', status: 'active', color: '#ea580c' },
      { slotId: 's-3', assistantId: 'method-review-agent', assistantName: '方法与实验策略检验师', role: 'reviewer', roleLabel: 'METHOD_REVIEW 方法与实验检验', status: 'idle', color: '#0284c7' },
      { slotId: 's-4', assistantId: 'audit-submit-agent', assistantName: '提交准备与平台交付师', role: 'teammate', roleLabel: 'AUDIT/SUBMIT 独立审计与唯一提交', status: 'idle', color: '#8b5cf6' },
      { slotId: 's-5', assistantId: 'execution-coach-agent', assistantName: '复现实验执行教练', role: 'coach', roleLabel: 'EXECUTE 实验复现与调优', status: 'idle', color: '#10b981' },
    ],
    isAvailable: true,
  },
];

const CANDIDATE_ASSISTANTS = [
  { id: 'tutor-general-leader', name: '启途总导师', role: '调度总控' },
  { id: 'tutor-concept-coach', name: '战机原理与概念教练', role: '概念教学与理论门禁' },
  { id: 'tutor-code-guide', name: '战机架构与代码向导', role: '代码实践向导' },
  { id: 'tutor-deliverable-reviewer', name: '成果评审与答辩导师', role: '成果答辩与评审' },
  { id: 'literature-knowledge-map', name: '文献与知识地图助手', role: '跨学科证据综合师' },
  { id: 'claude-code', name: 'Claude Code', role: '高级代码重构向导' },
  { id: 'codex-cli', name: 'Codex CLI', role: '精准代码补全代理' },
];

export default function AdminTeamsPage() {
  const [teams, setTeams] = useState<AdminTeamConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [testingId, setTestingId] = useState<string | null>(null);

  // Multica 团队工作台当前选中团队
  const [activeTeam, setActiveTeam] = useState<ExtendedTeamItem | null>(null);
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'members' | 'protocol'>('members');
  const [protocolViewMode, setProtocolViewMode] = useState<'edit' | 'preview'>('preview');
  const [protocolExpanded, setProtocolExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  // 添加成员弹窗状态
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [selectedAssistantToAdd, setSelectedAssistantToAdd] = useState(
    CANDIDATE_ASSISTANTS[0]?.id ?? 'tutor-general-leader'
  );
  const [newMemberRoleLabel, setNewMemberRoleLabel] = useState('协同助理');

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
      avatarIcon: t.id.includes('thunder') ? '🚀' : '👥',
      creatorName: 'Qitu Admin',
      protocolMarkdown: DEFAULT_THUNDER_PROTOCOL,
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
    return [
      { id: 'all', label: '全部小队', count: allTeams.length },
      { id: 'ready', label: '就绪可用', count: readyCount },
    ];
  }, [allTeams]);

  const filtered = useMemo(() => {
    return allTeams.filter((team) => {
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
  }, [allTeams, search]);

  const handleTest = (id: string) => {
    setTestingId(id);
    setTimeout(() => {
      setTestingId(null);
      alert(`团队 [${id}] 多 Agent 协同握手测试通过，状态正常！`);
    }, 500);
  };

  const startCreateTeam = () => {
    setIsCreatingTeam(true);
    const newTeam: ExtendedTeamItem = {
      id: `custom-team-${Date.now()}`,
      name: '新创 PBL 协作小队',
      description: '针对特定项目式学习目标的多智能体协同研发小队。',
      leaderAssistantId: 'tutor-general-leader',
      workspaceMode: 'shared',
      sessionMode: 'plan',
      concurrencyLimit: 4,
      enabled: true,
      avatarIcon: '💡',
      creatorName: 'Qitu Admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      protocolMarkdown: `# 新创小队协议\n## 目标\n...\n\n## 规则\n- 理论先导...`,
      members: [
        { slotId: 'slot-1', assistantId: 'tutor-general-leader', assistantName: '启途总导师', role: 'leader', roleLabel: '启途总导师 · 调度总控', status: 'active', color: '#165dff' },
      ],
      isAvailable: true,
    };
    setActiveTeam(newTeam);
  };

  const handleSaveTeam = async () => {
    if (!activeTeam) return;
    setSaving(true);
    try {
      if (activeTeam.id === 'thunder-fighter-game-pbl') {
        await updateAdminTeam(
          activeTeam.id,
          {
            name: activeTeam.name,
            description: activeTeam.description,
            workspaceMode: activeTeam.workspaceMode,
            sessionMode: activeTeam.sessionMode,
            members: activeTeam.members,
          },
          `team-save-${Date.now()}`,
        );
      }
      const existingIdx = STATIC_TEAMS.findIndex((t) => t.id === activeTeam.id);
      if (existingIdx >= 0) {
        STATIC_TEAMS[existingIdx] = { ...activeTeam };
      } else {
        STATIC_TEAMS.unshift({ ...activeTeam });
      }
      await load();
      alert('小队配置已成功保存！');
    } catch (err) {
      alert(`保存失败: ${err instanceof Error ? err.message : '网络或服务异常'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSetLeader = (assistantId: string) => {
    if (!activeTeam) return;
    const updatedMembers = activeTeam.members.map((m) => ({
      ...m,
      role: (m.assistantId === assistantId ? 'leader' : (m.role === 'leader' ? 'teammate' : m.role)) as AdminTeamMember['role'],
    }));
    setActiveTeam({
      ...activeTeam,
      leaderAssistantId: assistantId,
      members: updatedMembers,
    });
  };

  const handleRemoveMember = (slotId: string) => {
    if (!activeTeam) return;
    if (activeTeam.members.length <= 1) {
      alert('团队至少需保留 1 名成员！');
      return;
    }
    const updatedMembers = activeTeam.members.filter((m) => m.slotId !== slotId);
    setActiveTeam({
      ...activeTeam,
      members: updatedMembers,
    });
  };

  const handleAddMemberSubmit = () => {
    if (!activeTeam) return;
    const candidate = CANDIDATE_ASSISTANTS.find((c) => c.id === selectedAssistantToAdd);
    if (!candidate) return;
    const newMember: AdminTeamMember = {
      slotId: `slot-${Date.now()}`,
      assistantId: candidate.id,
      assistantName: candidate.name,
      role: 'teammate',
      roleLabel: newMemberRoleLabel.trim() || candidate.role,
      status: 'idle',
      color: '#165dff',
    };
    setActiveTeam({
      ...activeTeam,
      members: [...activeTeam.members, newMember],
    });
    setShowAddMemberModal(false);
  };

  // -------------------------------------------------------------
  // 视图 1：Multica 风格团队详情 / 工作台 (参考上传截图 media_1791562203977 / media_1791562217713)
  // -------------------------------------------------------------
  if (activeTeam) {
    const leaderMember = activeTeam.members.find((m) => m.assistantId === activeTeam.leaderAssistantId) || activeTeam.members[0];

    return (
      <div style={{ maxWidth: '1020px', margin: '0 auto' }}>
        {/* 顶部面包屑与操作条 */}
        <div className="multica-breadcrumb-bar">
          <div className="multica-crumb-path">
            <span
              className="multica-crumb-link"
              onClick={() => {
                setActiveTeam(null);
                setIsCreatingTeam(false);
              }}
            >
              小队
            </span>
            <span>&gt;</span>
            <span style={{ color: '#1d2129', fontWeight: 600 }}>
              {activeTeam.avatarIcon || '👥'} {activeTeam.name}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => {
                setActiveTeam(null);
                setIsCreatingTeam(false);
              }}
            >
              ← 返回小队列表
            </button>
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={handleSaveTeam}
              disabled={saving}
            >
              {saving ? '保存中...' : '保存修改'}
            </button>
          </div>
        </div>

        {/* 双栏布局：左侧团队资料卡 + 右侧 Tabs (成员 | 指引) */}
        <div className="multica-team-grid">
          {/* 左栏：团队资料卡 */}
          <aside className="multica-profile-card">
            <div className="multica-profile-header">
              <div className="multica-profile-avatar">
                {activeTeam.avatarIcon || '👥'}
              </div>
              <div>
                <input
                  type="text"
                  className="settings-input"
                  style={{ fontWeight: 700, fontSize: '15px' }}
                  value={activeTeam.name}
                  onChange={(e) => setActiveTeam({ ...activeTeam, name: e.target.value })}
                />
              </div>
              <div>
                <textarea
                  className="settings-textarea"
                  style={{ fontSize: '12px', minHeight: '64px' }}
                  value={activeTeam.description}
                  onChange={(e) => setActiveTeam({ ...activeTeam, description: e.target.value })}
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
                <span className="multica-meta-v">{activeTeam.members.length}</span>
              </div>
              <div className="multica-meta-item">
                <span className="multica-meta-k">创建者</span>
                <span className="multica-meta-v">👤 {activeTeam.creatorName || 'Qitu Admin'}</span>
              </div>
              <div className="multica-meta-item">
                <span className="multica-meta-k">工作区模式</span>
                <span className="multica-meta-v">
                  <select
                    className="settings-select"
                    style={{ height: '28px', fontSize: '11.5px', padding: '0 4px', width: 'auto' }}
                    value={activeTeam.workspaceMode}
                    onChange={(e) =>
                      setActiveTeam({ ...activeTeam, workspaceMode: e.target.value as WorkspaceMode })
                    }
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
                    value={activeTeam.sessionMode}
                    onChange={(e) =>
                      setActiveTeam({ ...activeTeam, sessionMode: e.target.value as TeamSessionMode })
                    }
                  >
                    <option value="plan">plan (规划驱动)</option>
                    <option value="auto">auto (全自动)</option>
                    <option value="supervised">supervised (监督)</option>
                  </select>
                </span>
              </div>
              <div className="multica-meta-item">
                <span className="multica-meta-k">更新时间</span>
                <span className="multica-meta-v">刚刚</span>
              </div>
            </div>
          </aside>

          {/* 右栏：选项卡与工作台 */}
          <main style={{ minWidth: 0 }}>
            {/* Tab 导航 */}
            <div style={{ display: 'flex', gap: '20px', borderBottom: '1px solid #e5e6eb', marginBottom: '14px' }}>
              <button
                type="button"
                className={`settings-tab-btn ${activeSubTab === 'members' ? 'is-active' : ''}`}
                onClick={() => setActiveSubTab('members')}
              >
                👥 成员 <span className="settings-tab-cnt">{activeTeam.members.length}</span>
              </button>
              <button
                type="button"
                className={`settings-tab-btn ${activeSubTab === 'protocol' ? 'is-active' : ''}`}
                onClick={() => setActiveSubTab('protocol')}
              >
                📜 指引与协作协议
              </button>
            </div>

            {/* Tab 1: 成员列表 (参考截图 media_1791562203977_3edc6520.png) */}
            {activeSubTab === 'members' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ fontSize: '13px', color: '#4e5969' }}>
                    该小队共有 <strong>{activeTeam.members.length}</strong> 名智能体成员
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Link
                      href="/settings/assistants"
                      className="settings-pill-btn"
                      style={{ textDecoration: 'none' }}
                    >
                      + 创建智能体
                    </Link>
                    <button
                      type="button"
                      className="settings-action-btn is-primary"
                      style={{ height: '30px', fontSize: '12px', padding: '0 12px' }}
                      onClick={() => setShowAddMemberModal(true)}
                    >
                      + 添加成员
                    </button>
                  </div>
                </div>

                {/* 成员卡片行 */}
                {activeTeam.members.map((member) => {
                  const isLeader = member.assistantId === activeTeam.leaderAssistantId || member.role === 'leader';
                  return (
                    <div key={member.slotId} className="multica-member-row">
                      {/* 头像 */}
                      <div
                        className="multica-member-avatar"
                        style={{ background: member.color || '#165dff' }}
                      >
                        {member.assistantName.slice(0, 1)}
                      </div>

                      {/* 身份与职责 */}
                      <div className="multica-member-info">
                        <div className="multica-member-top">
                          <span className="multica-member-name">{member.assistantName}</span>
                          <span className="multica-member-tag">智能体</span>
                          <span className="multica-member-tag is-online">就绪</span>
                          {isLeader && <span className="multica-member-tag is-leader">⭐ 队长</span>}
                        </div>
                        <div className="multica-member-role">
                          {member.roleLabel || `${member.role} 角色`}
                        </div>
                        <div className="multica-member-activity">
                          最近活动 刚刚
                        </div>
                      </div>

                      {/* 操作按钮 */}
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
                })}
              </div>
            )}

            {/* Tab 2: 指引与小队协议 (参考截图 media_1791562217713_ddc70530.png) */}
            {activeSubTab === 'protocol' && (
              <div style={{ background: '#ffffff', border: '1px solid #e5e6eb', borderRadius: '12px', overflow: 'hidden' }}>
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
                    小队协议与协作规范
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ display: 'inline-flex', background: '#f2f3f5', borderRadius: '6px', padding: '2px' }}>
                      <button
                        type="button"
                        style={{
                          border: 'none',
                          background: protocolViewMode === 'edit' ? '#ffffff' : 'transparent',
                          color: protocolViewMode === 'edit' ? '#165dff' : '#4e5969',
                          fontSize: '11.5px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                        onClick={() => setProtocolViewMode('edit')}
                      >
                        编辑协议
                      </button>
                      <button
                        type="button"
                        style={{
                          border: 'none',
                          background: protocolViewMode === 'preview' ? '#ffffff' : 'transparent',
                          color: protocolViewMode === 'preview' ? '#165dff' : '#4e5969',
                          fontSize: '11.5px',
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                        onClick={() => setProtocolViewMode('preview')}
                      >
                        预览
                      </button>
                    </div>
                    <button
                      type="button"
                      className="settings-pill-btn"
                      style={{ fontSize: '11px', height: '24px' }}
                      onClick={() => setProtocolExpanded((p) => !p)}
                    >
                      {protocolExpanded ? '收起' : '展开'}
                    </button>
                  </div>
                </div>

                {protocolViewMode === 'edit' ? (
                  <textarea
                    className="settings-textarea"
                    style={{
                      height: protocolExpanded ? '520px' : '340px',
                      border: 'none',
                      borderRadius: '0',
                      fontFamily: 'monospace',
                      fontSize: '12.5px',
                      lineHeight: '1.6',
                      padding: '16px 20px',
                    }}
                    value={activeTeam.protocolMarkdown || ''}
                    onChange={(e) =>
                      setActiveTeam({ ...activeTeam, protocolMarkdown: e.target.value })
                    }
                  />
                ) : (
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
                    <pre
                      style={{
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        margin: 0,
                        fontFamily: 'inherit',
                      }}
                    >
                      {activeTeam.protocolMarkdown || '（暂无协议内容）'}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>

        {/* 添加成员 Modal 弹窗 */}
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', color: '#4e5969', display: 'block', marginBottom: '4px' }}>
                    选择智能体 / 导师
                  </label>
                  <select
                    className="settings-select"
                    value={selectedAssistantToAdd}
                    onChange={(e) => setSelectedAssistantToAdd(e.target.value)}
                  >
                    {CANDIDATE_ASSISTANTS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.role})
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
              </div>
              <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
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
                  onClick={handleAddMemberSubmit}
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
  // 视图 2：小队列表概览
  // -------------------------------------------------------------
  return (
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
      {filtered.length === 0 ? (
        <div className="settings-empty">暂无匹配的团队</div>
      ) : (
        filtered.map((team) => (
          <RowCard
            key={team.id}
            avatarText={team.avatarIcon || '👥'}
            avatarBg="#eff6ff"
            name={team.name}
            statusText={team.isAvailable ? '就绪' : '待配置'}
            statusType={team.isAvailable ? 'ok' : 'off'}
            description={`${team.workspaceMode === 'shared' ? '共享工作区 (shared)' : '独立沙箱 (isolated)'} · ${team.members.length} 名成员 · ${team.description}`}
            avatarStack={team.members.map((m) => m.assistantName.slice(0, 1))}
            testLabel="测试协作网格"
            testLoading={testingId === team.id}
            onTestConnection={() => handleTest(team.id)}
            editLabel="查看小队"
            onEdit={() => {
              setActiveTeam({ ...team });
              setIsCreatingTeam(false);
            }}
          />
        ))
      )}
    </AionSettingsParadigm>
  );
}
