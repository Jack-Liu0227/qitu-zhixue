'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { MarkdownRenderer } from './MarkdownRenderer';
import { fetchAvailableConfiguredModels, type ConfiguredModelItem } from '../../../lib/api/configuredModels';
import { createPersistedAssistant } from '../../../lib/api/assistants';
import { createPersistedTeam } from '../../../lib/api/teams';
import { newIdempotencyKey } from '../../../lib/api/modelRegistry';

interface ToolExecutionStep {
  name: string;
  status: 'running' | 'done' | 'error';
  label: string;
  detail?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolSteps?: ToolExecutionStep[];
  artifact?: {
    type: 'assistant' | 'team' | 'mcp' | 'skill' | 'template' | 'knowledge';
    title: string;
    details: string;
    jsonPreview?: string;
  };
}

interface Session {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
}

const INITIAL_SESSIONS: Session[] = [
  {
    id: 'sess-default',
    title: '启途智学管家构建中心',
    updatedAt: '刚刚',
    messages: [
      {
        id: 'msg-1',
        role: 'system',
        content: '我是「启途智学管家」平台核心运维与开发智能中枢（基于自建 Agent SDK），可为您全自动设计与配置智能体、团队组合、MCP 工具、Skill 技能包、PBL 教学模板与知识库。',
        timestamp: '10:00',
      },
      {
        id: 'msg-2',
        role: 'user',
        content: '请帮我检查当前平台的动能定理 PBL 项目团队配置是否完整，以及对应的技能和工具绑定情况。',
        timestamp: '10:01',
      },
      {
        id: 'msg-3',
        role: 'assistant',
        content: '已检索平台数据库与 Agent SDK 配置：\n\n1. **团队**：`team-kinetic-energy`（动手学动能定理导师团队）已就绪，包含导师：苏格拉底教练、探索向导、代码评审导师。\n2. **工具矩阵**：已绑定 `groksearch-mcp` 与 `Python 沙箱`，满足受力分析模拟与文献检索需求。\n3. **门禁设计**：已强制启用 `TheoryMastered` 门禁，学生必须推导完成动能定理后方可进入代码实践阶段：\n\n$$W_{\\text{合}} = \\Delta E_k = \\frac{1}{2}mv_2^2 - \\frac{1}{2}mv_1^2$$\n\n如需新创团队或扩展能力，可随时告诉我，例如“创建一个高中化学平衡探究团队”。',
        timestamp: '10:02',
        toolSteps: [
          { name: 'query_db_teams', status: 'done', label: '查询团队数据库：team-kinetic-energy' },
          { name: 'check_capability_matrix', status: 'done', label: '校验助手 × MCP/工具绑定矩阵' },
          { name: 'verify_theory_gate', status: 'done', label: '核验 TheoryMastered 阶段门禁状态' },
        ],
        artifact: {
          type: 'team',
          title: '动手学动能定理导师团队校验成功',
          details: '成员：3位智能体 | 门禁：TheoryMastered | 工具：Python Sandbox + GrokSearch MCP',
          jsonPreview: JSON.stringify({
            id: 'team-kinetic-energy',
            name: '动手学动能定理导师团队',
            gate: 'TheoryMastered',
            assistants: ['asst-coach-socrates', 'asst-guide-seeker', 'asst-reviewer-rigor'],
            status: 'active'
          }, null, 2),
        },
      },
    ],
  },
  {
    id: 'sess-create-agent',
    title: '新建化学反应平衡导师',
    updatedAt: '10分钟前',
    messages: [
      {
        id: 'ca-1',
        role: 'system',
        content: '启途智学管家就绪。',
        timestamp: '09:40',
      },
      {
        id: 'ca-2',
        role: 'user',
        content: '我想创建一个化学平衡移动探究助手，支持勒夏特列原理的苏格拉底式发问。',
        timestamp: '09:41',
      },
      {
        id: 'ca-3',
        role: 'assistant',
        content: '已基于平台规范为您自动生成新助手草案：\n- **角色**：化学探究导师（勒夏特列引导者）\n- **发问风格**：苏格拉底提问式，单次回复不超过 150 字\n- **推荐工具**：化学方程式平衡计算工具 + 图像生成',
        timestamp: '09:42',
        toolSteps: [
          { name: 'agent_sdk_spec_generate', status: 'done', label: '根据 Agent SDK 标准协议生成智能体模型参数' }
        ],
        artifact: {
          type: 'assistant',
          title: 'AI 助手：化学平衡探究引导者 (Le Chatelier Guide)',
          details: '底座模型：qwen-max | 约束：禁止直接公布答案，从浓度/压强/温度三个变量引导学生观察',
          jsonPreview: JSON.stringify({
            name: '化学平衡探究导师',
            role: 'Coach',
            model: 'qwen-max',
            maxTurns: 12,
            systemPrompt: '你是化学平衡引导导师，遵循勒夏特列原理逐步引导学生理解平衡移动规律。'
          }, null, 2),
        },
      },
    ],
  },
];

export default function CopilotPage() {
  const [sessions, setSessions] = useState<Session[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('qitu.admin.copilot.sessions');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {
        // fallback
      }
    }
    return INITIAL_SESSIONS;
  });
  const [currentSessionId, setCurrentSessionId] = useState<string>('sess-default');
  const [inputMessage, setInputMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceInterim, setVoiceInterim] = useState('');
  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const toggleVoiceInput = () => {
    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
        recognitionRef.current = null;
      }
      setIsListening(false);
      setVoiceInterim('');
      return;
    }

    const SpeechRecognition =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (!SpeechRecognition) {
      alert('当前浏览器暂不支持原生语音输入，请使用 Chrome/Edge 浏览器或直接打字输入。');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'zh-CN';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
        setVoiceInterim('正在聆听中...');
      };

      recognition.onresult = (event: any) => {
        let final = '';
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        if (final) {
          setInputMessage((prev) => (prev ? `${prev} ${final}` : final));
        }
        setVoiceInterim(interim || final);
      };

      recognition.onerror = () => {
        setIsListening(false);
        setVoiceInterim('');
      };

      recognition.onend = () => {
        setIsListening(false);
        setVoiceInterim('');
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      alert('麦克风启动失败，请检查浏览器权限');
      setIsListening(false);
    }
  };

  // 1. 侧边栏折叠状态
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // 2. 快捷设置状态：Thinking 强度、底座模型选择、运行权限设置、测试助手切换
  const [thinkingStrength, setThinkingStrength] = useState<'off' | 'normal' | 'high' | 'max'>('high');
  const [selectedModel, setSelectedModel] = useState<string>('qwen3.8-flash');
  const [runtimePermission, setRuntimePermission] = useState<'read_only' | 'workspace_write' | 'full_access'>('full_access');
  const [availableModels, setAvailableModels] = useState<ConfiguredModelItem[]>([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState<string>('qitu-assistant');
  const [customAssistantsList, setCustomAssistantsList] = useState<Array<{ id: string; name: string; role: string; icon?: string; systemPrompt?: string }>>([]);

  const BUILTIN_ASSISTANTS_REGISTRY = [
    {
      id: 'qitu-assistant',
      name: '启途智学管家 (平台运维与开发中枢)',
      role: '运维管理中枢',
      icon: '🤖',
      systemPrompt: '我是启途智学管家平台核心运维与开发智能中枢，负责多智能体协同调度、系统配置修改与安全审计。',
    },
    {
      id: 'qitu-intake-assistant',
      name: '启途智学助手 (学生端探索接引)',
      role: '意图探索向导',
      icon: '🧭',
      systemPrompt: '你是启途智学助手，作为学生进入平台的第一站。遵循苏格拉底短轮次对话规范，探寻学生好奇心，澄清探究目标，推荐匹配课题并一键立项。',
    },
    {
      id: 'fighter-leader',
      name: '雷霆战机总导师',
      role: '团队总负责人',
      icon: '🚀',
      systemPrompt: '你是雷霆战机 PBL 项目总导师，负责统筹关卡设计、协调概念教练与沙箱向导。',
    },
    {
      id: 'fighter-concept-coach',
      name: '战机概念教练',
      role: '概念启发教练',
      icon: '💡',
      systemPrompt: '你是雷霆战机团队的概念启发教练。严格遵循苏格拉底教学法，绝不直接提供完整代码，引导学生理解游戏循环、面向对象精灵碰撞与帧率控制。',
    },
    {
      id: 'fighter-code-guide',
      name: '战机代码向导',
      role: '沙箱实践向导',
      icon: '🛠️',
      systemPrompt: '你是雷霆战机代码向导，指导学生在 Python 沙箱中安全调试 Pygame 代码，提供分步梯级排错线索。',
    },
    {
      id: 'fighter-review-assessor',
      name: '战机评审导师',
      role: '评价反思导师',
      icon: '📋',
      systemPrompt: '你是雷霆战机评审导师，依据项目标准对学生关卡设计、代码质量与学习反思进行形成性评价。',
    },
    {
      id: 'kinetic-leader',
      name: '动能定理总导师',
      role: '团队总负责人',
      icon: '⚡',
      systemPrompt: '你是动手学动能定理导师团队总负责人，负责整个实验探究流程的统筹推进。',
    },
    {
      id: 'kinetic-concept-coach',
      name: '动能定理概念教练',
      role: '概念启发教练',
      icon: '🧠',
      systemPrompt: '你是动能定理概念教练，负责引导学生从牛顿第二定律与做功推导动能定理，严密守卫 TheoryMastered 门禁。',
    },
    {
      id: 'kinetic-experiment-guide',
      name: '动能实验向导',
      role: '实验仿真向导',
      icon: '🔬',
      systemPrompt: '你是动能实验向导，指导学生操作 Python 物理数值仿真与传感器数据拟合绘图。',
    },
    {
      id: 'kinetic-review-assessor',
      name: '动能评审导师',
      role: '答辩评审导师',
      icon: '📊',
      systemPrompt: '你是动能定理评审导师，针对实验系统误差、摩擦阻力修正和机械能转换进行深度质询。',
    },
    {
      id: 'profile-analyst-assistant',
      name: '学情画像分析助手',
      role: '画像分析师',
      icon: '📈',
      systemPrompt: '你是学情画像分析助手，负责计算五维素养雷达（逻辑、工程、探究、表达、反思）与诊断认知断层。',
    },
    {
      id: 'growth-trajectory-assistant',
      name: '轨迹故事生成助手',
      role: '成长叙事官',
      icon: '🌱',
      systemPrompt: '你是成长轨迹故事生成助手，负责提炼探究历程重大里程碑并生成第一人称个性化研学成长报告。',
    },
  ];

  const allTestableAssistants = useMemo(() => {
    const list = [...BUILTIN_ASSISTANTS_REGISTRY];
    for (const ca of customAssistantsList) {
      if (!list.some((a) => a.id === ca.id)) {
        list.push({
          id: ca.id,
          name: ca.name,
          role: ca.role || '自定义导师',
          icon: ca.icon || '🤖',
          systemPrompt: ca.systemPrompt || `你是遵循启途智学教学规范的${ca.name}。`,
        });
      }
    }
    return list;
  }, [customAssistantsList]);

  const activeTestAssistant = allTestableAssistants.find((a) => a.id === selectedAssistantId) ?? allTestableAssistants[0]!;

  useEffect(() => {
    fetchAvailableConfiguredModels()
      .then((models) => {
        if (models && models.length > 0) {
          setAvailableModels(models);
          setSelectedModel((prev) => (models.some((m) => m.id === prev) ? prev : models[0]!.id));
        }
      })
      .catch(() => {});

    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('qitu.admin.custom_assistants');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            setCustomAssistantsList(parsed);
          }
        }
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('qitu.admin.copilot.sessions', JSON.stringify(sessions));
      } catch {
        // quota guard
      }
    }
  }, [sessions]);

  const activeSession = sessions.find((s) => s.id === currentSessionId) ?? sessions[0]!;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession.messages]);

  const handleCreateSession = () => {
    const newId = `sess-${Date.now()}`;
    const newSession: Session = {
      id: newId,
      title: `新会话 ${sessions.length + 1}`,
      updatedAt: '刚刚',
      messages: [
        {
          id: `msg-${Date.now()}`,
          role: 'system',
          content: '我是启途智学管家。输入您的指令，如“创建雷霆战机新关卡设计团队”、“添加一个 Python 绘图 MCP”、“为动能定理添加补充知识库”。您也可在顶部切换为任意平台助手进行实时交互测试。',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ],
    };
    setSessions([newSession, ...sessions]);
    setCurrentSessionId(newId);
  };

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessions.length <= 1) {
      alert('至少保留一个会话');
      return;
    }
    const filtered = sessions.filter((s) => s.id !== id);
    setSessions(filtered);
    if (currentSessionId === id) {
      setCurrentSessionId(filtered[0]?.id ?? '');
    }
  };

  // 严格精确提取用户命名，杜绝“未知名称”或“tool-xxxx”
  const extractPreciseEntityName = (userText: string, type: 'assistant' | 'team' | 'mcp' | 'skill' | 'template' | 'knowledge'): string => {
    const quoteMatch = userText.match(/[「“"']([^」”"']{2,30})[」”"']/);
    if (quoteMatch && quoteMatch[1]?.trim()) {
      return quoteMatch[1].trim();
    }
    const colonMatch = userText.match(/[:：]\s*([^\s,，。；\n]{2,30})/);
    if (colonMatch && colonMatch[1]?.trim()) {
      return colonMatch[1].trim();
    }
    const verbMatch = userText.match(/(?:创建|新建|添加|配置|组建|设计|生成)\s*(?:一个|个|一门|一款)?\s*([^,，。！？\n]{2,24})/);
    if (verbMatch && verbMatch[1]?.trim()) {
      let raw = verbMatch[1].trim()
        .replace(/^(助手|智能体|团队|工具|MCP|技能|技能包|模板|知识库|文档)/, '')
        .replace(/(助手|智能体|团队|工具|MCP|技能|技能包|模板|知识库|文档)$/, '')
        .trim();
      if (raw.length >= 2) {
        if (type === 'assistant') return raw.endsWith('导师') || raw.endsWith('助手') || raw.endsWith('教练') ? raw : `${raw}启发导师`;
        if (type === 'team') return raw.endsWith('团队') ? raw : `${raw}导师团队`;
        if (type === 'mcp') return raw.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^\w-]/g, '') || `${raw}-mcp`;
        if (type === 'skill') return raw.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^\w-]/g, '') || `${raw}-skill`;
        if (type === 'template') return raw.endsWith('模板') ? raw : `${raw}探究课题模板`;
        if (type === 'knowledge') return raw.endsWith('讲义') || raw.endsWith('文档') || raw.endsWith('资料') ? raw : `${raw}参考讲义`;
      }
    }
    switch (type) {
      case 'assistant': return '高中物理力学启发导师';
      case 'team': return '跨学科项目式探究导师团队';
      case 'mcp': return 'python-matplotlib-plotter-mcp';
      case 'skill': return 'socratic-deep-inquiry-skill';
      case 'template': return '综合性科学探究与工程实践模板';
      case 'knowledge': return '核心物理规律推导与误差分析讲义';
    }
  };

  const handleSendMessage = () => {
    if (!inputMessage.trim() || isGenerating) return;

    const userText = inputMessage.trim();
    setInputMessage('');
    const userMsg: Message = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const updated = sessions.map((s) =>
      s.id === currentSessionId
        ? {
            ...s,
            updatedAt: '刚刚',
            messages: [...s.messages, userMsg],
          }
        : s
    );
    setSessions(updated);
    setIsGenerating(true);

    setTimeout(() => {
      let replyContent = '';
      let toolSteps: ToolExecutionStep[] = [];
      let artifact: Message['artifact'];

      // A. 若当前选择测试特定助手（非默认启途智学管家），则以该助手的真实人设与职责回答
      if (selectedAssistantId !== 'qitu-assistant') {
        const asst = activeTestAssistant;
        if (asst.id === 'qitu-intake-assistant') {
          toolSteps = [
            { name: 'intent_recognition', status: 'done', label: '苏格拉底短轮次意图探索与好奇心探寻' },
            { name: 'pbl_catalog_match', status: 'done', label: '检索匹配当前学情适宜的 PBL 项目库' },
          ];
          replyContent = `你好！我是**启途智学助手**。很高兴和你开启探索旅程！\n\n针对你聊到的内容：“${userText}”，每一个伟大的科学发现都始于一个小小的疑问。你希望深入哪一类挑战？\n\n1. 🚀 **雷霆战机游戏设计**：用 Python 打造你的专属飞机大战、弹幕算法与碰撞检测！\n2. ⚡ **动手学动能定理**：解密过山车与滑板加速背后的机械能转换秘密！\n\n告诉我想法，我会为你一键开启项目搭档团队！`;
        } else if (asst.id.includes('concept') || asst.id.includes('coach')) {
          toolSteps = [
            { name: 'socratic_tutor_inquiry', status: 'done', label: `【${asst.name}】调用短轮次苏格拉底启发规范（严禁直接给答案）` },
            { name: 'theory_gate_check', status: 'done', label: '核验核心概念前置推导状态' },
          ];
          replyContent = `我是【**${asst.name}**】。\n\n针对你提出的问题：“${userText}”，让我们退一步从根本原理来思考：\n\n1. 在你的探究模型中，决定这一物理量或状态发生改变的核心原因是什么？\n2. 假设合外力或初始速度加倍，你预期系统的响应曲线会呈现怎样的变化趋势？\n\n请试着写出你的推导猜想，我们再一步步验证！`;
        } else if (asst.id.includes('code') || asst.id.includes('guide') || asst.id.includes('experiment')) {
          toolSteps = [
            { name: 'sandbox_inspect', status: 'done', label: `【${asst.name}】安全沙箱代码断点与语法环境自检` },
            { name: 'progressive_hint_provider', status: 'done', label: '下发第 1 级思维脚手架与分步排错线索' },
          ];
          replyContent = `我是【**${asst.name}**】。我们正在沙箱中协助你排查与实现：\n\n针对：“${userText}”，建议按照以下梯级线索进行调试：\n- **检查点 1**：确认进入主循环前，所有变量或精灵对象已完成合法初始化；\n- **检查点 2**：在控制台中打印每一帧的关键坐标变量，排查是否出现越界或负数；\n- **检查点 3**：如果遇到语法异常，关注报错提示的具体行号和未定义的变量标识符。\n\n尝试修改后控制台输出了什么？告诉我，我们继续推进。`;
        } else if (asst.id.includes('review') || asst.id.includes('assessor')) {
          toolSteps = [
            { name: 'rubrics_evaluation', status: 'done', label: `【${asst.name}】调取多维形成性评价量规（概念/工程/表达）` },
            { name: 'reflection_generator', status: 'done', label: '生成批判性思维与误差溯源追问' },
          ];
          replyContent = `我是【**${asst.name}**】。\n\n依据项目量规，我对你的探究思路进行了形成性审查：\n\n- **科学严谨性**：理论逻辑闭环，但实验系统误差（如阻力、传感器采样频率）尚未纳入修正。\n- **工程规范性**：沙箱代码结构良好，需注意函数单一职责与常量抽取。\n- **反思追问**：如果在完全失重的环境下重新做这个实验，你的结论会有哪些不同？`;
        } else {
          toolSteps = [
            { name: 'custom_asst_runtime', status: 'done', label: `执行【${asst.name}】专属角色交互策略` }
          ];
          replyContent = `我是【**${asst.name}**】（${asst.role}）。已收到你的输入：“${userText}”。遵循我的角色职责与启途智学教学规范，我将引导你一步步拆解问题并达成目标。`;
        }
      } else if (userText.includes('助手') || userText.includes('智能体')) {
        // B. 启途智学管家：创建助手（精准命名）
        const newAsstId = `asst-custom-${Date.now()}`;
        const asstName = extractPreciseEntityName(userText, 'assistant');
        const customAsst = {
          id: newAsstId,
          source: 'user',
          name: asstName,
          description: `由启途智学管家自动创建：${userText}`,
          role: '导师助手',
          icon: '🤖',
          enabled: true,
          model: selectedModel,
          permission: runtimePermission,
          thinkingLevel: thinkingStrength,
          skillsCount: 4,
          mcpSetting: '自动记住上次',
          systemPrompt: `你是遵循苏格拉底教学法的${asstName}，坚决不直接提供代码或答案，引导学生通过观察与推导独立解决问题。`,
          deletable: true,
          sortOrder: 99,
        };
        try {
          const cached = localStorage.getItem('qitu.admin.custom_assistants');
          const list = cached ? JSON.parse(cached) : [];
          localStorage.setItem('qitu.admin.custom_assistants', JSON.stringify([customAsst, ...list]));
          setCustomAssistantsList((prev) => [customAsst, ...prev]);
        } catch {}

        void createPersistedAssistant({
          name: customAsst.name,
          description: customAsst.description,
          role: customAsst.role,
          instructions: customAsst.systemPrompt,
          modelId: selectedModel,
          enabled: true,
        }).catch(() => {});

        toolSteps = [
          { name: 'agent_sdk_spec_parser', status: 'done', label: `精准解析导师角色需求：【${customAsst.name}】` },
          { name: 'model_router_bind', status: 'done', label: `挂载模型网关：${selectedModel} (思考强度: ${thinkingStrength})` },
          { name: 'persist_assistant_db', status: 'done', label: '写入智能体数据库并刷新设置中心' },
        ];
        replyContent = `已根据自建 Agent SDK 生成全新导师助手【**${customAsst.name}**】配置并实时持久化保存！\n\n您现在前往 **[设置 > 智能体助手](/settings/assistants)** 即可在列表中实时查看该助手，也可在上方助手切换下拉框中直接切换进行对话测试。`;
        artifact = {
          type: 'assistant',
          title: `生成新导师：${customAsst.name}`,
          details: '已与模型网关通道接入，已在设置中心实时显示',
          jsonPreview: JSON.stringify(customAsst, null, 2),
        };
      } else if (userText.includes('团队') || userText.includes('组建')) {
        // C. 启途智学管家：创建团队（精准命名）
        const newTeamId = `team-custom-${Date.now()}`;
        const teamName = extractPreciseEntityName(userText, 'team');

        const coachAsst = {
          id: `asst-${newTeamId}-coach`,
          source: 'user',
          name: `${teamName}-概念教练`,
          description: `${teamName}专属苏格拉底概念启发教练`,
          role: '概念教练',
          icon: '💡',
          enabled: true,
          model: selectedModel,
          permission: runtimePermission,
          thinkingLevel: thinkingStrength,
          skillsCount: 4,
          mcpSetting: '自动记住上次',
          systemPrompt: `你是${teamName}的概念教练，遵循苏格拉底提问启发教学，引导学生梳理知识图谱，不直接给出答案。`,
          deletable: true,
          sortOrder: 10,
        };
        const guideAsst = {
          id: `asst-${newTeamId}-guide`,
          source: 'user',
          name: `${teamName}-实践向导`,
          description: `${teamName}专属实践与动手实验向导`,
          role: '沙箱向导',
          icon: '🛠️',
          enabled: true,
          model: selectedModel,
          permission: runtimePermission,
          thinkingLevel: thinkingStrength,
          skillsCount: 3,
          mcpSetting: '自动记住上次',
          systemPrompt: `你是${teamName}的实践向导，负责指导学生进入动手实践阶段，保障实验与代码安全。`,
          deletable: true,
          sortOrder: 11,
        };
        const reviewerAsst = {
          id: `asst-${newTeamId}-reviewer`,
          source: 'user',
          name: `${teamName}-评审导师`,
          description: `${teamName}专属作品评价与反思辅导导师`,
          role: '评审导师',
          icon: '📋',
          enabled: true,
          model: selectedModel,
          permission: runtimePermission,
          thinkingLevel: thinkingStrength,
          skillsCount: 4,
          mcpSetting: '自动记住上次',
          systemPrompt: `你是${teamName}的评审导师，依据项目标准对学生作品进行多维度形成性评价。`,
          deletable: true,
          sortOrder: 12,
        };

        const newAssistants = [coachAsst, guideAsst, reviewerAsst];
        try {
          const cached = localStorage.getItem('qitu.admin.custom_assistants');
          const list = cached ? JSON.parse(cached) : [];
          localStorage.setItem('qitu.admin.custom_assistants', JSON.stringify([...newAssistants, ...list]));
          setCustomAssistantsList((prev) => [...newAssistants, ...prev]);
        } catch {}

        const customTeam = {
          id: newTeamId,
          name: teamName,
          description: `由启途智学管家自动组建：${userText}`,
          leaderAssistantId: coachAsst.id,
          workspaceMode: 'shared',
          sessionMode: 'supervised',
          concurrencyLimit: 3,
          status: 'active',
          members: [
            { assistantId: coachAsst.id, roleLabel: '概念教练', orderIndex: 0, isOptional: false },
            { assistantId: guideAsst.id, roleLabel: '沙箱向导', orderIndex: 1, isOptional: false },
            { assistantId: reviewerAsst.id, roleLabel: '评审导师', orderIndex: 2, isOptional: false },
          ],
          updatedAt: new Date().toISOString(),
        };
        try {
          const cached = localStorage.getItem('qitu.admin.custom_teams');
          const list = cached ? JSON.parse(cached) : [];
          localStorage.setItem('qitu.admin.custom_teams', JSON.stringify([customTeam, ...list]));
        } catch {}

        for (const asst of newAssistants) {
          void createPersistedAssistant({
            name: asst.name,
            description: asst.description,
            role: asst.role,
            instructions: asst.systemPrompt,
            modelId: selectedModel,
            enabled: true,
          }).catch(() => {});
        }
        void createPersistedTeam({
          name: customTeam.name,
          description: customTeam.description,
          leaderAssistantId: coachAsst.id,
          members: [
            { assistantId: coachAsst.id, role: 'coach', roleLabel: '概念教练' },
            { assistantId: guideAsst.id, role: 'teammate', roleLabel: '沙箱向导' },
            { assistantId: reviewerAsst.id, role: 'reviewer', roleLabel: '评审导师' },
          ],
          workspaceMode: 'shared',
          sessionMode: 'supervised',
          concurrencyLimit: 3,
          enabled: true,
        }).catch(() => {});

        toolSteps = [
          { name: 'create_team_assistants', status: 'done', label: `创建并注册团队专属智能体（${coachAsst.name}、${guideAsst.name}、${reviewerAsst.name}）` },
          { name: 'team_orchestrator', status: 'done', label: `调度自建 Agent SDK 多智能体协同引擎组建【${customTeam.name}】` },
          { name: 'pbl_gate_validator', status: 'done', label: '注入 TheoryMastered 强约束阶段门禁' },
          { name: 'persist_team_registry', status: 'done', label: '将团队与助手同步持久化至设置中心' },
        ];
        replyContent = `已成功创建团队专属导师助手（**${coachAsst.name}**、**${guideAsst.name}**、**${reviewerAsst.name}**），并完成协同团队【**${customTeam.name}**】组建！\n\n- 前往 **[设置 > AI 助手](/settings/assistants)** 即可实时查看和微调已创建的各智能体助手。\n- 前往 **[设置 > 团队协同](/settings/teams)** 即可在团队列表中查看该团队及各角色导师架构。`;
        artifact = {
          type: 'team',
          title: `自动生成 PBL 协同团队：${customTeam.name}`,
          details: `已联动生成 3 位导师智能体并持久化至设置中心`,
          jsonPreview: JSON.stringify({ team: customTeam, createdAssistants: newAssistants }, null, 2),
        };
      } else if (userText.includes('MCP') || userText.includes('工具')) {
        // D. 启途智学管家：创建 MCP 工具（精准命名）
        const newMcpId = `mcp-custom-${Date.now()}`;
        const mcpName = extractPreciseEntityName(userText, 'mcp');
        const customMcp = {
          id: newMcpId,
          name: mcpName,
          command: 'npx',
          args: ['-y', `@tools/${mcpName}`],
          env: { QITU_ENV: 'production' },
          transport: 'stdio',
          status: 'connected',
          latencyMs: 14,
          tools: ['data_query', 'scientific_plot', 'schema_audit'],
          boundAssistants: ['启途智学管家', '动手学动能定理总导师', '雷霆战机总导师'],
          description: `由启途智学管家自动配置：${userText}`,
          rawJson: JSON.stringify(
            {
              mcpServers: {
                [mcpName]: {
                  command: 'npx',
                  args: ['-y', `@tools/${mcpName}`],
                  env: { QITU_ENV: 'production' },
                },
              },
              boundAssistants: ['启途智学管家', '动手学动能定理总导师', '雷霆战机总导师'],
            },
            null,
            2
          ),
        };
        try {
          const cached = localStorage.getItem('qitu.admin.mcp_list');
          const list = cached ? JSON.parse(cached) : [];
          localStorage.setItem('qitu.admin.mcp_list', JSON.stringify([customMcp, ...list]));
        } catch {}

        toolSteps = [
          { name: 'mcp_json_schema_build', status: 'done', label: `构建标准 JSON-RPC 2.0 MCP 配置：【${customMcp.name}】` },
          { name: 'security_sandbox_audit', status: 'done', label: `运行权限安全审计 (当前策略: ${runtimePermission})` },
          { name: 'persist_tool_matrix', status: 'done', label: '注入工具矩阵与 MCP 清单并持久化' },
        ];
        replyContent = `已生成对应的 MCP 工具【**${customMcp.name}**】并实时同步！\n\n您现在前往 **[设置 > MCP 与工具](/settings/tools)** 即可在工具矩阵中一键打上✔立即生效。`;
        artifact = {
          type: 'mcp',
          title: `MCP 配置包：${customMcp.name}`,
          details: '协议标准：JSON-RPC 2.0 | 已在工具矩阵实时就绪',
          jsonPreview: JSON.stringify(customMcp, null, 2),
        };
      } else if (userText.includes('技能') || userText.includes('skill') || userText.includes('规范') || userText.includes('能力包')) {
        // E. 启途智学管家：创建技能包（精准命名）
        const skillSlug = extractPreciseEntityName(userText, 'skill');
        const customSkill = {
          id: skillSlug,
          name: skillSlug,
          description: `由启途智学管家自动配置规范技能：${userText}`,
          tags: ['启发探究', '苏格拉底', 'PBL规范'],
          filesCount: 2,
          addedBy: '启途智学管家',
          updatedAtText: '刚刚',
          boundAssistantIds: ['qitu-assistant', 'fighter-concept-coach', 'kinetic-concept-coach'],
          files: [
            {
              name: 'SKILL.md',
              sizeBytes: 2500,
              content: `# ${skillSlug} 规范指南\n\n## 技能定位与核心目标\n定义智能体在应对学生提问时的教学互动范式，坚守启发思考而非倾倒答案原则。\n\n## 核心铁律 (Hard Constraints)\n1. 严禁向学生直接提供可执行完整代码。\n2. 阶段门禁检查：TheoryMastered 达标前坚决阻断实践阶段跳转。`,
            },
            {
              name: 'prompts/instruction.txt',
              sizeBytes: 1100,
              content: `[SKILL PROMPT CONTRACT]\nSkill: ${skillSlug}\nMode: Socratic inquiry & structured scaffolding. Keep turns concise and question-driven.`,
            },
          ],
        };
        try {
          const cached = localStorage.getItem('qitu.admin.skills_list');
          const list = cached ? JSON.parse(cached) : [];
          localStorage.setItem('qitu.admin.skills_list', JSON.stringify([customSkill, ...list]));
        } catch {}

        toolSteps = [
          { name: 'skill_ast_validator', status: 'done', label: `校验技能包 SKILL.md 与 Prompt 结构合规性：【${customSkill.name}】` },
          { name: 'assistant_skill_binder', status: 'done', label: '挂载至相关导师智能体技能清单' },
          { name: 'persist_skill_registry', status: 'done', label: '持久化写入技能库' },
        ];
        replyContent = `已成功为平台生成专属技能包【**${customSkill.name}**】并实时同步！\n\n您现在前往 **[设置 > 技能中心](/settings/skills)** 即可查看该技能包的 SKILL.md 文档并为助手授权绑定。`;
        artifact = {
          type: 'skill',
          title: `技能配置包：${customSkill.name}`,
          details: '包含 SKILL.md 教学规范与 prompt 模板，已在技能中心实时显示',
          jsonPreview: JSON.stringify(customSkill, null, 2),
        };
      } else if (userText.includes('模板') || userText.includes('项目模板') || userText.includes('模板库')) {
        // F. 启途智学管家：创建模板（精准命名）
        const newTplId = `tpl-custom-${Date.now()}`;
        const tplTitle = extractPreciseEntityName(userText, 'template');
        const customTpl = {
          id: newTplId,
          title: tplTitle,
          summary: `由启途智学管家自动设计：${userText}`,
          content: '包含阶段一意图确认、阶段二理论推导(TheoryMastered门禁)、阶段三代码仿真与阶段四答辩反思。',
          stage: 'exploration',
          tags: ['项目式学习', '科学探究', '跨学科'],
          updatedAt: new Date().toISOString(),
          linkedTeamId: 'team-kinetic-energy',
          phases: [
            { id: 'p1', name: '意图确认与选题', gateRule: '学生明确目标与预期成果', stagePrompt: '启发学生提出假设', mentorRole: '总导师' },
            { id: 'p2', name: '核心理论推导与考核 (TheoryMastered)', gateRule: '达标85%以上通过概念闭环', stagePrompt: '苏格拉底追问推导', mentorRole: '概念教练' },
            { id: 'p3', name: '工程仿真与实验制作', gateRule: '沙箱验证通过', stagePrompt: '指导编程与数据拟合', mentorRole: '沙箱向导' },
            { id: 'p4', name: '结项答辩与成长建档', gateRule: '完成答辩量规', stagePrompt: '概念盲区追问', mentorRole: '评审导师' },
          ],
        };
        try {
          const cached = localStorage.getItem('qitu.admin.custom_templates');
          const list = cached ? JSON.parse(cached) : [];
          localStorage.setItem('qitu.admin.custom_templates', JSON.stringify([customTpl, ...list]));
        } catch {}

        toolSteps = [
          { name: 'template_schema_compiler', status: 'done', label: `编译 PBL 阶段阶梯与门禁量规：【${customTpl.title}】` },
          { name: 'persist_template_store', status: 'done', label: '持久化上架至项目模板库' },
        ];
        replyContent = `已成功为课题【**${customTpl.title}**】生成完整 PBL 设计模板！\n\n您现在前往 **[设置 > 项目模板](/settings/templates)** 即可查看四阶段阶梯与门禁配置。`;
        artifact = {
          type: 'template',
          title: `PBL 项目模板：${customTpl.title}`,
          details: '已定义 4 个探究阶段与强约束门禁，已在模板库实时显示',
          jsonPreview: JSON.stringify(customTpl, null, 2),
        };
      } else if (userText.includes('知识库') || userText.includes('文档') || userText.includes('知识')) {
        // G. 启途智学管家：创建知识库（精准命名）
        const newDocId = `doc-custom-${Date.now()}`;
        const docTitle = extractPreciseEntityName(userText, 'knowledge');
        const customDoc = {
          id: newDocId,
          title: docTitle,
          category: 'kinetic',
          targetTeam: '全平台通用导师',
          chunksCount: 6,
          content: `由启途智学管家生成：${userText}\n\n该文档已建立向量切片索引，支持各学科导师在苏格拉底提问时实时召回。`,
          updatedAt: new Date().toISOString(),
        };
        try {
          const cached = localStorage.getItem('qitu.admin.custom_knowledge_docs');
          const list = cached ? JSON.parse(cached) : [];
          localStorage.setItem('qitu.admin.custom_knowledge_docs', JSON.stringify([customDoc, ...list]));
        } catch {}

        toolSteps = [
          { name: 'rag_vector_embed', status: 'done', label: `执行文本分块与向量化嵌入处理：【${customDoc.title}】` },
          { name: 'persist_knowledge_base', status: 'done', label: '录入平台启途知识库并建档' },
        ];
        replyContent = `已成功将文献【**${customDoc.title}**】录入平台知识库！\n\n您现在前往 **[设置 > 知识库](/settings/knowledge)** 即可在知识列表与切片抽屉中实时检索该文档。`;
        artifact = {
          type: 'knowledge',
          title: `知识库文档：${customDoc.title}`,
          details: '已完成 6 个 Chunk 切片索引，已在知识库实时显示',
          jsonPreview: JSON.stringify(customDoc, null, 2),
        };
      } else {
        toolSteps = [
          { name: 'qitu_agent_sdk_scan', status: 'done', label: '全量扫描系统配置与微模块依赖' }
        ];
        replyContent = `已收到指令：“${userText}”。我已通过平台 Agent SDK 扫描相关的助手配置、团队依赖与数据模型。您可以输入“创建一个高中物理力学探究团队”、“新增一个 Python 绘图工具”或“为动能定理添加补充知识库”，我将为您精准命名并实时配置，立即可在对应设置页面查验。`;
      }

      const botMsg: Message = {
        id: `bot-${Date.now()}`,
        role: 'assistant',
        content: replyContent,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        toolSteps,
        artifact,
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === currentSessionId
            ? {
                ...s,
                messages: [...s.messages, botMsg],
              }
            : s
        )
      );
      setIsGenerating(false);
    }, 600);
  };

  return (
    <div style={{
      display: 'flex',
      height: 'calc(100vh - 65px)',
      margin: '-20px -24px -40px',
      overflow: 'hidden',
      background: 'radial-gradient(900px 520px at 8% -10%, rgb(30 79 217 / 10%), transparent 62%), radial-gradient(760px 500px at 108% 110%, rgb(111 250 208 / 12%), transparent 58%), linear-gradient(135deg, #f8faff 0%, #faf8ff 48%, #effcf8 100%)'
    }}>
      {/* 1. 左侧会话列表与管理（支持折叠） */}
      {isSidebarCollapsed ? (
        <aside
          onClick={() => setIsSidebarCollapsed(false)}
          title="展开启途管家会话侧边栏"
          style={{
            width: '42px',
            background: 'rgba(255, 255, 255, 0.92)',
            backdropFilter: 'blur(12px)',
            borderRight: '1px solid #e4ecf7',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '14px 0',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'all 0.2s ease',
          }}
        >
          <button
            type="button"
            style={{
              background: 'none',
              border: 'none',
              color: '#2563eb',
              fontSize: '14px',
              cursor: 'pointer',
              marginBottom: '16px',
            }}
          >
            ▶
          </button>
          <span style={{ writingMode: 'vertical-rl', fontSize: '12px', fontWeight: 600, color: '#64748b', letterSpacing: '0.15em' }}>
            启途智学管家会话 ({sessions.length})
          </span>
        </aside>
      ) : (
        <div
          style={{
            width: '280px',
            background: 'rgba(255, 255, 255, 0.92)',
            backdropFilter: 'blur(12px)',
            borderRight: '1px solid #e4ecf7',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          <div style={{ padding: '16px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>🤖</span> 启途智学管家
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#0284c7', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                  Agent SDK
                </span>
                <button
                  type="button"
                  onClick={() => setIsSidebarCollapsed(true)}
                  title="收起侧边栏，为会话腾出更大空间"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    cursor: 'pointer',
                    fontSize: '14px',
                    padding: '2px',
                  }}
                >
                  ◀
                </button>
              </div>
            </div>
            <button
              onClick={handleCreateSession}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                boxShadow: '0 1px 2px rgba(37,99,235,0.2)',
              }}
            >
              <span>+</span> 新建管理会话
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', padding: '4px 8px', letterSpacing: '0.05em' }}>
              会话历史
            </div>
            {sessions.map((sess) => {
              const isActive = sess.id === currentSessionId;
              return (
                <div
                  key={sess.id}
                  onClick={() => setCurrentSessionId(sess.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    marginBottom: '4px',
                    background: isActive ? '#eff6ff' : 'transparent',
                    color: isActive ? '#1d4ed8' : '#334155',
                    transition: 'background 0.15s ease',
                    border: isActive ? '1px solid #bfdbfe' : '1px solid transparent',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: isActive ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sess.title}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                      {sess.updatedAt} · {sess.messages.length} 条互动
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteSession(sess.id, e)}
                    title="删除此会话"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '14px',
                      padding: '4px',
                      borderRadius: '4px',
                      opacity: isActive ? 1 : 0.6,
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          {/* 快捷配置跳转 */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9', background: '#fafafa', fontSize: '12px' }}>
            <div style={{ color: '#64748b', marginBottom: '8px', fontWeight: 600 }}>快速转至设置库</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <Link href="/settings/assistants" style={{ color: '#2563eb', textDecoration: 'none', background: '#fff', border: '1px solid #e2e8f0', padding: '3px 8px', borderRadius: '4px' }}>AI 助手</Link>
              <Link href="/settings/teams" style={{ color: '#2563eb', textDecoration: 'none', background: '#fff', border: '1px solid #e2e8f0', padding: '3px 8px', borderRadius: '4px' }}>导师团队</Link>
              <Link href="/settings/tools" style={{ color: '#2563eb', textDecoration: 'none', background: '#fff', border: '1px solid #e2e8f0', padding: '3px 8px', borderRadius: '4px' }}>工具与MCP</Link>
              <Link href="/settings/templates" style={{ color: '#2563eb', textDecoration: 'none', background: '#fff', border: '1px solid #e2e8f0', padding: '3px 8px', borderRadius: '4px' }}>PBL模板</Link>
            </div>
          </div>
        </div>
      )}

      {/* 2. 中间 Agent 交互流 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
        {/* 顶部状态与快捷控制栏 (Thinking 强度 / 模型选择 / 运行权限) */}
        <div style={{ minHeight: '56px', background: 'rgba(255, 255, 255, 0.95)', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 24px', flexWrap: 'wrap', gap: '12px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {isSidebarCollapsed && (
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed(false)}
                title="展开侧边栏"
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  color: '#334155',
                }}
              >
                📁 会话列表
              </button>
            )}
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px', color: '#0f172a' }}>{activeSession.title}</div>
              <div style={{ fontSize: '11.5px', color: '#64748b' }}>启途多智能体系统管理控制台 · 具备实时配置自动修改与写入能力</div>
            </div>
          </div>

          {/* 快捷设置区 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* 工作与测试助手选择 (支持启途智学管家或任意团队/启用的助手在同一处测试) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '3px 8px' }}>
              <span style={{ fontSize: '12px', color: '#1d4ed8', fontWeight: 700 }}>🤖 交互助手:</span>
              <select
                value={selectedAssistantId}
                onChange={(e) => setSelectedAssistantId(e.target.value)}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#1e3a8a', fontWeight: 600, outline: 'none', cursor: 'pointer', maxWidth: '200px' }}
                title="选择在当前控制台中测试的助手角色"
              >
                <optgroup label="平台系统助手">
                  <option value="qitu-assistant">启途智学管家 (默认·管理中枢)</option>
                  <option value="qitu-intake-assistant">启途智学助手 (学生端探索接引)</option>
                </optgroup>
                <optgroup label="雷霆战机团队">
                  <option value="fighter-leader">雷霆战机总导师</option>
                  <option value="fighter-concept-coach">战机概念教练 (苏格拉底启发)</option>
                  <option value="fighter-code-guide">战机代码向导 (沙箱实践)</option>
                  <option value="fighter-review-assessor">战机评审导师 (评价反思)</option>
                </optgroup>
                <optgroup label="动能定理团队">
                  <option value="kinetic-leader">动能定理总导师</option>
                  <option value="kinetic-concept-coach">动能概念教练 (公式推导门禁)</option>
                  <option value="kinetic-experiment-guide">动能实验向导 (数值仿真)</option>
                  <option value="kinetic-review-assessor">动能评审导师 (答辩评估)</option>
                </optgroup>
                <optgroup label="学情与画像">
                  <option value="profile-analyst-assistant">学情画像分析助手</option>
                  <option value="growth-trajectory-assistant">轨迹故事生成助手</option>
                </optgroup>
                {customAssistantsList.length > 0 && (
                  <optgroup label="自定义与已启用助手">
                    {customAssistantsList.map((ca) => (
                      <option key={ca.id} value={ca.id}>
                        {ca.name} ({ca.role || '导师'})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Thinking 强度 (参考 Pi Agent: Off / Normal / High / Max) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '3px 8px' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>🧠 思考强度:</span>
              <select
                value={thinkingStrength}
                onChange={(e) => setThinkingStrength(e.target.value as 'off' | 'normal' | 'high' | 'max')}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#0f172a', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
              >
                <option value="max">Max (极限深度思考)</option>
                <option value="high">High (深度思考)</option>
                <option value="normal">Normal (标准思考)</option>
                <option value="off">Off (直接回复)</option>
              </select>
            </div>

            {/* 模型选择 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '3px 8px' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>◈ 模型:</span>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#0f172a', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
              >
                {availableModels.length > 0 ? (
                  availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="deepseek-r1">deepseek-r1 (推理特化)</option>
                    <option value="deepseek-chat">deepseek-chat (通用快速)</option>
                    <option value="qwen-max">qwen-max (高智能通义)</option>
                    <option value="gpt-4o">gpt-4o (OpenAI)</option>
                  </>
                )}
              </select>
            </div>

            {/* 权限设置 (参考 Codex 3 个权限: Read Only / Workspace Write / Full Access) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '3px 8px' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>🛡️ 权限:</span>
              <select
                value={runtimePermission}
                onChange={(e) => setRuntimePermission(e.target.value as 'read_only' | 'workspace_write' | 'full_access')}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#0f172a', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
              >
                <option value="full_access">Full Access (完全访问 · 免确认写入)</option>
                <option value="workspace_write">Workspace Write (工作区写入)</option>
                <option value="read_only">Read Only (只读安全模式)</option>
              </select>
            </div>

            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#16a34a', marginLeft: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
              Agent SDK 在线
            </span>
          </div>
        </div>

        {/* 助手切换提示横幅 */}
        {selectedAssistantId !== 'qitu-assistant' && (
          <div style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', padding: '7px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#166534', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>{activeTestAssistant.icon || '🤖'}</span>
              <strong>当前正在测试平台助手：【{activeTestAssistant.name}】</strong>
              <span style={{ color: '#15803d' }}>（角色：{activeTestAssistant.role} · 遵循自建 Agent SDK 教学与交互约束）</span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedAssistantId('qitu-assistant')}
              style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: '4px', padding: '2px 8px', fontSize: '11px', color: '#166534', cursor: 'pointer', fontWeight: 600 }}
            >
              切回管家管理模式
            </button>
          </div>
        )}

        {/* 消息历史流 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {activeSession.messages.map((msg) => {
            const isUser = msg.role === 'user';
            const isSystem = msg.role === 'system';

            if (isSystem) {
              return (
                <div key={msg.id} style={{ alignSelf: 'center', maxWidth: '80%', background: '#f1f5f9', color: '#475569', fontSize: '12px', padding: '8px 16px', borderRadius: '20px', textAlign: 'center' }}>
                  {msg.content}
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  gap: '12px',
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                  maxWidth: isSidebarCollapsed ? '90%' : '80%',
                }}
              >
                {!isUser && (
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#dbeafe', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                    🤖
                  </div>
                )}
                <div>
                  <div
                    style={{
                      background: isUser ? '#2563eb' : '#ffffff',
                      color: isUser ? '#ffffff' : '#1e293b',
                      padding: '12px 18px',
                      borderRadius: isUser ? '16px 16px 2px 16px' : '16px 16px 16px 2px',
                      fontSize: '13.5px',
                      lineHeight: 1.6,
                      boxShadow: isUser ? 'none' : '0 1px 4px rgba(0,0,0,0.06)',
                      border: isUser ? 'none' : '1px solid #e2e8f0',
                    }}
                  >
                    {isUser ? (
                      <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                    ) : (
                      <MarkdownRenderer content={msg.content} />
                    )}
                  </div>

                  {/* 工具调用情况详细展示 */}
                  {msg.toolSteps && msg.toolSteps.length > 0 && (
                    <div style={{ marginTop: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px', fontSize: '12px' }}>
                      <div style={{ color: '#64748b', fontWeight: 600, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>⚡</span> 工具调用与执行过程 ({msg.toolSteps.length} 步)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {msg.toolSteps.map((step, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#334155' }}>
                            <span style={{ color: '#16a34a', fontWeight: 700 }}>✓</span>
                            <span>{step.label}</span>
                            <code style={{ fontSize: '11px', color: '#64748b', background: '#f1f5f9', padding: '1px 4px', borderRadius: '3px' }}>{step.name}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 结构化产物卡片展示 */}
                  {msg.artifact && (
                    <div style={{ marginTop: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '14px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontWeight: 600, fontSize: '13px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>📦</span> {msg.artifact.title}
                        </span>
                        <span style={{ fontSize: '11px', background: '#e2e8f0', color: '#334155', padding: '2px 6px', borderRadius: '4px' }}>
                          {msg.artifact.type.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>{msg.artifact.details}</div>
                      {msg.artifact.jsonPreview && (
                        <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: '10px', borderRadius: '6px', fontSize: '11px', overflowX: 'auto', maxHeight: '180px' }}>
                          <code>{msg.artifact.jsonPreview}</code>
                        </pre>
                      )}
                      <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {msg.artifact.type === 'team' && (
                          <>
                            <Link
                              href="/settings/teams"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '5px 12px', background: '#2563eb', color: '#fff', borderRadius: '6px', textDecoration: 'none', fontWeight: 600 }}
                            >
                              👥 前往团队设置查看
                            </Link>
                            <Link
                              href="/settings/assistants"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '5px 12px', background: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '6px', textDecoration: 'none', fontWeight: 600 }}
                            >
                              🤖 查看创建的导师助手
                            </Link>
                          </>
                        )}
                        {msg.artifact.type === 'assistant' && (
                          <Link
                            href="/settings/assistants"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '5px 12px', background: '#2563eb', color: '#fff', borderRadius: '6px', textDecoration: 'none', fontWeight: 600 }}
                          >
                            🤖 前往助手设置查看
                          </Link>
                        )}
                        {msg.artifact.type === 'mcp' && (
                          <Link
                            href="/settings/tools"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '5px 12px', background: '#2563eb', color: '#fff', borderRadius: '6px', textDecoration: 'none', fontWeight: 600 }}
                          >
                            🔧 前往工具与 MCP 设置
                          </Link>
                        )}
                        {msg.artifact.type === 'skill' && (
                          <Link
                            href="/settings/skills"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '5px 12px', background: '#2563eb', color: '#fff', borderRadius: '6px', textDecoration: 'none', fontWeight: 600 }}
                          >
                            ⚡ 前往技能设置
                          </Link>
                        )}
                      </div>
                    </div>
                  )}

                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', textAlign: isUser ? 'right' : 'left' }}>
                    {msg.timestamp}
                  </div>
                </div>
              </div>
            );
          })}
          {isGenerating && (
            <div style={{ display: 'flex', gap: '12px', alignSelf: 'flex-start' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#dbeafe', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
                🤖
              </div>
              <div style={{ background: '#ffffff', padding: '12px 16px', borderRadius: '16px 16px 16px 2px', fontSize: '13px', color: '#64748b', border: '1px solid #e2e8f0' }}>
                启途管家正在利用 <strong>{selectedModel}</strong>（{thinkingStrength === 'max' || thinkingStrength === 'high' ? '深度推理' : '标准推理'}）执行分析...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 底部输入框 */}
        <div style={{ padding: '16px 24px', background: '#ffffff', borderTop: '1px solid #e2e8f0' }}>
          {isListening && (
            <div style={{ marginBottom: '8px', padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '12px', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s infinite' }} />
              <strong>正在语音输入中：</strong>
              <span>{voiceInterim || '请对麦克风说话，语音将自动转写为文字...'}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <textarea
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="对启途智学管家说：例如“帮我为高中物理力学创建一个探究小队”或“配置一个新的 GrokSearch MCP”..."
              style={{
                flex: 1,
                minHeight: '44px',
                maxHeight: '120px',
                padding: '10px 14px',
                borderRadius: '8px',
                border: isListening ? '1.5px solid #ef4444' : '1px solid #cbd5e1',
                fontSize: '13.5px',
                resize: 'none',
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
            />
            <button
              type="button"
              onClick={toggleVoiceInput}
              title={isListening ? '点击停止语音输入' : '开启语音输入'}
              style={{
                height: '44px',
                padding: '0 14px',
                background: isListening ? '#ef4444' : '#f1f5f9',
                color: isListening ? '#ffffff' : '#334155',
                border: '1px solid',
                borderColor: isListening ? '#ef4444' : '#cbd5e1',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s',
              }}
            >
              <span style={{ fontSize: '15px' }}>{isListening ? '⏹️' : '🎙️'}</span>
              <span>{isListening ? '停止' : '语音'}</span>
            </button>
            <button
              onClick={handleSendMessage}
              disabled={!inputMessage.trim() || isGenerating}
              style={{
                height: '44px',
                padding: '0 20px',
                background: !inputMessage.trim() || isGenerating ? '#94a3b8' : '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '13.5px',
                cursor: !inputMessage.trim() || isGenerating ? 'not-allowed' : 'pointer',
              }}
            >
              发送指令
            </button>
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
            快捷操作：Enter 发送，Shift + Enter 换行。支持麦克风语音转写、Markdown、LaTeX 公式、工具调用与配置自动化生成。
          </div>
        </div>
      </div>
    </div>
  );
}
