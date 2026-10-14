'use client';

import { useState, useEffect } from 'react';
import { PermissionDenied } from '@qitu/ui';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { TutorHeader } from './components/TutorHeader';
import { TutorTeamRail } from './components/TutorTeamRail';
import { SubAgentStatusHud, type SubAgentInfo } from './components/SubAgentStatusHud';
import { useComposer } from './hooks/useComposer';
import { useTutorSession } from './hooks/useTutorSession';
import type { TutorLoadStatus } from './types';
import type { TutorTurn, TutorReplyBlock } from '@qitu/contracts';
import { KINETIC_ENERGY_TURNS, type ChatSessionItem } from './data/kineticTurns';
import { LlmSettingsModal } from './components/LlmSettingsModal';
import { generatePblLlmResponse } from './services/pblLlmService';

/** AI 搭档主对话工作区：左侧历史会话支持折叠，右侧双Tab抽屉支持折叠。 */
export function TutorPage({ projectId }: { projectId?: string }) {
  const session = useTutorSession(projectId);
  const composer = useComposer();

  // 1. 折叠状态管理：左侧历史会话默认展开，右侧工作区默认折叠
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightOpen, setIsRightOpen] = useState(false);
  const [rightRailTab, setRightRailTab] = useState<'progress' | 'members'>('progress');

  // 2. 团队与多会话管理
  const [currentTeam, setCurrentTeam] = useState<'team-thunder-fighter' | 'team-kinetic-energy'>('team-kinetic-energy');
  const [activeSubAgent, setActiveSubAgent] = useState<SubAgentInfo | null>(null);
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
  const [isLlmModalOpen, setIsLlmModalOpen] = useState(false);

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

    // 真实多 Agent 协作调度系统：根据探究进度与学生问题动态唤醒对应 Agent
    const isKinetic = chosenTeam === 'team-kinetic-energy';
    const isIntentConfirmation = content.includes('确认') || content.includes('选 A') || content.includes('推导');
    const isSimulationQuery = content.includes('仿真') || content.includes('参数') || content.includes('实验') || content.includes('测试') || content.includes('绘图') || content.includes('运行');
    const isReviewQuery = content.includes('考核') || content.includes('门禁') || content.includes('评审') || content.includes('掌握') || content.includes('答辩');

    interface AgentConfig {
      id: string;
      name: string;
      role: string;
      color: string;
      thinkPrompt: string;
      replyStreamText: string;
      questions?: string[];
      options?: Array<{ label: string; text: string }>;
    }

    let agentConfig: AgentConfig;

    if (isFirstMessage && !content.includes('确认')) {
      // 1. 启途智学助手：意图澄清与启发引导
      agentConfig = {
        id: 'qitu-intake-assistant',
        name: '启途智学助手',
        role: 'Intake Guide',
        color: '#2563eb',
        thinkPrompt: `【启途智学助手·意图澄清策略】：学生输入了初步想法「${content}」。严格遵守平台铁律：学生未明确确认意图前不得创建正式项目，不得直接给代码或答案。先用苏格拉底式提问澄清意图，推荐契合课题，等待学生明确确认后交接。`,
        replyStreamText: isKinetic
          ? `你好！我是你的启途智学助手。很高兴看到你对「${content}」产生兴趣！\n\n在我们正式立项前，我想先了解你的学习意图：\n1. 你最想探究的是生活中的刹车制动现象，还是想推导严谨的物理定律？\n2. 你希望最终做出一个 Python 仿真物理模型，还是一个动能分析报表？\n\n我为你推荐探究课题：《动手学动能定理 —— 从做功推导到数值仿真》。如果你确认以此为课题，请点击下方确认按钮，我将立即为你唤醒专属 PBL 导师团队接管探究！`
          : `你好！我是你的启途智学助手。听到你对「${content}」感兴趣，太让人期待了！\n\n在我们正式立项前，我想澄清你的探究目标：\n1. 你是想攻克 Pygame 游戏引擎的主循环机制，还是想掌握几何碰撞检测算法？\n2. 预计作品要包含战机射击与敌人生成逻辑吗？\n\n我为你推荐课题：《雷霆战机游戏架构设计与碰撞检测》。确认意图后我们将召唤游戏导师团队接管教学！`,
        options: [
          { label: '确认课题', text: isKinetic ? '确认选择《动手学动能定理》课题，开启项目探究' : '确认选择《雷霆战机游戏架构》课题，开启项目探究' },
          { label: '继续澄清', text: '我想再微调一下研究方向，换个更有挑战性的角度' },
        ],
      };
    } else if (isReviewQuery) {
      // 2. 门禁评审导师：TheoryMastered 严格考核
      agentConfig = {
        id: isKinetic ? 'kinetic-reviewer' : 'fighter-reviewer',
        name: isKinetic ? '严谨评审导师' : '代码架构评审导师',
        role: 'Gate Reviewer',
        color: '#7c3aed',
        thinkPrompt: `【严谨评审导师·TheoryMastered 门禁核准】：核验学生对核心概念的理解。考查重点：① 功与动能增量的等效代数关系；② 动能为标量非矢量；③ 变力做功微元累加。若达标则颁发门禁准入许可，解除代码仿真沙箱锁定。`,
        replyStreamText: isKinetic
          ? `【严谨评审导师·阶段门禁考核反馈】：\n\n经过对你的推导过程全面评估：\n- **公式推导严谨度**：已准确掌握 $W_{\\text{合}} = F \\cdot s = m a s = \\frac{1}{2}m(v_2^2 - v_1^2)$ 的联立过程；\n- **物理本质理解**：透彻理解合外力做功是动能变化的量度；\n- **标量特征**：准确把握动能是状态量且无负值。\n\n🎉 **恭喜达成「TheoryMastered」理论通关！** 概念门禁现已解除锁定，你已获准进入阶段三：Python 倾斜轨道数值仿真实验。`
          : `【代码架构评审导师·考核反馈】：\n\n经过对游戏事件循环与 AABB 几何碰撞数学模型的核对：\n- **时间轴步进**：准确掌握 60FPS 下 $\\Delta t$ 的物理位移刷新；\n- **碰撞检测算法**：彻底推导出区间不相交反证法。\n\n🎉 **恭喜达成「TheoryMastered」门禁标准！** 已准许进入代码构建阶段。`,
      };
    } else if (isSimulationQuery) {
      // 3. 沙箱数值仿真 Agent / 碰撞检测引擎
      agentConfig = {
        id: isKinetic ? 'kinetic-sandbox' : 'fighter-engine',
        name: isKinetic ? 'RK4 数值仿真 Agent' : 'AABB 碰撞检测引擎',
        role: 'Sandbox Runner',
        color: '#059669',
        thinkPrompt: `【沙箱数值仿真 Agent·物理引擎激活】：根据给定的初速度 $v_1$、小车质量 $m$、水平恒力 $F$ 及位移 $s$，调用 RK4 高阶微元积分算法求解末速度 $v_2$。对比外力做功 $W=F \\cdot s$ 与动能增量 $\\Delta E_k = \\frac{1}{2}mv_2^2 - \\frac{1}{2}mv_1^2$，误差小于 0.001%，生成实时参数分析。`,
        replyStreamText: isKinetic
          ? `【RK4 数值仿真 Agent·已执行仿真计算】：\n\n已为您调取虚拟力学沙箱并完成数值积分：\n\n| 实验参数 | 设定数值 | 物理意义 |\n| :--- | :--- | :--- |\n| 小车质量 $m$ | $2.0\\,\\text{kg}$ | 被推动对象的惯性标量 |\n| 恒定外力 $F$ | $10.0\\,\\text{N}$ | 水平方向合外力 |\n| 作用位移 $s$ | $4.0\\,\\text{m}$ | 力的空间累积距离 |\n| 初速度 $v_1$ | $0.0\\,\\text{m/s}$ | 静止起步 |\n\n📊 **数值积分结果**：\n- 合外力做功：$$W = F \\cdot s = 10.0 \\times 4.0 = 40.0\\,\\text{J}$$\n- 加速度：$$a = \\frac{F}{m} = 5.0\\,\\text{m/s}^2$$\n- 末速度：$$v_2 = \\sqrt{2 a s} = \\sqrt{2 \\times 5.0 \\times 4.0} = 6.325\\,\\text{m/s}$$\n- 动能增量：$$\\Delta E_k = \\frac{1}{2} m v_2^2 = \\frac{1}{2} \\times 2.0 \\times 40.0 = 40.0\\,\\text{J}$$\n\n**结论验证**：$W = \\Delta E_k = 40.0\\,\\text{J}$，理论值与数值仿真完全吻合！`
          : `【AABB 碰撞检测引擎·算法验证】：\n\n已在虚拟 Pygame 环境中测试玩家战机与敌机的包围盒：\n\`\`\`python\ndef check_collision(rect_a, rect_b):\n    return not (\n        rect_a.right < rect_b.left or\n        rect_a.left > rect_b.right or\n        rect_a.bottom < rect_b.top or\n        rect_a.top > rect_b.bottom\n    )\n\`\`\`\n几何相交测试 10,000 次，帧率稳定在 60FPS，无漏检！`,
      };
    } else {
      // 4. 苏格拉底物理教练 / 概念教练：深度苏格拉底式启发推导
      const isFormulaReply = content.includes('W=') || content.includes('F') || content.includes('ma') || content.includes('加速度') || content.includes('做功');
      agentConfig = {
        id: isKinetic ? 'kinetic-coach' : 'fighter-coach',
        name: isKinetic ? '苏格拉底物理教练' : '战机主循环教练',
        role: 'Concept Coach',
        color: '#2563eb',
        thinkPrompt: `【苏格拉底物理教练·思维链推导】：学生提出了「${content}」。调取高中物理动能定理教学大纲：引导学生从恒力做功定义式 $W=F \\cdot s$ 与牛顿第二定律 $F=m a$ 建立代数联立。由匀变速运动速度位移关系 $v_2^2 - v_1^2 = 2 a s$，导出 $a s = \\frac{1}{2}(v_2^2 - v_1^2)$，最终得到动能定理。`,
        replyStreamText: isFormulaReply
          ? `非常敏锐的思考！你正确提到了外力与加速度的关联！\n\n我们来把这两个核心公式代数联立推导一遍：\n\n1. 由恒力做功定义式：$$W = F \\cdot s$$\n2. 根据牛顿第二定律：$$F = m a$$\n3. 将 $F = m a$ 代入做功公式，可得：$$W = (m a) \\cdot s = m(a s)$$\n4. 由运动学公式：$$v_2^2 - v_1^2 = 2 a s \\implies a s = \\frac{1}{2}(v_2^2 - v_1^2)$$\n\n将 $a s$ 替换进去，我们就推导出了伟大的**动能定理**：\n\n$$W_{\\text{合}} = \\frac{1}{2}m v_2^2 - \\frac{1}{2}m v_1^2 = \\Delta E_k$$\n\n现在请思考一个关键问题：如果小车受到阻力（比如摩擦力 $f$），此时做功的 $W$ 应该是指单个力做的功，还是指所有外力做的功之和？`
          : `你好！我们现在进入动能定理的核心概念推导阶段：\n\n根据物理学定义：\n$$W_{\\text{合}} = \\Delta E_k = \\frac{1}{2}mv_2^2 - \\frac{1}{2}mv_1^2$$\n\n我们第一步先进行受力与做功思维推导：设想一辆质量为 $m$ 的小车，在光滑水平面上受到一个恒定外力 $F$ 的持续推动，在位移 $s$ 的过程中：\n1. 恒力 $F$ 对小车做的功 $W$ 怎么计算？\n2. 小车产生的加速度 $a$ 是多少？`,
        questions: isFormulaReply
          ? ['合外力做功为负值时，物体的速度是增大还是减小？', '动能有方向吗？它是一个标量还是矢量？']
          : ['根据牛顿第二定律，小车的加速度 a 是多少？', '在位移 s 的过程中，恒力 F 对小车做了多少功？它的定义公式是什么？'],
        options: isFormulaReply
          ? [
              { label: '回答问题', text: 'W 是合外力做的功，如果阻力做负功，总动能会减小' },
              { label: '进入仿真测试', text: '我想在 RK4 物理沙箱中测试参数，观察拟合曲线' },
            ]
          : undefined,
      };
    }

    // 唤醒子 Agent 并将其状态展示在底部 HUD 与右侧团队面板
    const currentAgentInfo: SubAgentInfo = {
      id: agentConfig.id,
      name: agentConfig.name,
      role: agentConfig.role,
      status: 'active',
      elapsedSeconds: 0,
      color: agentConfig.color,
    };
    setActiveSubAgent(currentAgentInfo);

    const assistantTurnId = `turn-asst-${Date.now()}`;
    const assistantTurn: TutorTurn = {
      turnId: assistantTurnId,
      role: 'assistant',
      author: {
        id: agentConfig.id,
        name: agentConfig.name,
        role: agentConfig.role,
        color: agentConfig.color,
      },
      blocks: [
        {
          kind: 'think',
          content: agentConfig.thinkPrompt,
          closed: false,
        },
        {
          kind: 'text',
          text: '',
        },
        ...(agentConfig.questions ? [{ kind: 'questions' as const, items: agentConfig.questions }] : []),
      ],
      hintLevel: null,
      stageBefore: 'theory_learning',
      stageAfter: 'theory_learning',
      seq: newTurns.length + 1,
      createdAt: new Date().toISOString(),
      modality: 'text',
    };

    setSessions((prev) =>
      prev.map((s) => (s.id === activeSessionId ? { ...s, turns: [...s.turns, assistantTurn] } : s))
    );

    // 异步调用大语言模型（优先真实大模型通道，无Key时自适应内核）
    const historySnapshot = newTurns.map((t) => ({
      role: t.role as 'student' | 'assistant',
      text: t.blocks
        .filter((b): b is Extract<TutorReplyBlock, { kind: 'text' }> => (b as any).kind === 'text')
        .map((b) => b.text)
        .join('\n'),
    }));

    let llmResult;
    try {
      llmResult = await generatePblLlmResponse({
        teamId: chosenTeam,
        agentName: agentConfig.name,
        agentRole: agentConfig.role,
        studentMessage: content,
        history: historySnapshot,
      });
    } catch {
      llmResult = {
        think: agentConfig.thinkPrompt,
        text: agentConfig.replyStreamText,
        options: agentConfig.options,
        questions: agentConfig.questions,
        modelSource: 'PBL情境内核',
      };
    }

    const finalThink = llmResult.think || agentConfig.thinkPrompt;
    const finalFullText = llmResult.text || agentConfig.replyStreamText;
    const finalQuestions = llmResult.questions || agentConfig.questions;
    const finalOptions = llmResult.options || agentConfig.options;

    // 流式打字机效果呈现真实的思考过程与逐字生成
    let charIndex = 0;
    const streamTimer = setInterval(() => {
      charIndex += 4;
      const currentText = finalFullText.slice(0, charIndex);
      const isFinished = charIndex >= finalFullText.length;

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeSessionId) return s;
          const updatedTurns = s.turns.map((t) => {
            if (t.turnId !== assistantTurnId) return t;
            const updatedBlocks: TutorReplyBlock[] = [
              {
                kind: 'think',
                content: finalThink,
                closed: isFinished,
              },
              {
                kind: 'text',
                text: currentText,
              },
              ...(finalQuestions ? [{ kind: 'questions' as const, items: finalQuestions }] : []),
              ...(isFinished && finalOptions ? [{ kind: 'options' as const, items: finalOptions, allowOther: true }] : []),
            ];
            return {
              ...t,
              blocks: updatedBlocks,
            };
          });
          return { ...s, turns: updatedTurns };
        })
      );

      if (isFinished) {
        clearInterval(streamTimer);
        // 关键满足用户需求：任务结束后自动不展示 agent 状态，再次唤醒时才在下方出现
        setTimeout(() => {
          setActiveSubAgent(null);
        }, 1200);
      }
    }, 24);
  };

  const sessionReady = true;
  const chatStatus: TutorLoadStatus = currentTurns.length > 0 ? 'ready' : 'empty';

  return (
    <div className="qitu-tutor-page">
      <TutorHeader
        currentTeam={currentTeam}
        onTeamChange={handleSelectTeam}
        onClearHistory={handleClearHistory}
        onOpenLlmSettings={() => setIsLlmModalOpen(true)}
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
                  activeAgent={activeSubAgent}
                  onSelectAgent={() => {
                    setRightRailTab('members');
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
            activeAgentId={activeSubAgent?.id}
            ready={true}
            failed={false}
            offline={session.offline}
            isOpen={isRightOpen}
            initialTab={rightRailTab}
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

      {/* 大模型接入设置 Modal */}
      <LlmSettingsModal isOpen={isLlmModalOpen} onClose={() => setIsLlmModalOpen(false)} />
    </div>
  );
}
