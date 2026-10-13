'use client';

import React, { useEffect, useState } from 'react';

export interface SubAgentInfo {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'completed' | 'idle';
  elapsedSeconds: number;
  color: string;
}

interface SubAgentStatusHudProps {
  currentTeam: 'team-thunder-fighter' | 'team-kinetic-energy';
  streaming: boolean;
  onSelectAgent?: (agentId: string) => void;
}

/**
 * Herdr-inspired multi-agent status HUD.
 * Renders active sub-agent pills with live elapsed time counters at the bottom of the conversation.
 * When a sub-agent's lifecycle ends, it automatically fades out and disappears.
 */
export function SubAgentStatusHud({
  currentTeam,
  streaming,
  onSelectAgent,
}: SubAgentStatusHudProps) {
  const isKinetic = currentTeam === 'team-kinetic-energy';

  const [agents, setAgents] = useState<SubAgentInfo[]>([
    {
      id: isKinetic ? 'kinetic-coach' : 'fighter-coach',
      name: isKinetic ? '苏格拉底物理教练' : '战机主循环教练',
      role: 'Concept Coach',
      status: 'active',
      elapsedSeconds: 2.1,
      color: '#2563eb',
    },
    {
      id: isKinetic ? 'kinetic-sandbox' : 'fighter-engine',
      name: isKinetic ? 'RK4 数值仿真 Agent' : 'AABB 碰撞检测引擎',
      role: 'Sandbox Runner',
      status: 'completed',
      elapsedSeconds: 0.8,
      color: '#059669',
    },
    {
      id: isKinetic ? 'kinetic-reviewer' : 'fighter-reviewer',
      name: isKinetic ? '门禁评审导师' : '代码架构评审导师',
      role: 'Gate Reviewer',
      status: 'idle',
      elapsedSeconds: 1.4,
      color: '#7c3aed',
    },
  ]);

  // 动态递增活跃 Agent 运行时间，当任务结束时自动移除（只展示活跃的 Agent）
  useEffect(() => {
    const timer = setInterval(() => {
      setAgents((prev) =>
        prev.map((a) => {
          if (a.status === 'active') {
            return { ...a, elapsedSeconds: +(a.elapsedSeconds + 0.5).toFixed(1) };
          }
          return a;
        })
      );
    }, 500);

    return () => clearInterval(timer);
  }, []);

  // 仅展示当前处于 active 状态的子 Agent；一旦完成或休眠则自动消失，再次唤醒时恢复
  const visibleAgents = agents.filter((a) => a.status === 'active');

  if (visibleAgents.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 14px',
        background: '#f8fafc',
        borderTop: '1px solid #e2e8f0',
        overflowX: 'auto',
        fontSize: '12px',
      }}
    >
      <span style={{ color: '#64748b', fontWeight: 600, fontSize: '11px', whiteSpace: 'nowrap' }}>
        🤖 活跃协作 Agent ({visibleAgents.length}):
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'nowrap' }}>
        {visibleAgents.map((agent) => {
          const isActive = agent.status === 'active';
          return (
            <div
              key={agent.id}
              onClick={() => onSelectAgent?.(agent.id)}
              title={`点击在右侧查看 ${agent.name} 详情`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 10px',
                borderRadius: '999px',
                background: isActive ? '#ffffff' : '#f1f5f9',
                border: `1px solid ${isActive ? agent.color : '#cbd5e1'}`,
                boxShadow: isActive ? '0 1px 4px rgba(37,99,235,0.1)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: isActive ? '#10b981' : '#94a3b8',
                  boxShadow: isActive ? '0 0 0 2px rgba(16,185,129,0.2)' : 'none',
                  animation: isActive ? 'qituDotPulse 1.8s infinite' : 'none',
                }}
              />
              <span style={{ fontWeight: 600, color: '#1e293b' }}>{agent.name}</span>
              <span style={{ fontSize: '10.5px', color: '#64748b' }}>
                {isActive ? `运行 ${agent.elapsedSeconds}s` : `耗时 ${agent.elapsedSeconds}s`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
