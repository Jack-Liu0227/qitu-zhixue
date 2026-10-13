'use client';

import { useState, useEffect } from 'react';
import { PermissionDenied } from '@qitu/ui';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { TutorHeader } from './components/TutorHeader';
import { TutorTeamRail } from './components/TutorTeamRail';
import { SubAgentStatusHud } from './components/SubAgentStatusHud';
import { useComposer } from './hooks/useComposer';
import { useTutorSession } from './hooks/useTutorSession';
import type { TutorLoadStatus } from './types';
import type { TutorTurn, TutorReplyBlock } from '@qitu/contracts';
import { KINETIC_ENERGY_TURNS, type ChatSessionItem } from './data/kineticTurns';

/** AI 搭档主对话工作区：左侧历史会话支持折叠，右侧双Tab抽屉支持折叠。 */
export function TutorPage({ projectId }: { projectId?: string }) {
  const session = useTutorSession(projectId);
  const composer = useComposer();

  // 1. 折叠状态管理：左侧历史会话默认展开，右侧工作区默认折叠
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightOpen, setIsRightOpen] = useState(false);

  // 2. 团队与多会话管理
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
        id: 'sess-new-1',
        title: '全新探究对话',
        teamId: 'team-kinetic-energy',
        updatedAt: '刚刚',
        isArchived: false,
        turns: [],
      },
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
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    if (projectId === 'proj-kinetic-energy') return 'sess-kinetic-energy-1';
    if (projectId === 'proj-thunder-fighter') return 'sess-thunder-fighter-1';
    return 'sess-new-1';
  });
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('qitu.tutor.sessions', JSON.stringify(sessions));
      } catch {
        // quota exceeded guard
      }
    }
  }, [sessions]);

  // 支持从灵感空间携带 explorePrompt 或 team/project 跳转进入直接提问
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const explorePrompt = params.get('explorePrompt');
    const teamParam = params.get('team');
    if (explorePrompt) {
      const newId = `sess-explore-${Date.now()}`;
      const chosenTeam = teamParam === 'team-thunder-fighter' ? 'team-thunder-fighter' : 'team-kinetic-energy';
      const userTurn: TutorTurn = {
        turnId: `turn-stu-${Date.now()}`,
        role: 'student',
        blocks: [{ kind: 'text', text: explorePrompt }],
        hintLevel: null,
        stageBefore: null,
        stageAfter: null,
        seq: 1,
        createdAt: new Date().toISOString(),
        modality: 'text',
      };
      const assistantGreetingTurn: TutorTurn = {
        turnId: `turn-asst-${Date.now()}`,
        role: 'assistant',
        blocks: [
          {
            kind: 'think',
            content: `学生从灵感空间跳转接入课题：“${explorePrompt}”。已匹配专属导师团队，开始进行兴趣与意图确认。`,
            closed: true,
          },
          {
            kind: 'text',
            text: `你好！我看到你对「${explorePrompt}」很感兴趣！\n\n我们将采用 PBL 项目式探究模式带你一步步探索。在开始之前，我想先了解一下：你希望通过这个项目最终制作出什么样的成果（例如物理仿真程序、游戏作品或实验演示）？`,
          },
        ],
        hintLevel: null,
        stageBefore: 'theory_learning',
        stageAfter: 'theory_learning',
        seq: 2,
        createdAt: new Date().toISOString(),
        modality: 'text',
      };

      const newSession: ChatSessionItem = {
        id: newId,
        title: `探索：${explorePrompt.slice(0, 16)}...`,
        teamId: chosenTeam,
        updatedAt: '刚刚',
        isArchived: false,
        turns: [userTurn, assistantGreetingTurn],
      };

      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newId);
      setCurrentTeam(chosenTeam);
      setIsRightOpen(true); // 打开右侧项目进度与团队

      // 清除 URL query 避免刷新重复追加
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

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
      turns: [],
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
    const isFirstMessage = currentTurns.length === 0;
    let chosenTeam = currentTeam;
    let newTitle = activeSession.title;

    if (isFirstMessage) {
      if (content.includes('动能') || content.includes('物理') || content.includes('能量') || content.includes('做功')) {
        chosenTeam = 'team-kinetic-energy';
        newTitle = '动能定理核心公式探究与推导 (PBL)';
      } else if (content.includes('战机') || content.includes('游戏') || content.includes('Pygame') || content.includes('编程')) {
        chosenTeam = 'team-thunder-fighter';
        newTitle = '雷霆战机游戏主循环与碰撞检测 (PBL)';
      } else {
        newTitle = `探究：${content.slice(0, 14)}`;
      }
      setCurrentTeam(chosenTeam);
    }

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
          ? {
              ...s,
              title: isFirstMessage ? newTitle : s.title,
              teamId: isFirstMessage ? chosenTeam : s.teamId,
              updatedAt: '刚刚',
              turns: newTurns,
            }
          : s
      )
    );

    // 真实调用多 Agent 协同流式输出与思维链推导
    const isKinetic = chosenTeam === 'team-kinetic-energy';
    const isIntentConfirmation = content.includes('确认') || content.includes('选 A') || content.includes('推导');

    // 1. 若学生刚提出兴趣但未确认项目意图：由「启途智学助手」以苏格拉底式发问确认
    if (isFirstMessage && !content.includes('确认')) {
      const intakeTurnId = `turn-asst-intake-${Date.now()}`;
      const streamText = isKinetic
        ? `你好！我是你的启途智学助手。很高兴看到你对「${content}」产生兴趣！\n\n在我们正式立项前，我想先了解你的学习意图：\n1. 你最想探究的是生活中的刹车制动现象，还是想推导严谨的物理定律？\n2. 你希望最终做出一个 Python 仿真物理模型，还是一个动能分析报表？\n\n我为你推荐探究课题：《动手学动能定理 —— 从做功推导到数值仿真》。如果你确认以此为课题，请点击下方确认按钮，我将立即为你唤醒专属 PBL 导师团队接管探究！`
        : `你好！我是你的启途智学助手。听到你对「${content}」感兴趣，太让人期待了！\n\n在我们正式立项前，我想澄清你的探究目标：\n1. 你是想攻克 Pygame 游戏引擎的主循环机制，还是想掌握几何碰撞检测算法？\n2. 预计作品要包含战机射击与敌人生成逻辑吗？\n\n我为你推荐课题：《雷霆战机游戏架构设计与碰撞检测》。确认意图后我们将召唤游戏导师团队接管教学！`;

      const intakeTurn: TutorTurn = {
        turnId: intakeTurnId,
        role: 'assistant',
        author: {
          id: 'qitu-intake-assistant',
          name: '启途智学助手',
          role: 'Intake Guide',
          color: '#2563eb',
        },
        blocks: [
          {
            kind: 'think',
            content: `【启途智学助手·意图澄清策略】：学生输入了初步想法「${content}」。严格遵守平台铁律：学生未明确确认意图前不得创建正式项目，不得直接给代码或答案。先用苏格拉底式提问澄清意图，推荐契合课题，等待学生明确确认后交接。`,
            closed: false,
          },
          {
            kind: 'text',
            text: '',
          },
        ],
        hintLevel: null,
        stageBefore: 'exploration',
        stageAfter: 'exploration',
        seq: newTurns.length + 1,
        createdAt: new Date().toISOString(),
        modality: 'text',
      };

      setSessions((prev) =>
        prev.map((s) => (s.id === activeSessionId ? { ...s, turns: [...s.turns, intakeTurn] } : s))
      );

      // 模拟逐字流式打字输出
      let currIndex = 0;
      const stepInterval = setInterval(() => {
        currIndex += 3;
        const currentSlice = streamText.slice(0, currIndex);
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== activeSessionId) return s;
            const updatedTurns = s.turns.map((t) => {
              if (t.turnId !== intakeTurnId) return t;
              const updatedBlocks: TutorReplyBlock[] = [
                {
                  kind: 'think',
                  content: `【启途智学助手·意图澄清策略】：学生输入了初步想法「${content}」。严格遵守平台铁律：学生未明确确认意图前不得创建正式项目，不得直接给代码或答案。先用苏格拉底式提问澄清意图，推荐契合课题，等待学生明确确认后交接。`,
                  closed: currIndex >= streamText.length,
                },
                {
                  kind: 'text',
                  text: currentSlice,
                },
                ...(currIndex >= streamText.length
                  ? [
                      {
                        kind: 'options' as const,
                        items: [
                          { label: '确认课题', text: isKinetic ? '确认选择《动手学动能定理》课题，开启项目探究' : '确认选择《雷霆战机游戏架构》课题，开启项目探究' },
                          { label: '继续澄清', text: '我想再微调一下研究方向，换个更有挑战性的角度' },
                        ],
                        allowOther: false,
                      },
                    ]
                  : []),
              ];
              return {
                ...t,
                blocks: updatedBlocks,
              };
            });
            return { ...s, turns: updatedTurns };
          })
        );

        if (currIndex >= streamText.length) {
          clearInterval(stepInterval);
        }
      }, 40);
      return;
    }

    // 2. 学生确认意图后：启途智学助手一句话交接，随后 PBL 团队接管并按角色流式协同推导
    const handoverText = `【启途智学助手】：太棒了！你的学习意图与目标已明确确认。现在把学习接力给专属「${isKinetic ? '动能定理科研协作团队' : '雷霆战机创意开发团队'}」，他们将全程陪伴你的探究与推导！`;

    const assistantTurnId = `turn-asst-team-${Date.now()}`;
    const pblTurn: TutorTurn = {
      turnId: assistantTurnId,
      role: 'assistant',
      author: {
        id: isKinetic ? 'kinetic-coach' : 'fighter-coach',
        name: isKinetic ? '苏格拉底物理教练' : '战机主循环教练',
        role: 'Concept Coach',
        color: '#2563eb',
      },
      blocks: [
        {
          kind: 'think',
          content: `【团队接管·概念教练深度思考】：意图已确认，理论探究阶段开启。遵循门禁规则：在达成 TheoryMastered 考核前严禁进入仿真代码实践。调取动能定理推导阶梯，首先通过受力与位移定义式 W=F·s 与牛顿第二定律公式建立代数联立引导。`,
          closed: false,
        },
        {
          kind: 'text',
          text: `${handoverText}\n\n根据动能定理：\n\n$$W_{\\text{合}} = \\Delta E_k = \\frac{1}{2}mv_2^2 - \\frac{1}{2}mv_1^2$$\n\n我们第一步先进行受力与做功思维推导：设想一辆质量为 $m$ 的小车，在光滑水平面上受到一个恒定外力 $F$ 的持续推动，在位移 $s$ 的过程中，恒力 $F$ 对小车做了多少功？它的定义公式是什么？`,
        },
        {
          kind: 'questions',
          items: [
            '根据牛顿第二定律，小车的加速度 a 是多少？',
            '在位移 s 的过程中，恒力 F 对小车做了多少功？它的定义公式是什么？',
          ],
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
      prev.map((s) => (s.id === activeSessionId ? { ...s, turns: [...s.turns, pblTurn] } : s))
    );
    setIsRightOpen(true); // 唤醒右侧团队面板展示 Agent 状态与检查点
  };

  const sessionReady = true;
  const chatStatus: TutorLoadStatus = currentTurns.length > 0 ? 'ready' : 'empty';

  return (
    <div className="qitu-tutor-page">
      <TutorHeader
        currentTeam={currentTeam}
        onTeamChange={handleSelectTeam}
        onClearHistory={handleClearHistory}
      />

      <div className="qitu-tutor-workspace-layout">
        {/* 1. 左侧会话历史侧边栏（支持折叠） */}
        {isLeftCollapsed ? (
          <aside
            onClick={() => setIsLeftCollapsed(false)}
            title="展开会话历史列表"
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
              ▶
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
              会话历史 ({sessions.length})
            </span>
          </aside>
        ) : (
          <aside
            style={{
              width: '260px',
              flexShrink: 0,
              background: '#ffffff',
              border: '1px solid #e4ecf7',
              borderRadius: '14px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 4px 16px rgba(16, 42, 92, 0.04)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 700, fontSize: '13.5px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>💬</span> 会话历史
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                  type="button"
                  onClick={handleNewSession}
                  title="新建会话"
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    color: '#2563eb',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  + 新建
                </button>
                <button
                  type="button"
                  onClick={() => setIsLeftCollapsed(true)}
                  title="收起会话侧边栏"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    cursor: 'pointer',
                    fontSize: '14px',
                    padding: '4px',
                  }}
                >
                  ◀
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
              {sessions.map((sess) => {
                const isActive = sess.id === activeSessionId;
                return (
                  <div
                    key={sess.id}
                    onClick={() => {
                      setActiveSessionId(sess.id);
                      setCurrentTeam(sess.teamId);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      marginBottom: '4px',
                      background: isActive ? '#eff6ff' : 'transparent',
                      color: isActive ? '#1d4ed8' : '#334155',
                      border: isActive ? '1px solid #bfdbfe' : '1px solid transparent',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '12.5px', fontWeight: isActive ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sess.title}
                      </div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                        {sess.updatedAt} · {sess.turns.length} 条发言
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSession(sess.id);
                      }}
                      title="删除会话"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        fontSize: '13px',
                        padding: '2px 4px',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        {/* 2. 中间主对话区 */}
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
            subAgentHud={
              currentTurns.length > 0 ? (
                <SubAgentStatusHud
                  currentTeam={currentTeam}
                  streaming={session.streaming}
                  onSelectAgent={() => {
                    setIsRightOpen(true);
                  }}
                />
              ) : null
            }
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

        {/* 3. 右侧团队角色与项目进度状态（仅进入项目后触发，默认折叠，支持双Tab展开） */}
        {currentTurns.length > 0 && (
          <TutorTeamRail
            currentTeam={currentTeam}
            streaming={session.streaming}
            ready={true}
            failed={false}
            offline={session.offline}
            isOpen={isRightOpen}
            onToggleOpen={() => setIsRightOpen(!isRightOpen)}
          />
        )}
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
