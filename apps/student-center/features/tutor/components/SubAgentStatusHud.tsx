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
  activeAgent?: SubAgentInfo | null;
  onSelectAgent?: (agentId: string) => void;
}

/**
 * Herdr-inspired multi-agent status HUD.
 * Renders active sub-agent pills with live elapsed time counters at the bottom of the conversation.
 * When a sub-agent's task finishes, it automatically disappears from the bottom HUD.
 * When an agent is awakened again, it reappears in the bottom HUD.
 */
export function SubAgentStatusHud({
  currentTeam,
  streaming,
  activeAgent,
  onSelectAgent,
}: SubAgentStatusHudProps) {
  const isKinetic = currentTeam === 'team-kinetic-energy';

  const [currentDisplayAgent, setCurrentDisplayAgent] = useState<SubAgentInfo | null>(() => activeAgent ?? null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (activeAgent) {
      setCurrentDisplayAgent(activeAgent);
      setElapsed(0);
    } else {
      // 任务结束后自动淡出不展示
      const timer = setTimeout(() => {
        setCurrentDisplayAgent(null);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [activeAgent]);

  useEffect(() => {
    if (!currentDisplayAgent || currentDisplayAgent.status !== 'active') return;
    const interval = setInterval(() => {
      setElapsed((prev) => +(prev + 0.5).toFixed(1));
    }, 500);
    return () => clearInterval(interval);
  }, [currentDisplayAgent]);

  // 如果没有活跃的子 Agent，自动不展示 HUD（严格满足用户需求）
  if (!currentDisplayAgent || currentDisplayAgent.status !== 'active') return null;

  const agent = currentDisplayAgent;

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
        🤖 活跃协作 Agent:
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'nowrap' }}>
        <div
          onClick={() => onSelectAgent?.(agent.id)}
          title={`点击在右侧团队面板查看 ${agent.name} 详情`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 10px',
            borderRadius: '999px',
            background: '#ffffff',
            border: `1.5px solid ${agent.color}`,
            boxShadow: '0 2px 6px rgba(37,99,235,0.12)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#10b981',
              boxShadow: '0 0 0 3px rgba(16,185,129,0.25)',
              display: 'inline-block',
            }}
          />
          <span style={{ fontWeight: 700, color: '#1e293b' }}>{agent.name}</span>
          <span style={{ fontSize: '11px', color: '#2563eb', fontWeight: 600 }}>
            {agent.role} · 运行 {elapsed}s
          </span>
        </div>
      </div>
    </div>
  );
}
