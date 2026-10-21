'use client';

import { RobotMascot } from '@qitu/ui';

interface TutorHeaderProps {
  currentTeam: 'team-thunder-fighter' | 'team-kinetic-energy';
  onTeamChange: (team: 'team-thunder-fighter' | 'team-kinetic-energy') => void;
  onClearHistory: () => void;
  onOpenLlmSettings?: () => void;
}

export function TutorHeader({
  currentTeam,
  onTeamChange,
  onClearHistory,
  onOpenLlmSettings,
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
            <span className="qitu-tutor-header-tag">
              PBL 互动式教学
            </span>
          </h1>
          <p className="qitu-tutor-header-subtitle">做最懂你的 AI 项目探究伙伴 · 严格遵循 TheoryMastered 门禁</p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        {onOpenLlmSettings && (
          <button
            type="button"
            onClick={onOpenLlmSettings}
            title="配置大语言模型服务商与 API Key"
            className="qitu-tutor-header-btn is-llm"
          >
            <span>⚡</span> 模型接入与设置
          </button>
        )}

        <button
          onClick={onClearHistory}
          title="清空当前会话历史"
          className="qitu-tutor-header-btn is-clear"
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
