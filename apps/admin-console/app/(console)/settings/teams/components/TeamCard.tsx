'use client';

import type { AdminTeamConfig } from '@qitu/contracts';

interface TeamCardProps {
  team: AdminTeamConfig;
  isActive: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

export function TeamCard({ team, isActive, onClick, onDelete }: TeamCardProps) {
  const memberCount = team.members.length;
  const leader = team.members.find((m) => m.assistantId === team.leaderAssistantId);
  
  return (
    <div
      className={`team-card ${isActive ? 'is-active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="team-card-header">
        <div className="team-card-icon">
          <span>👥</span>
        </div>
        <div className="team-card-info">
          <h3 className="team-card-name">{team.name}</h3>
          <p className="team-card-meta">
            {memberCount} 名成员 · 队长: {leader?.assistantName || '未指定'}
          </p>
        </div>
      </div>
      
      <div className="team-card-status">
        <span className="status-badge is-ready">就绪</span>
      </div>
      
      <div className="team-card-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="team-card-action-btn"
          onClick={onDelete}
          title="删除团队"
        >
          🗑️
        </button>
      </div>
    </div>
  );
}
