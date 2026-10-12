'use client';

import { RobotMascot } from '@qitu/ui';

interface TutorHeaderProps {
  currentTeam: 'team-thunder-fighter' | 'team-kinetic-energy';
  onTeamChange: (team: 'team-thunder-fighter' | 'team-kinetic-energy') => void;
  onClearHistory: () => void;
}

export function TutorHeader({
  currentTeam,
  onTeamChange,
  onClearHistory,
}: TutorHeaderProps) {
  return (
    <header className="qitu-tutor-header" style={{ flexWrap: 'wrap', gap: '16px', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div className="qitu-tutor-header-mascot" aria-hidden="true">
          <RobotMascot size={58} mood="thinking" />
        </div>
        <div>
          <p className="qitu-tutor-eyebrow">启途智学 · 多智能体协作搭档</p>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            AI搭档
            <span style={{ fontSize: '13px', fontWeight: 500, color: '#2563eb', background: '#eff6ff', padding: '2px 8px', borderRadius: '12px', border: '1px solid #bfdbfe' }}>
              PBL 互动式教学
            </span>
          </h1>
          <p className="qitu-tutor-header-subtitle">做最懂你的 AI 项目探究伙伴 · 严格遵循 TheoryMastered 门禁</p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        {/* 团队切换 */}
        <div style={{ display: 'flex', alignItems: 'center', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '4px 8px', gap: '6px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>导师团队:</span>
          <select
            value={currentTeam}
            onChange={(e) => onTeamChange(e.target.value as 'team-thunder-fighter' | 'team-kinetic-energy')}
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: '13px',
              fontWeight: 600,
              color: '#0f172a',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="team-kinetic-energy">⚡ 动手学动能定理导师团队 (PBL)</option>
            <option value="team-thunder-fighter">🕹️ 雷霆战机小游戏导师团队 (PBL)</option>
          </select>
        </div>



        <button
          onClick={onClearHistory}
          title="清空当前会话历史"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: '#ffffff',
            color: '#ef4444',
            border: '1px solid #fca5a5',
            borderRadius: '8px',
            padding: '7px 10px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <span>🗑️</span> 清空
        </button>

        <div className="qitu-tutor-header-status" role="status" style={{ margin: 0 }}>
          <span className="qitu-tutor-status-dot" aria-hidden="true" />
          全链路真实协同
        </div>
      </div>
    </header>
  );
}
