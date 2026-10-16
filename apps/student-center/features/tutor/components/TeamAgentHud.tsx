'use client';

import React, { useMemo, useState } from 'react';
import type { TutorTurn } from '@qitu/contracts';

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

export function resolveSubAgents(currentProjectId?: string, currentTitle?: string): SubAgentStatus[] {
  const isThunder = /雷霆|战机|pygame|fighter/i.test(currentTitle ?? '');
  if (!currentProjectId) {
    return [
      {
        id: 'asst-intake',
        name: '启途智学助手',
        role: '意图引导管家',
        avatar: '🧭',
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
}

interface TeamAgentHudProps {
  currentProjectId?: string;
  currentTitle?: string;
  turns?: TutorTurn[];
}

export function TeamAgentHud({ currentProjectId, currentTitle, turns = [] }: TeamAgentHudProps) {
  const [inspectingAgent, setInspectingAgent] = useState<SubAgentStatus | null>(null);

  const isThunder = /雷霆|战机|pygame|fighter/i.test(currentTitle ?? '');
  const teamName = currentProjectId
    ? (isThunder ? '雷霆战机团队' : (currentTitle ? `${currentTitle}导师团队` : '动能定理导师团队'))
    : '启途智学助手';

  const subAgents: SubAgentStatus[] = useMemo(() => {
    return resolveSubAgents(currentProjectId, currentTitle);
  }, [currentProjectId, currentTitle]);

  return (
    <div style={{ marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* 导师团队 / 助手总状态卡 */}
      <div
        style={{
          padding: '12px 14px',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>{currentProjectId ? '👥' : '🧭'}</span>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{teamName}</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                {currentProjectId ? `${subAgents.length} 位专属导师协作中` : '学习兴趣梳理与立项引导'}
              </div>
            </div>
          </div>
          <span
            style={{
              fontSize: '11px',
              color: currentProjectId ? '#15803d' : '#2563eb',
              fontWeight: 600,
              background: currentProjectId ? '#dcfce7' : '#dbeafe',
              padding: '2px 8px',
              borderRadius: '6px',
            }}
          >
            {currentProjectId ? '团队接管中' : '意图探索'}
          </span>
        </div>

        {/* 子 Agent 列表卡片/表格 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {subAgents.map((agent) => {
            const agentTurns = turns.filter(
              (t) =>
                t.role === 'assistant' &&
                (t.author?.role === agent.role ||
                  t.author?.name?.includes(agent.name) ||
                  agent.id === 'asst-intake' ||
                  (!t.author && agent.role === '概念教练')),
            );

            const toolCalls = agentTurns.flatMap((t) =>
              t.blocks.filter((b) => (b as any).kind === 'tool').map((b) => (b as any).call),
            );

            const lastToolCall = toolCalls.at(-1);

            return (
              <div
                key={agent.id}
                onClick={() => setInspectingAgent(agent)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: '#f8fafc',
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
                  e.currentTarget.style.background = '#f8fafc';
                }}
                title="点击查看详细对话历史与工具调用记录"
              >
                {/* 顶部行：头像、名称、角色、状态 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: '18px',
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {agent.avatar}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>{agent.name}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{agent.role}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: agent.status === 'active' ? '#22c55e' : '#94a3b8',
                      }}
                    />
                    <span
                      style={{
                        fontSize: '11px',
                        color: agent.status === 'active' ? '#16a34a' : '#64748b',
                        fontWeight: 600,
                      }}
                    >
                      {agent.statusLabel}
                    </span>
                    <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '2px' }}>›</span>
                  </div>
                </div>

                {/* 底部互动指标：对话条数与工具调用 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    color: '#64748b',
                    borderTop: '1px dashed #e2e8f0',
                    paddingTop: '6px',
                    marginTop: '2px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span>💬 {agentTurns.length} 条对话</span>
                    <span>🔧 {toolCalls.length} 次工具调用</span>
                  </div>
                  {lastToolCall ? (
                    <span
                      style={{
                        maxWidth: '90px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: '#0284c7',
                        fontWeight: 500,
                      }}
                      title={`最近调用：${lastToolCall.label ?? lastToolCall.name}`}
                    >
                      {lastToolCall.label ?? lastToolCall.name}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {inspectingAgent && (
        <AgentDetailModal
          inspectingAgent={inspectingAgent}
          turns={turns}
          onClose={() => setInspectingAgent(null)}
        />
      )}
    </div>
  );
}

export function AgentDetailModal({
  inspectingAgent,
  turns = [],
  onClose,
}: {
  inspectingAgent: SubAgentStatus;
  turns?: TutorTurn[];
  onClose: () => void;
}) {
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

  return (
    <div
      role="presentation"
      onClick={onClose}
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
        {/* 头部 */}
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
            onClick={onClose}
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

        {/* 内容 */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
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

          <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>
            💬 该智能体在当前会话的交互历史与工具调用 ({inspectingTurns.length} 条)：
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
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
