'use client';

import { useState } from 'react';
import { TeamStatusBadge, type TeamNodeStatus } from '@qitu/ui';

interface TutorTeamRailProps {
  currentTeam?: 'team-thunder-fighter' | 'team-kinetic-energy';
  streaming: boolean;
  ready: boolean;
  failed: boolean;
  offline: boolean;
  isOpen?: boolean;
  onToggleOpen?: () => void;
}

export function TutorTeamRail({
  currentTeam = 'team-kinetic-energy',
  streaming,
  ready,
  failed,
  offline,
  isOpen = false,
  onToggleOpen,
}: TutorTeamRailProps) {
  const [activeTab, setActiveTab] = useState<'progress' | 'members'>('progress');

  const leaderStatus: TeamNodeStatus = offline
    ? 'offline'
    : failed
    ? 'failed'
    : streaming
    ? 'running'
    : ready
    ? 'ready'
    : 'waiting';

  const isKinetic = currentTeam === 'team-kinetic-energy';

  // 项目里程碑列表（已完成绿色，未完成黄色）
  const milestones = isKinetic
    ? [
        { id: 1, title: '探索与问题发现：受力与运动观察', status: 'completed' as const, phase: 'Stage 1' },
        { id: 2, title: '原理推导：恒力做功与动能定理推导 (W=ΔEk)', status: 'current' as const, phase: 'Stage 2' },
        { id: 3, title: '门禁核准：TheoryMastered 掌握度评估', status: 'pending' as const, phase: 'Gate' },
        { id: 4, title: '实践验证：Python 物理数值仿真与绘图', status: 'pending' as const, phase: 'Stage 3' },
        { id: 5, title: '结项答辩：能量守恒元认知反思报告', status: 'pending' as const, phase: 'Stage 4' },
      ]
    : [
        { id: 1, title: '游戏概念构思：玩法机制与素材规划', status: 'completed' as const, phase: 'Stage 1' },
        { id: 2, title: '核心原理探索：游戏主循环与坐标刷新', status: 'completed' as const, phase: 'Stage 2' },
        { id: 3, title: '几何算法攻坚：AABB 矩形碰撞检测', status: 'current' as const, phase: 'Stage 2' },
        { id: 4, title: '门禁核准：TheoryMastered 掌握度评估', status: 'pending' as const, phase: 'Gate' },
        { id: 5, title: '代码构建：Pygame 完整战机小游戏实现', status: 'pending' as const, phase: 'Stage 3' },
      ];

  if (!isOpen) {
    return (
      <aside
        style={{
          width: '42px',
          flexShrink: 0,
          background: '#ffffff',
          border: '1px solid #e4ecf7',
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '12px 0',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onClick={onToggleOpen}
        title="点击展开项目进度与导师状态面板"
      >
        <button
          type="button"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            color: '#2563eb',
            marginBottom: '16px',
          }}
        >
          ◀
        </button>
        <span
          style={{
            writingMode: 'vertical-rl',
            fontSize: '12px',
            fontWeight: 600,
            color: '#64748b',
            letterSpacing: '0.15em',
          }}
        >
          {isKinetic ? '动能定理 · 进度与团队' : '雷霆战机 · 进度与团队'}
        </span>
      </aside>
    );
  }

  return (
    <aside
      className="qitu-tutor-col qitu-tutor-col-right qitu-tutor-team-rail"
      aria-label="项目进度与 AI 导师 Team"
      style={{
        width: '320px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
        border: '1px solid #e4ecf7',
        borderRadius: '14px',
        boxShadow: '0 4px 16px rgba(16, 42, 92, 0.04)',
        overflow: 'hidden',
      }}
    >
      {/* 头部与折叠按钮 */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: '11px', color: '#2563eb', fontWeight: 700, letterSpacing: '0.08em' }}>PBL WORKSPACE</span>
          <h3 style={{ margin: '2px 0 0', fontSize: '14px', color: '#0f172a', fontWeight: 700 }}>
            {isKinetic ? '动手学动能定理' : '雷霆战机小游戏'}
          </h3>
        </div>
        <button
          type="button"
          onClick={onToggleOpen}
          title="收起右侧面板"
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '4px',
            borderRadius: '4px',
          }}
        >
          ▶
        </button>
      </div>

      {/* 两个 Tab 切换 */}
      <div style={{ display: 'flex', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
        <button
          type="button"
          onClick={() => setActiveTab('progress')}
          style={{
            flex: 1,
            padding: '9px 0',
            fontSize: '12.5px',
            fontWeight: activeTab === 'progress' ? 700 : 500,
            color: activeTab === 'progress' ? '#2563eb' : '#64748b',
            border: 'none',
            borderBottom: activeTab === 'progress' ? '2px solid #2563eb' : '2px solid transparent',
            background: activeTab === 'progress' ? '#ffffff' : 'transparent',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          📊 项目进度与检查点
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('members')}
          style={{
            flex: 1,
            padding: '9px 0',
            fontSize: '12.5px',
            fontWeight: activeTab === 'members' ? 700 : 500,
            color: activeTab === 'members' ? '#2563eb' : '#64748b',
            border: 'none',
            borderBottom: activeTab === 'members' ? '2px solid #2563eb' : '2px solid transparent',
            background: activeTab === 'members' ? '#ffffff' : 'transparent',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          👥 导师团队状态
        </button>
      </div>

      {/* Tab 内容区 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {activeTab === 'progress' ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '12px', color: '#64748b' }}>PBL 关键推进路线</span>
              <span style={{ fontSize: '11px', background: '#eff6ff', color: '#1d4ed8', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                当前阶段: 原理推导
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {milestones.map((ms) => {
                const isDone = ms.status === 'completed';
                const isCur = ms.status === 'current';
                return (
                  <div
                    key={ms.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: isCur ? '1.5px solid #3b82f6' : '1px solid #e2e8f0',
                      background: isCur ? '#eff6ff' : isDone ? '#f0fdf4' : '#ffffff',
                    }}
                  >
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: '11px',
                        fontWeight: 700,
                        background: isDone ? '#10b981' : isCur ? '#f59e0b' : '#e2e8f0',
                        color: isDone || isCur ? '#ffffff' : '#64748b',
                        flexShrink: 0,
                        marginTop: '1px',
                      }}
                    >
                      {isDone ? '✓' : ms.id}
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '13px', fontWeight: isCur ? 700 : 500, color: isCur ? '#1d4ed8' : '#1e293b' }}>
                          {ms.title}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>{ms.phase}</span>
                        <span
                          style={{
                            fontSize: '10.5px',
                            fontWeight: 600,
                            padding: '1px 6px',
                            borderRadius: '999px',
                            background: isDone ? '#dcfce7' : isCur ? '#fef3c7' : '#f1f5f9',
                            color: isDone ? '#15803d' : isCur ? '#b45309' : '#64748b',
                          }}
                        >
                          {isDone ? '● 已完成' : isCur ? '● 正在推进' : '○ 待解锁'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: '16px', padding: '10px 12px', background: '#fefce8', border: '1px solid #fef08a', borderRadius: '8px', fontSize: '12px', color: '#854d0e' }}>
              <strong>🔒 门禁规则锁定：</strong>
              <div style={{ marginTop: '2px', color: '#713f12' }}>在完成动能定理或游戏主循环物理推导前，系统将阻断代码实践任务。</div>
            </div>
          </div>
        ) : (
          <div>
            <ol className="qitu-tutor-team-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              <TutorTeamItem
                label={isKinetic ? '苏格拉底教练' : '战机原理教练'}
                detail="Coach · 主导概念提问与门禁"
                status={leaderStatus}
              />
              <TutorTeamItem
                label={isKinetic ? '探索向导 (小凯)' : '互动向导 (小翼)'}
                detail="Teammate · 实验观察与思路启发"
                status="waiting"
              />
              <TutorTeamItem
                label={isKinetic ? '严谨评审导师' : '代码评审导师'}
                detail="Reviewer · 公式推导与阶段门禁核准"
                status="waiting"
              />
              <TutorTeamItem
                label="成长分析引擎"
                detail="系统 Agent · 自动捕获四维能力轨迹"
                status="ready"
              />
            </ol>
            <p className="qitu-tutor-team-footnote" style={{ marginTop: '14px', fontSize: '11.5px', color: '#94a3b8' }}>
              各导师依据自建 Agent SDK 协同运作，在会话中根据阶段自动交接主导权。
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

function TutorTeamItem({ label, detail, status }: { label: string; detail: string; status: TeamNodeStatus }) {
  return (
    <li className="qitu-tutor-team-item">
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <TeamStatusBadge status={status} />
    </li>
  );
}
