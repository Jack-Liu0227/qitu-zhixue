'use client';

import { useState, useEffect } from 'react';
import { PermissionDenied } from '@qitu/ui';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { TutorHeader } from './components/TutorHeader';
import { TutorTeamRail } from './components/TutorTeamRail';
import { useComposer } from './hooks/useComposer';
import { useTutorSession } from './hooks/useTutorSession';
import type { TutorLoadStatus } from './types';
import type { TutorTurn } from '@qitu/contracts';
import { KINETIC_ENERGY_TURNS, type ChatSessionItem } from './data/kineticTurns';

/** AI 搭档主对话工作区：支持多会话、归档/删除、清除历史，以及动手学动能定理导师团队探究演示。 */
export function TutorPage({ projectId }: { projectId?: string }) {
  const session = useTutorSession(projectId);
  const composer = useComposer();

  // 1. 会话状态与团队状态管理（基于客户端持久化存储与 agent-memory 策略）
  const [currentTeam, setCurrentTeam] = useState<'team-thunder-fighter' | 'team-kinetic-energy'>('team-kinetic-energy');
  const [sessions, setSessions] = useState<ChatSessionItem[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('qitu.tutor.sessions');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {
        // fallback
      }
    }
    return [
      {
        id: 'sess-kinetic-energy-1',
        title: '动能定理核心公式探究与推导 (PBL)',
        teamId: 'team-kinetic-energy',
        updatedAt: '刚刚',
        isArchived: false,
        turns: KINETIC_ENERGY_TURNS,
      },
      {
        id: 'sess-thunder-fighter-1',
        title: '雷霆战机游戏主循环与碰撞检测 (PBL)',
        teamId: 'team-thunder-fighter',
        updatedAt: '昨天',
        isArchived: false,
        turns: session.turns,
      },
    ];
  });
  const [activeSessionId, setActiveSessionId] = useState<string>('sess-kinetic-energy-1');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 监听持久化同步
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('qitu.tutor.sessions', JSON.stringify(sessions));
      } catch {
        // quota exceeded guard
      }
    }
  }, [sessions]);

  if (session.permissionDenied) {
    return (
      <div className="qitu-tutor-page">
        <PermissionDenied title="无法进入 AI搭档" description="你没有访问这个会话的权限，请返回上一页。" />
      </div>
    );
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0]!;
  const currentTurns: TutorTurn[] = activeSession.turns;

  const handleSelectTeam = (team: 'team-thunder-fighter' | 'team-kinetic-energy') => {
    setCurrentTeam(team);
    // 自动寻找或创建对应团队的会话
    const found = sessions.find((s) => s.teamId === team && !s.isArchived);
    if (found) {
      setActiveSessionId(found.id);
    } else {
      const newId = `sess-${Date.now()}`;
      const newSess: ChatSessionItem = {
        id: newId,
        title: team === 'team-kinetic-energy' ? '动手学动能定理新会话' : '雷霆战机新会话',
        teamId: team,
        updatedAt: '刚刚',
        isArchived: false,
        turns: team === 'team-kinetic-energy' ? KINETIC_ENERGY_TURNS : session.turns,
      };
      setSessions([newSess, ...sessions]);
      setActiveSessionId(newId);
    }
  };

  const handleNewSession = () => {
    const newId = `sess-${Date.now()}`;
    const newSess: ChatSessionItem = {
      id: newId,
      title: `${currentTeam === 'team-kinetic-energy' ? '动能定理' : '雷霆战机'}探究 ${sessions.length + 1}`,
      teamId: currentTeam,
      updatedAt: '刚刚',
      isArchived: false,
      turns: currentTeam === 'team-kinetic-energy' ? KINETIC_ENERGY_TURNS.slice(0, 1) : session.turns.slice(0, 1),
    };
    setSessions([newSess, ...sessions]);
    setActiveSessionId(newId);
  };

  const handleClearHistory = () => {
    if (!confirm('确定清空当前对话历史吗？')) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? { ...s, turns: [] }
          : s
      )
    );
  };

  const handleToggleArchive = (id: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isArchived: !s.isArchived } : s))
    );
  };

  const handleDeleteSession = (id: string) => {
    if (sessions.length <= 1) {
      alert('请至少保留一个会话');
      return;
    }
    const nextList = sessions.filter((s) => s.id !== id);
    setSessions(nextList);
    if (activeSessionId === id) {
      setActiveSessionId(nextList[0]?.id ?? '');
    }
  };

  const handleSubmitMessage = async (content: string) => {
    if (!content.trim()) return;
    const studentTurn: TutorTurn = {
      turnId: `turn-stu-${Date.now()}`,
      role: 'student',
      blocks: [{ kind: 'text', text: content }],
      hintLevel: null,
      stageBefore: null,
      stageAfter: null,
      seq: currentTurns.length + 1,
      createdAt: new Date().toISOString(),
      modality: 'text',
    };

    const newTurns = [...currentTurns, studentTurn];
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? { ...s, updatedAt: '刚刚', turns: newTurns }
          : s
      )
    );

    // 模拟导师苏格拉底产婆术反馈
    setTimeout(() => {
      const isKinetic = activeSession.teamId === 'team-kinetic-energy';
      const assistantTurn: TutorTurn = {
        turnId: `turn-asst-${Date.now()}`,
        role: 'assistant',
        blocks: [
          {
            kind: 'think',
            content: `导师正在基于自主研发 Agent SDK 评估学生观点：“${content}”。根据苏格拉底提问策略引导下一层深思。`,
            closed: true,
          },
          {
            kind: 'text',
            text: isKinetic
              ? `你提出了一个非常值得深究的观察：“${content}”。根据动能定理 $W = \\Delta E_k$，当合外力做正功时物体的动能必然增加，反之则减少。你可以试着思考：在阻力存在时，做功是正功还是负功？机械能还会守恒吗？`
              : `收到你的战机编程设计思路：“${content}”。在处理 Pygame 事件循环时，保证每一帧的状态更新与绘制分离是非常关键的架构习惯。`,
          },
        ],
        hintLevel: null,
        stageBefore: 'theory_learning',
        stageAfter: 'theory_learning',
        seq: newTurns.length + 1,
        createdAt: new Date().toISOString(),
        modality: 'text',
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? { ...s, turns: [...s.turns, assistantTurn] }
            : s
        )
      );
    }, 600);
  };

  const sessionReady = true;
  const chatStatus: TutorLoadStatus = currentTurns.length > 0 ? 'ready' : 'empty';

  return (
    <div className="qitu-tutor-page">
      <TutorHeader
        currentTeam={currentTeam}
        onTeamChange={handleSelectTeam}
        onNewSession={handleNewSession}
        onClearHistory={handleClearHistory}
        onOpenSessionModal={() => setIsModalOpen(true)}
        sessionCount={sessions.length}
      />

      <div style={{ display: 'flex', gap: '20px', padding: '0 24px 28px', height: 'calc(100vh - 160px)' }}>
        {/* 中间主对话区 */}
        <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <ChatThread
            turns={currentTurns}
            status={chatStatus}
            error={null}
            streaming={session.streaming}
            offline={session.offline}
            escalated={session.escalated}
            disabled={!sessionReady}
            onRetry={session.retrySession}
            onReconnect={session.reconnect}
            onSelectOption={(label, text) => {
              void handleSubmitMessage(`${label}: ${text ?? ''}`);
            }}
            composer={(
              <Composer
                draft={composer.draft}
                onDraftChange={composer.setDraft}
                offline={session.offline}
                submitting={composer.submitting}
                disabled={!sessionReady}
                onSubmit={() => {
                  const draft = composer.draft;
                  composer.setDraft('');
                  void handleSubmitMessage(draft);
                }}
              />
            )}
          />
        </div>

        {/* 右侧团队角色状态 */}
        <TutorTeamRail
          currentTeam={currentTeam}
          streaming={session.streaming}
          ready={true}
          failed={false}
          offline={session.offline}
        />
      </div>

      {/* 会话列表浮层 Modal */}
      {isModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.4)',
            backdropFilter: 'blur(3px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setIsModalOpen(false)}
        >
          <div
            style={{
              width: '560px',
              maxHeight: '80vh',
              background: '#ffffff',
              borderRadius: '16px',
              padding: '24px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '17px', color: '#0f172a' }}>会话管理与历史存档</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sessions.map((sess) => {
                const isActive = sess.id === activeSessionId;
                return (
                  <div
                    key={sess.id}
                    onClick={() => {
                      setActiveSessionId(sess.id);
                      setCurrentTeam(sess.teamId);
                      setIsModalOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: isActive ? '1.5px solid #2563eb' : '1px solid #e2e8f0',
                      background: isActive ? '#eff6ff' : sess.isArchived ? '#f8fafc' : '#ffffff',
                      cursor: 'pointer',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>{sess.title}</span>
                        <span style={{ fontSize: '11px', background: sess.teamId === 'team-kinetic-energy' ? '#fef3c7' : '#e0e7ff', color: sess.teamId === 'team-kinetic-energy' ? '#d97706' : '#4338ca', padding: '1px 6px', borderRadius: '4px' }}>
                          {sess.teamId === 'team-kinetic-energy' ? '动能定理' : '雷霆战机'}
                        </span>
                        {sess.isArchived && (
                          <span style={{ fontSize: '10px', background: '#e2e8f0', color: '#64748b', padding: '1px 4px', borderRadius: '3px' }}>
                            已归档
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                        {sess.updatedAt} · {sess.turns.length} 条发言
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleToggleArchive(sess.id)}
                        style={{
                          padding: '4px 8px',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          background: '#ffffff',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                      >
                        {sess.isArchived ? '取消归档' : '归档'}
                      </button>
                      <button
                        onClick={() => handleDeleteSession(sess.id)}
                        style={{
                          padding: '4px 8px',
                          border: '1px solid #fca5a5',
                          borderRadius: '6px',
                          background: '#fff',
                          color: '#ef4444',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
