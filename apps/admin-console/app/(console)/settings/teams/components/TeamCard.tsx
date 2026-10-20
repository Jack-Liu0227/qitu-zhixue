'use client';

import type { AdminTeamConfig } from '@qitu/contracts';
import { VisualAsset } from '@qitu/ui';
import { useState } from 'react';
import { fetchVisualBinding } from '../../../../../lib/api/visual-assets';
import { VisualSelector } from '../../../../../lib/components/VisualAssetPicker';

interface TeamCardProps {
  team: AdminTeamConfig;
  isActive: boolean;
  isSelected?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
  onToggleEnabled?: (e: React.MouseEvent) => void;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

export function TeamCard({ team, isActive, isSelected, onToggleSelect, onToggleEnabled, onClick, onDelete }: TeamCardProps) {
  const [icon, setIcon] = useState<string | null>(null);
  const [iconError, setIconError] = useState('');
  const memberCount = team.members.length;
  const leader = team.members.find((m) => m.assistantId === team.leaderAssistantId);
  const isEnabled = team.enabled !== false;
  
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={Boolean(isSelected)}
            onChange={() => {}}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect?.(e);
            }}
            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
          />
          <div className="team-card-icon">
            <VisualAsset assetId={icon ?? team.iconAssetId ?? 'subject-interdisciplinary-v1'} size={40} />
          </div>
        </div>
        <div className="team-card-info">
          <h3 className="team-card-name">{team.name}</h3>
          <p className="team-card-meta">
            {memberCount} 名成员 · 队长: {leader?.assistantName || '未指定'}
          </p>
        </div>
      </div>
      
      <div className="team-card-status" onClick={(e) => e.stopPropagation()}>
        <span
          className={`status-badge ${isEnabled ? 'is-ready' : 'is-disabled'}`}
          onClick={onToggleEnabled}
          style={{ cursor: onToggleEnabled ? 'pointer' : 'default' }}
          title={isEnabled ? '已启用（点击停用）' : '已停用（点击启用）'}
        >
          {isEnabled ? '运行中 · 点击停用' : '已停用 · 点击启用'}
        </span>
      </div>
      
      <div className="team-card-actions" onClick={(e) => e.stopPropagation()}>
        <VisualSelector owner={{ kind: 'team', id: team.id }} label="团队图标" onSaved={() => { setIconError(''); void fetchVisualBinding({ kind: 'team', id: team.id }, 'icon').then((binding) => setIcon(binding.effectiveAssetId)).catch(() => setIconError('图标回读失败，请刷新核对')); }} />
        {iconError && <small role="status">{iconError}</small>}
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
