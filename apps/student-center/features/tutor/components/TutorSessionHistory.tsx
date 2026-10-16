'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { TutorTurn } from '@qitu/contracts';
import { useTutorDataSource } from '../TutorDataSourceProvider';

export interface HistorySessionItem {
  id: string;
  title: string;
  kind: 'project' | 'exploration';
  projectId?: string;
  explorationId?: string;
  updatedAt: string;
  turnCount: number;
  stageLabel?: string;
}

export interface SubAgentStatus {
  id: string;
  name: string;
  role: string;
  avatar: string;
  color: string;
  status: 'active' | 'standby' | 'ready';
  statusLabel: string;
  description: string;
}

const STORAGE_KEY = 'qitu.tutor.exploration_history';

export function getLocalExplorationHistory(): HistorySessionItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalExplorationSession(item: HistorySessionItem) {
  if (typeof window === 'undefined') return;
  try {
    const history = getLocalExplorationHistory();
    const filtered = history.filter((h) => h.id !== item.id);
    const updated = [item, ...filtered].slice(0, 30); // 保留最近30条
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}
}

export function deleteLocalExplorationSession(id: string) {
  if (typeof window === 'undefined') return;
  try {
    const history = getLocalExplorationHistory();
    const updated = history.filter((h) => h.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}
}

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
    if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} 天前`;
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  } catch {
    return '未知时间';
  }
}

interface TutorSessionHistoryProps {
  currentProjectId?: string;
  currentExplorationId?: string | null;
  currentTitle?: string;
  currentTurnCount: number;
  isOpen: boolean;
  onToggle: () => void;
  onNewExploration: () => void;
  onSelectProject?: (projectId: string) => void;
  turns?: TutorTurn[];
  busy?: boolean;
}

export function TutorSessionHistory({
  currentProjectId,
  currentExplorationId,
  currentTitle,
  currentTurnCount,
  isOpen,
  onToggle,
  onNewExploration,
  onSelectProject,
  turns,
  busy = false,
}: TutorSessionHistoryProps) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const dataSource = useTutorDataSource();
  const [projectSessions, setProjectSessions] = useState<HistorySessionItem[]>([]);
  const [explorationHistory, setExplorationHistory] = useState<HistorySessionItem[]>([]);
  const [inspectingAgent, setInspectingAgent] = useState<SubAgentStatus | null>(null);

  const isThunder = /雷霆|战机|pygame|fighter/i.test(currentTitle ?? '');
  const teamName = currentProjectId ? (isThunder ? '雷霆战机导师团队' : '动能定理导师团队') : '启途智学助手';

  const subAgents: SubAgentStatus[] = useMemo(() => {
    if (!currentProjectId) {
      return [
        {
          id: 'asst-intake',
          name: '启途智学助手',
          role: '意图引导管家',
          avatar: '🤖',
          color: '#2563eb',
          status: 'active',
          statusLabel: '探究中',
          description: '作为平台核心助手，负责梳理学生学习兴趣，推荐适配的 PBL 课题，并在对话内一键发起立项。',
        },
      ];
    }
    if (isThunder) {
      return [
        {
          id: 'fighter-concept-coach',
          name: '概念教练',
          role: '概念教练',
          avatar: '🚀',
          color: '#2563eb',
          status: 'active',
          statusLabel: '探究中',
          description: '引导拆解 Pygame 游戏主循环、帧率控制与状态机逻辑，遵循苏格拉底教学法。',
        },
        {
          id: 'fighter-code-guide',
          name: '沙箱向导',
          role: '代码向导',
          avatar: '💻',
          color: '#0d9488',
          status: 'standby',
          statusLabel: '就绪',
          description: '负责玩家战机、敌机生成与碰撞检测算法实现，理论门禁通过后进入动手实践。',
        },
        {
          id: 'fighter-review-assessor',
          name: '评审导师',
          role: '评审导师',
          avatar: '📋',
          color: '#8b5cf6',
          status: 'standby',
          statusLabel: '待命',
          description: '负责可玩性测试、代码规范及反思总结报告的多维度形成性评价。',
        },
      ];
    }
    return [
      {
        id: 'kinetic-concept-coach',
        name: '概念教练',
        role: '概念教练',
        avatar: '💡',
        color: '#2563eb',
        status: 'active',
        statusLabel: '探究中',
        description: '运用苏格拉底教学法启发物理公式推导，不直接给出答案。',
      },
      {
        id: 'kinetic-experiment-guide',
        name: '沙箱向导',
        role: '实验向导',
        avatar: '🛠️',
        color: '#0d9488',
        status: 'standby',
        statusLabel: '就绪',
        description: '指导斜面小车仿真实验，协助进行实验数据记录与图表分析。',
      },
      {
        id: 'kinetic-review-assessor',
        name: '评审导师',
        role: '评审导师',
        avatar: '📋',
        color: '#8b5cf6',
        status: 'standby',
        statusLabel: '待命',
        description: '把关 TheoryMastered 门禁，对探究报告与反思进行形成性评价。',
      },
    ];
  }, [currentProjectId, isThunder]);

  const inspectingTurns = useMemo(() => {
    if (!inspectingAgent || !turns) return [];
    const targetTurns = turns.filter(
      (t) =>
        t.role === 'assistant' &&
        (t.author?.role === inspectingAgent.role ||
          t.author?.name?.includes(inspectingAgent.name) ||
          inspectingAgent.id === 'asst-intake' ||
          (!t.author && inspectingAgent.role === '概念教练')),
    );
    return targetTurns.length > 0 ? targetTurns : turns.filter((t) => t.role === 'assistant').slice(-3);
  }, [inspectingAgent, turns]);

  useEffect(() => {
    let cancelled = false;
    void dataSource.listProjects().then((projects) => {
      if (cancelled) return;
      setProjectSessions(projects.map((project) => ({
        id: project.id,
        title: project.title,
        kind: 'project',
        projectId: project.id,
        updatedAt: new Date().toISOString(),
        turnCount: project.id === currentProjectId ? currentTurnCount : 0,
        stageLabel: project.stage,
      })));
    }).catch(() => {
      if (!cancelled) setProjectSessions([]);
    });
    return () => { cancelled = true; };
  }, [dataSource, currentProjectId, currentTurnCount]);

  // 初始化并监听本地探索会话
  useEffect(() => {
    setExplorationHistory(getLocalExplorationHistory());
  }, []);

  // 当当前自由探索有新发言时，同步更新本地记录
  useEffect(() => {
    if (!currentProjectId && currentTurnCount > 0) {
      const activeExplorationId = currentExplorationId || 'exploration-active';
      const item: HistorySessionItem = {
        id: activeExplorationId,
        title: currentTitle && currentTitle !== '自由探索' ? currentTitle : `探究会话 #${activeExplorationId.slice(-4)}`,
        kind: 'exploration',
        explorationId: activeExplorationId,
        updatedAt: new Date().toISOString(),
        turnCount: currentTurnCount,
        stageLabel: '自由探索',
      };
      saveLocalExplorationSession(item);
      setExplorationHistory(getLocalExplorationHistory());
    }
  }, [currentProjectId, currentExplorationId, currentTitle, currentTurnCount]);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteLocalExplorationSession(id);
    setExplorationHistory(getLocalExplorationHistory());
  };

  const allSessions = useMemo(() => {
    return [...projectSessions, ...explorationHistory];
  }, [projectSessions, explorationHistory]);

  const filteredSessions = useMemo(() => {
    if (!searchTerm.trim()) return allSessions;
    const term = searchTerm.toLowerCase();
    return allSessions.filter((s) => s.title.toLowerCase().includes(term) || s.stageLabel?.toLowerCase().includes(term));
  }, [allSessions, searchTerm]);

  const handleSelectSession = (session: HistorySessionItem) => {
    if (busy) return;
    if (session.kind === 'project' && session.projectId) {
      if (onSelectProject) {
        onSelectProject(session.projectId);
      } else {
        router.push(`/tutor/${encodeURIComponent(session.projectId)}`);
      }
    } else {
      router.push(`/tutor?explorationId=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  };

  const isCurrentActive = (session: HistorySessionItem) => {
    if (currentProjectId && session.projectId === currentProjectId) return true;
    if (!currentProjectId && currentExplorationId && session.explorationId === currentExplorationId) return true;
    if (!currentProjectId && !currentExplorationId && session.id === 'exploration-active') return true;
    return false;
  };

  const renderInspectingModal = () => {
    if (!inspectingAgent) return null;
    return (
      <div
        role="presentation"
        onClick={() => setInspectingAgent(null)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="inspecting-agent-title"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: '560px',
            maxHeight: '85vh',
            background: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* 弹窗头部 */}
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid #f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#f8fafc',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  fontSize: '24px',
                  width: '42px',
                  height: '42px',
                  borderRadius: '10px',
                  background: inspectingAgent.color ? `${inspectingAgent.color}15` : '#eff6ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1.5px solid ${inspectingAgent.color ?? '#2563eb'}`,
                }}
              >
                {inspectingAgent.avatar}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3
                    id="inspecting-agent-title"
                    style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}
                  >
                    {inspectingAgent.name}
                  </h3>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      background: inspectingAgent.status === 'active' ? '#dcfce7' : '#f1f5f9',
                      color: inspectingAgent.status === 'active' ? '#15803d' : '#64748b',
                      fontWeight: 600,
                    }}
                  >
                    ● {inspectingAgent.statusLabel}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                  导师角色：{inspectingAgent.role}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setInspectingAgent(null)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '18px',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '6px',
              }}
              aria-label="关闭详情"
            >
              ✕
            </button>
          </div>

          {/* 弹窗内容 */}
          <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
            {/* 职责与运行状态说明 */}
            <div
              style={{
                padding: '12px 14px',
                background: '#f0f9ff',
                border: '1px solid #bae6fd',
                borderRadius: '10px',
                marginBottom: '16px',
                fontSize: '13px',
                color: '#0369a1',
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>📋 智能体职能分工：</div>
              <div>{inspectingAgent.description}</div>
            </div>

            {/* 历史对话与发言记录 */}
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>
              💬 该智能体在当前会话的交互历史 ({inspectingTurns.length} 条)：
            </div>

            {inspectingTurns.length === 0 ? (
              <div
                style={{
                  padding: '30px 12px',
                  textAlign: 'center',
                  color: '#94a3b8',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  border: '1px dashed #cbd5e1',
                  fontSize: '13px',
                }}
              >
                该智能体暂未在当前阶段发言。当前阶段推进或理论门禁通过后将自动唤醒。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {inspectingTurns.map((turn) => {
                  const textContent = turn.blocks
                    .filter((b) => (b as any).kind === 'text')
                    .map((b) => (b as any).text)
                    .join('\n');
                  const toolCalls = turn.blocks
                    .filter((b) => (b as any).kind === 'tool')
                    .map((b) => (b as any).call);

                  return (
                    <div
                      key={turn.turnId}
                      style={{
                        padding: '12px 14px',
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '10px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '6px',
                          fontSize: '11px',
                          color: '#94a3b8',
                        }}
                      >
                        <span style={{ fontWeight: 600, color: inspectingAgent.color ?? '#2563eb' }}>
                          {inspectingAgent.name} · {inspectingAgent.role}
                        </span>
                        <span>{turn.createdAt ? formatRelativeTime(turn.createdAt) : ''}</span>
                      </div>

                      {toolCalls.length > 0 && (
                        <div style={{ marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {toolCalls.map((tc: any) => (
                            <div
                              key={tc.callId}
                              style={{
                                fontSize: '11px',
                                padding: '3px 8px',
                                background: '#f1f5f9',
                                borderRadius: '4px',
                                color: '#475569',
                                fontFamily: 'monospace',
                              }}
                            >
                              🔧 调用工具：{tc.label ?? tc.name}
                            </div>
                          ))}
                        </div>
                      )}

                      <div
                        style={{
                          fontSize: '13px',
                          color: '#1e293b',
                          lineHeight: 1.6,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {textContent || '【多模态交互或卡片展示】'}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 底部按钮 */}
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid #f1f5f9',
              display: 'flex',
              justifyContent: 'flex-end',
              background: '#ffffff',
            }}
          >
            <button
              type="button"
              className="qitu-button qitu-button-ghost qitu-button-sm"
              onClick={() => setInspectingAgent(null)}
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (!isOpen) {
    return (
      <>
        <aside
          style={{
            width: 52,
            flexShrink: 0,
            padding: '14px 0',
            border: '1px solid #e4ecf7',
            borderRadius: 14,
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '14px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
            boxSizing: 'border-box',
          }}
        >
          <button
            type="button"
            onClick={onToggle}
            title="展开会话历史侧边栏"
            aria-label="展开会话历史侧边栏"
            style={{
              width: '36px',
              height: '36px',
              padding: 0,
              margin: '0 auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              background: '#f8fafc',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <span style={{ fontSize: '16px' }}>📂</span>
          </button>
          <button
            type="button"
            onClick={onNewExploration}
            disabled={busy}
            title="新建探究会话"
            aria-label="新建探究会话"
            style={{
              width: '36px',
              height: '36px',
              padding: 0,
              margin: '0 auto',
              borderRadius: '50%',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              fontSize: '18px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 6px rgba(37,99,235,0.2)',
            }}
          >
            +
          </button>

          {/* 子 Agent 状态指示灯（收起状态） */}
          {currentProjectId && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
              <div style={{ height: '1px', background: '#e2e8f0', width: '28px', margin: '4px auto' }} />
              {subAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setInspectingAgent(agent)}
                  title={`${agent.name} (${agent.role}) · 点击查看运行状态与历史`}
                  style={{
                    position: 'relative',
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    border: `1.5px solid ${agent.status === 'active' ? '#3b82f6' : '#cbd5e1'}`,
                    background: agent.status === 'active' ? '#eff6ff' : '#f8fafc',
                    cursor: 'pointer',
                    fontSize: '18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    margin: '0 auto',
                  }}
                >
                  <span>{agent.avatar}</span>
                  <span
                    style={{
                      position: 'absolute',
                      bottom: '-2px',
                      right: '-2px',
                      width: '9px',
                      height: '9px',
                      borderRadius: '50%',
                      background: agent.status === 'active' ? '#22c55e' : '#94a3b8',
                      border: '1.5px solid #fff',
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </aside>
        {renderInspectingModal()}
      </>
    );
  }

  return (
    <>
      <aside
        className="qitu-live-session-sidebar"
      style={{
        width: 'min(280px, 28vw)',
        flexShrink: 0,
        padding: '14px 12px',
        border: '1px solid #e2e8f0',
        borderRadius: 14,
        background: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 2px 10px rgba(0,0,0,0.03)',
        height: '100%',
        minHeight: '520px',
      }}
    >
      {/* 顶部工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '16px' }}>💬</span>
          <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: '#0f172a' }}>会话历史</h2>
        </div>
        <button
          type="button"
          className="qitu-button qitu-button-ghost qitu-button-sm"
          onClick={onToggle}
          aria-label="收起侧栏"
          style={{ fontSize: '12px', padding: '4px 8px' }}
        >
          收起 ◀
        </button>
      </div>

      {/* 导师团队 / 子 Agent 状态栏 */}
      <div
        style={{
          marginBottom: '12px',
          padding: '10px 10px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '14px' }}>{currentProjectId ? '👥' : '🤖'}</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
              {teamName}
            </span>
          </div>
          <span
            style={{
              fontSize: '10.5px',
              color: currentProjectId ? '#15803d' : '#2563eb',
              fontWeight: 600,
              background: currentProjectId ? '#dcfce7' : '#dbeafe',
              padding: '1px 6px',
              borderRadius: '4px',
            }}
          >
            {currentProjectId ? '团队接管中' : '意图探索'}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {subAgents.map((agent) => (
            <div
              key={agent.id}
              onClick={() => setInspectingAgent(agent)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 8px',
                borderRadius: '8px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#3b82f6';
                e.currentTarget.style.background = '#f0f7ff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e2e8f0';
                e.currentTarget.style.background = '#ffffff';
              }}
              title="点击查看详细对话历史与职责"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
                <span style={{ fontSize: '15px' }}>{agent.avatar}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>{agent.name}</div>
                  <div style={{ fontSize: '10.5px', color: '#64748b' }}>{agent.role}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: agent.status === 'active' ? '#22c55e' : '#94a3b8',
                  }}
                />
                <span
                  style={{
                    fontSize: '10.5px',
                    color: agent.status === 'active' ? '#16a34a' : '#64748b',
                    fontWeight: 500,
                  }}
                >
                  {agent.statusLabel}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 新建探索按钮 */}
      <button
        type="button"
        className="qitu-button qitu-button-primary"
        onClick={onNewExploration}
        disabled={busy}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          fontWeight: 600,
          marginBottom: '10px',
          borderRadius: '10px',
        }}
      >
        <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span>
        <span>新建探究会话</span>
      </button>

      {/* 搜索框 */}
      <div style={{ marginBottom: '12px', position: 'relative' }}>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索历史会话..."
          style={{
            width: '100%',
            padding: '6px 10px 6px 28px',
            fontSize: '12px',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            background: '#f8fafc',
            outline: 'none',
          }}
        />
        <span style={{ position: 'absolute', left: '8px', top: '7px', fontSize: '12px', opacity: 0.5 }}>🔍</span>
      </div>

      {/* 会话列表 */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {filteredSessions.length === 0 ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
            暂无匹配的历史会话
          </div>
        ) : (
          filteredSessions.map((item) => {
            const active = isCurrentActive(item);
            return (
              <div
                key={item.id}
                onClick={() => handleSelectSession(item)}
                style={{
                  padding: '10px 10px',
                  borderRadius: '10px',
                  border: active ? '1.5px solid #3b82f6' : '1px solid #f1f5f9',
                  background: active ? '#eff6ff' : '#ffffff',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'all 0.15s ease',
                  boxShadow: active ? '0 2px 8px rgba(59,130,246,0.12)' : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = '#f8fafc';
                    e.currentTarget.style.borderColor = '#e2e8f0';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = '#ffffff';
                    e.currentTarget.style.borderColor = '#f1f5f9';
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <span style={{ fontSize: '15px', lineHeight: 1.2 }}>
                    {item.kind === 'project' ? '🚀' : '💡'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: active ? 700 : 500,
                        color: active ? '#1e40af' : '#1e293b',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={item.title}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '11px',
                        color: active ? '#3b82f6' : '#64748b',
                        marginTop: '3px',
                      }}
                    >
                      {item.stageLabel && (
                        <span style={{ background: active ? '#dbeafe' : '#f1f5f9', padding: '1px 5px', borderRadius: '4px' }}>
                          {item.stageLabel}
                        </span>
                      )}
                      <span>{item.turnCount}条对话</span>
                      <span>·</span>
                      <span>{formatRelativeTime(item.updatedAt)}</span>
                    </div>
                  </div>

                  {item.kind === 'exploration' && (
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, item.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        padding: '2px 4px',
                        fontSize: '12px',
                        opacity: 0.6,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
                      title="删除此会话记录"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部信息提示 */}
      <div
        style={{
          marginTop: '12px',
          paddingTop: '10px',
          borderTop: '1px solid #f1f5f9',
          fontSize: '11px',
          color: '#94a3b8',
          lineHeight: 1.4,
        }}
      >
        <p style={{ margin: 0 }}>🔒 会话受服务端安全门禁与审计保护，未成年人数据最小化可见。</p>
      </div>
      </aside>
      {renderInspectingModal()}
    </>
  );
}
