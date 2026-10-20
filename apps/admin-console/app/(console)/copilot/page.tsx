'use client';

import { AssistantGlyph, RobotMascot } from '@qitu/ui';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAssistantCatalog } from '../../../lib/copilot/use-assistant-catalog';
import { resolveCopilotSelection, resolveCopilotTeamSelection } from '../../../lib/copilot/assistant-catalog';
import Link from 'next/link';
import { MarkdownRenderer } from './MarkdownRenderer';
import { fetchAvailableConfiguredModels, configuredModelKey, type ConfiguredModelItem } from '../../../lib/api/configuredModels';
import { createPersistedAssistant } from '../../../lib/api/assistants';
import { createPersistedTeam } from '../../../lib/api/teams';
import { newIdempotencyKey } from '../../../lib/api/modelRegistry';

// v2 intentionally avoids replaying pre-audit sessions that claimed persistence
// without a server acknowledgement. They remain in the old key for diagnostics.
// v3 intentionally drops pre-registry examples and stale local artifacts.
// Runtime entities are server-owned; old browser history must not resurrect a
// deleted team or disabled assistant in the copilot surface.
const COPILOT_SESSIONS_STORAGE_KEY = 'qitu.admin.copilot.sessions.v3';
const COPILOT_SELECTED_MODEL_STORAGE_KEY = 'qitu.admin.copilot.selected_model.v1';
const COPILOT_THINKING_STORAGE_KEY = 'qitu.admin.copilot.thinking.v1';
const COPILOT_PERMISSION_STORAGE_KEY = 'qitu.admin.copilot.permission.v1';

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
    title: '新对话',
    updatedAt: 'just now',
    messages: [
      {
        id: 'msg-1',
        role: 'system',
        content: '启途智学管家就绪。助手目录与团队目录已分开加载；只有服务端确认启用的助手才会出现在选择器中。',
        timestamp: '刚刚',
      },
    ],
  },
];

export default function CopilotPage() {
  const [sessions, setSessions] = useState<Session[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem(COPILOT_SESSIONS_STORAGE_KEY);
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
  const [collapsedHoverId, setCollapsedHoverId] = useState<string | null>(null);

  // 2. 快捷设置状态：Thinking 强度、底座模型选择、运行权限设置、测试助手切换（持久化存储，刷新页面不丢失）
  const [thinkingStrength, setThinkingStrength] = useState<'off' | 'normal' | 'high' | 'max'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem(COPILOT_THINKING_STORAGE_KEY);
        if (cached && ['off', 'normal', 'high', 'max'].includes(cached)) {
          return cached as 'off' | 'normal' | 'high' | 'max';
        }
      } catch {}
    }
    return 'high';
  });
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem(COPILOT_SELECTED_MODEL_STORAGE_KEY) || '';
      } catch {}
    }
    return '';
  });
  const [runtimePermission, setRuntimePermission] = useState<'read_only' | 'workspace_write' | 'full_access'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem(COPILOT_PERMISSION_STORAGE_KEY);
        if (cached && ['read_only', 'workspace_write', 'full_access'].includes(cached)) {
          return cached as 'read_only' | 'workspace_write' | 'full_access';
        }
      } catch {}
    }
    return 'full_access';
  });
  const [availableModels, setAvailableModels] = useState<ConfiguredModelItem[]>([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState<string>('qitu-assistant');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const { state: assistantCatalog, error: catalogError, refresh: refreshAssistantCatalog } = useAssistantCatalog();
  const selectedModelItem = availableModels.find((model) => configuredModelKey(model) === selectedModel) ?? null;
  const assistantOptions = useMemo(() => assistantCatalog.kind === 'ready' ? assistantCatalog.catalog.assistants : [], [assistantCatalog]);
  const teamOptions = useMemo(() => assistantCatalog.kind === 'ready' ? assistantCatalog.catalog.teams : [], [assistantCatalog]);
  const activeTestAssistant = assistantOptions.find((assistant) => assistant.id === selectedAssistantId);
  const activeTeam = teamOptions.find((team) => team.id === selectedTeamId);
  const catalogReady = assistantCatalog.kind === 'ready' && activeTestAssistant !== undefined;

  const handleModelChange = (modelKey: string) => {
    setSelectedModel(modelKey);
    if (typeof window !== 'undefined' && modelKey) {
      try {
        localStorage.setItem(COPILOT_SELECTED_MODEL_STORAGE_KEY, modelKey);
      } catch {}
    }
  };

  const handleThinkingChange = (strength: 'off' | 'normal' | 'high' | 'max') => {
    setThinkingStrength(strength);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(COPILOT_THINKING_STORAGE_KEY, strength);
      } catch {}
    }
  };

  const handlePermissionChange = (perm: 'read_only' | 'workspace_write' | 'full_access') => {
    setRuntimePermission(perm);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(COPILOT_PERMISSION_STORAGE_KEY, perm);
      } catch {}
    }
  };

  useEffect(() => {
    if (assistantCatalog.kind === 'ready') {
      setSelectedAssistantId((previous) => resolveCopilotSelection(assistantCatalog.catalog.assistants, previous));
      setSelectedTeamId((previous) => resolveCopilotTeamSelection(assistantCatalog.catalog.teams, previous));
    }
  }, [assistantCatalog]);

  useEffect(() => {
    fetchAvailableConfiguredModels()
      .then((models) => {
        if (models && models.length > 0) {
          setAvailableModels(models);
          setSelectedModel((prev) => {
            const cached = typeof window !== 'undefined' ? localStorage.getItem(COPILOT_SELECTED_MODEL_STORAGE_KEY) : null;
            if (cached && models.some((m) => configuredModelKey(m) === cached)) {
              return cached;
            }
            if (prev && models.some((m) => configuredModelKey(m) === prev)) {
              return prev;
            }
            const fallback = configuredModelKey(models[0]!);
            if (typeof window !== 'undefined') {
              try {
                localStorage.setItem(COPILOT_SELECTED_MODEL_STORAGE_KEY, fallback);
              } catch {}
            }
            return fallback;
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(COPILOT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
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

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isGenerating || !catalogReady) return;
    const userText = inputMessage.trim();
    setIsGenerating(true);
    // Revalidate before using a role that another Admin tab may have deleted.
    const groups = await refreshAssistantCatalog();
    const confirmedAssistant = groups?.assistants
      .find((assistant) => assistant.id === selectedAssistantId);
    if (!confirmedAssistant) { setIsGenerating(false); return; }
    if (selectedTeamId && !groups?.teams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId('');
    }

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

    setTimeout(async () => {
      let replyContent = '';
      let toolSteps: ToolExecutionStep[] = [];
      let artifact: Message['artifact'];

      // A. 若当前选择测试特定助手（非默认启途智学管家），则以该助手的真实人设与职责回答
      if (selectedAssistantId !== 'qitu-assistant') {
        const asst = confirmedAssistant;
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
          // The server is the source of truth. Only expose/cache the assistant after
          // the create request has been acknowledged; localStorage is not persistence.
          if (!selectedModelItem) throw new Error('模型目录不可用或选择已失效，请刷新后重新选择。');
          const persisted = await createPersistedAssistant(
            {
              name: customAsst.name,
              description: customAsst.description,
              role: customAsst.role,
              instructions: customAsst.systemPrompt,
              modelProviderId: selectedModelItem?.providerId ?? null,
              modelId: selectedModelItem?.id ?? null,
              enabled: true,
            },
            newIdempotencyKey(),
          );
          await refreshAssistantCatalog();
          toolSteps = [
            { name: 'agent_sdk_spec_parser', status: 'done', label: `Parsed assistant role: ${customAsst.name}` },
            { name: 'model_router_bind', status: 'done', label: `Model route selected: ${selectedModel || 'server default'} (thinking: ${thinkingStrength})` },
            { name: 'persist_assistant_db', status: 'done', label: 'Server persisted the assistant and returned the record' },
          ];
          replyContent = `Assistant **${customAsst.name}** was created and persisted by the server.\n\nOpen **[Settings > AI assistants](/settings/assistants)** to verify the returned record.`;
          artifact = {
            type: 'assistant',
            title: `Generated assistant: ${customAsst.name}`,
            details: 'Server confirmed creation; the local cache is display-only',
            jsonPreview: JSON.stringify(persisted, null, 2),
          };
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'server response error';
          toolSteps = [
            { name: 'agent_sdk_spec_parser', status: 'done', label: `Parsed assistant role: ${customAsst.name}` },
            { name: 'persist_assistant_db', status: 'error', label: `Server persistence failed: ${reason}` },
          ];
          replyContent = `Assistant draft **${customAsst.name}** was generated, but the server did not persist it. No success state is shown.\n\nFailure reason: ${reason}\n\nRetry here or use **[Settings > AI assistants](/settings/assistants)**.`;
          artifact = {
            type: 'assistant',
            title: `Assistant draft: ${customAsst.name}`,
            details: `Server persistence failed; draft is only in this conversation: ${reason}`,
            jsonPreview: JSON.stringify(customAsst, null, 2),
          };
        }
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
        const customTeam = {
          id: newTeamId,
          name: teamName,
          description: `Generated by Copilot: ${userText}`,
          leaderAssistantId: coachAsst.id,
          workspaceMode: 'shared',
          sessionMode: 'supervised',
          concurrencyLimit: 3,
          status: 'draft',
          members: [
            { assistantId: coachAsst.id, roleLabel: 'Concept coach', orderIndex: 0, isOptional: false },
            { assistantId: guideAsst.id, roleLabel: 'Sandbox guide', orderIndex: 1, isOptional: false },
            { assistantId: reviewerAsst.id, roleLabel: 'Review mentor', orderIndex: 2, isOptional: false },
          ],
          updatedAt: new Date().toISOString(),
        };
        try {
          // Create assistants first and use the server-issued ids for the team
          // relation. Client-generated ids are never valid persistence references.
          if (!selectedModelItem) throw new Error('模型目录不可用或选择已失效，请刷新后重新选择。');
          const persistedAssistants = await Promise.all(
            newAssistants.map((asst) =>
              createPersistedAssistant(
                {
                  name: asst.name,
                  description: asst.description,
                  role: asst.role,
                  instructions: asst.systemPrompt,
                  modelProviderId: selectedModelItem?.providerId ?? null,
                  modelId: selectedModelItem?.id ?? null,
                  enabled: true,
                },
                newIdempotencyKey(),
              ),
            ),
          );
          const persistedTeam = await createPersistedTeam(
            {
              name: customTeam.name,
              description: customTeam.description,
              leaderAssistantId: persistedAssistants[0]!.id,
              members: [
                { assistantId: persistedAssistants[0]!.id, role: 'coach', roleLabel: 'Concept coach' },
                { assistantId: persistedAssistants[1]!.id, role: 'teammate', roleLabel: 'Sandbox guide' },
                { assistantId: persistedAssistants[2]!.id, role: 'reviewer', roleLabel: 'Review mentor' },
              ],
              workspaceMode: 'shared',
              sessionMode: 'supervised',
              concurrencyLimit: 3,
              enabled: true,
            },
            newIdempotencyKey(),
          );
          const persistedTeamPreview = {
            ...customTeam,
            id: persistedTeam.id,
            leaderAssistantId: persistedAssistants[0]!.id,
            members: customTeam.members.map((member, index) => ({
              ...member,
              assistantId: persistedAssistants[index]!.id,
            })),
          };
          await refreshAssistantCatalog();
          toolSteps = [
            { name: 'create_team_assistants', status: 'done', label: `Created and registered 3 team assistants` },
            { name: 'team_orchestrator', status: 'done', label: `Built team: ${customTeam.name}` },
            { name: 'pbl_gate_validator', status: 'done', label: 'TheoryMastered gate validated by the server contract' },
            { name: 'persist_team_registry', status: 'done', label: 'Team and assistant records persisted and re-read' },
          ];
          replyContent = `Team assistants (**${coachAsst.name}**, **${guideAsst.name}**, **${reviewerAsst.name}**) and team **${customTeam.name}** were created in the server registry.

Open **[Settings > AI assistants](/settings/assistants)** or **[Settings > Teams](/settings/teams)** to verify the returned records.`;
          artifact = {
            type: 'team',
            title: `Generated PBL team: ${customTeam.name}`,
            details: 'Server confirmed the team and all three assistant records',
            jsonPreview: JSON.stringify({ team: persistedTeamPreview, createdAssistants: persistedAssistants }, null, 2),
          };
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'server response error';
          toolSteps = [
            { name: 'create_team_assistants', status: 'error', label: `Team persistence failed: ${reason}` },
          ];
          replyContent = `A team draft (**${customTeam.name}**) was prepared, but the server did not confirm the complete team write. No success state is shown.

Failure reason: ${reason}

If some assistant records were created before the failure, review them in **[Settings > AI assistants](/settings/assistants)** before retrying.`;
          artifact = {
            type: 'team',
            title: `Team draft: ${customTeam.name}`,
            details: `Server persistence failed; this draft is only in the current conversation: ${reason}`,
            jsonPreview: JSON.stringify({ team: customTeam, createdAssistants: newAssistants }, null, 2),
          };
        }
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
          status: 'draft',
          latencyMs: null,
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
        toolSteps = [
          { name: 'mcp_json_schema_build', status: 'done', label: `Generated MCP draft: ${customMcp.name}` },
          { name: 'security_sandbox_audit', status: 'done', label: `Security policy checked (permission: ${runtimePermission})` },
          { name: 'persist_tool_matrix', status: 'error', label: 'MCP creation is unavailable from Copilot; nothing was persisted' },
        ];
        replyContent = `MCP draft **${customMcp.name}** is ready for review, but Copilot does not have a server MCP-create contract. It was not written to the runtime registry or localStorage.

Open **[Settings > MCP and tools](/settings/tools)** to configure it through the supported server flow.`;
        artifact = {
          type: 'mcp',
          title: `MCP draft: ${customMcp.name}`,
          details: 'Draft only; no runtime connection, binding, or persistence was claimed',
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
          boundAssistantIds: [],
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
        toolSteps = [
          { name: 'skill_ast_validator', status: 'done', label: `Validated draft SKILL.md and prompt structure: ${customSkill.name}` },
          { name: 'assistant_skill_binder', status: 'error', label: 'Runtime skill binding requires a canonical catalog id' },
          { name: 'persist_skill_registry', status: 'error', label: 'Skill content create API is unavailable from Copilot; nothing was persisted' },
        ];
        replyContent = `Skill draft **${customSkill.name}** was generated, but it remains a local conversation artifact. Copilot cannot create or bind runtime skill content, so no database/runtime success is claimed.

Use **[Settings > Skills](/settings/skills)** to select a canonical runtime skill and save its binding.`;
        artifact = {
          type: 'skill',
          title: `Skill draft: ${customSkill.name}`,
          details: 'Draft only; no runtime skill id was bound and no persistence was attempted',
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
          linkedTeamId: null,
          phases: [
            { id: 'p1', name: '意图确认与选题', gateRule: '学生明确目标与预期成果', stagePrompt: '启发学生提出假设', mentorRole: '总导师' },
            { id: 'p2', name: '核心理论推导与考核 (TheoryMastered)', gateRule: '达标85%以上通过概念闭环', stagePrompt: '苏格拉底追问推导', mentorRole: '概念教练' },
            { id: 'p3', name: '工程仿真与实验制作', gateRule: '沙箱验证通过', stagePrompt: '指导编程与数据拟合', mentorRole: '沙箱向导' },
            { id: 'p4', name: '结项答辩与成长建档', gateRule: '完成答辩量规', stagePrompt: '概念盲区追问', mentorRole: '评审导师' },
          ],
        };
        toolSteps = [
          { name: 'template_schema_compiler', status: 'done', label: `Compiled PBL draft stages and gates: ${customTpl.title}` },
          { name: 'persist_template_store', status: 'error', label: 'Template publishing is unavailable from Copilot; nothing was persisted' },
        ];
        replyContent = `PBL template draft **${customTpl.title}** was generated, but it was not published to the template library. Copilot has no frozen template/version write flow here, so it cannot claim a server success.

Use **[Settings > Project templates](/settings/templates)** to create and publish a version through the supported API.`;
        artifact = {
          type: 'template',
          title: `PBL template draft: ${customTpl.title}`,
          details: 'Draft only; no template version, team binding, or publication was persisted',
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
          chunksCount: 0,
          status: 'draft',
          content: `由启途智学管家生成：${userText}\n\n该文档已建立向量切片索引，支持各学科导师在苏格拉底提问时实时召回。`,
          updatedAt: new Date().toISOString(),
        };
        toolSteps = [
          { name: 'rag_vector_embed', status: 'error', label: 'No knowledge base/source was selected; embedding was not run' },
          { name: 'persist_knowledge_base', status: 'error', label: 'Knowledge document create API requires a bound base; nothing was persisted' },
        ];
        replyContent = `Knowledge document draft **${customDoc.title}** was prepared, but it was not indexed or saved. Copilot cannot choose a knowledge base on the client or claim vectorization without a server job.

Open **[Settings > Knowledge](/settings/knowledge)**, select a bound base, and upload/create the source there.`;
        artifact = {
          type: 'knowledge',
          title: `Knowledge document draft: ${customDoc.title}`,
          details: 'Draft only; no chunks, vector index, or knowledge-base record was persisted',
          jsonPreview: JSON.stringify(customDoc, null, 2),
        };
      } else {
        const lowerText = userText.toLowerCase();
        const activeModelLabel = selectedModelItem?.id ?? (selectedModel || '平台默认模型');

        toolSteps = [
          { name: 'intent_analysis', status: 'done', label: `意图识别与语义解析（思考强度: ${thinkingStrength}）` },
          { name: 'qitu_agent_sdk_scan', status: 'done', label: `调取启途智学平台治理规范与知识系统（当前底座: ${activeModelLabel}）` },
        ];

        if (lowerText.includes('模型') || lowerText.includes('默认') || lowerText.includes('model')) {
          replyContent = `### 启途智学模型配置与默认模型记忆机制

#### 1. 默认模型怎么配置？
在启途智学中，模型采用**按用途统一收口**的架构：
- **平台全局默认模型**：前往 **[设置 > 模型通道与用途路由](/settings/model-providers)**。在「**模型用途场景分发与链路绑定**」面板中，将核心用途 **\`tutor.chat\`（AI搭档 · 对话）** 绑定为您期望的供应商与模型。所有未单独配置专属模型的助手均会自动继承此默认模型。
- **助手专属模型**：前往 **[设置 > AI 助手](/settings/assistants)**，编辑特定助手，可在其配置中单独覆盖底座模型；若未配置则跟随全局默认用途。

#### 2. 上次使用的模型如何作为启动默认模型？
- **实现原理**：在客户端通过 \`localStorage\` 针对用户选择的 \`[providerId, modelId]\` 唯一标识进行持久化存储（存储键：\`qitu.admin.copilot.selected_model.v1\`）。
- **启动恢复机制**：
  1. 页面加载或刷新时，初始化状态优先读取本地缓存的上次使用模型。
  2. 运行时从服务端拉取可用模型目录后，核验该模型依然有效即保持选中状态，**刷新网页后选择的模型不会被重置**。
  3. 用户在顶部切换模型时，实时同步写入缓存，实现“记住上次选择，下次启动即默认”。

您目前已选中的底座模型为：**${activeModelLabel}**（思考强度：**${thinkingStrength}**）。`;
        } else if (lowerText.includes('pbl') || lowerText.includes('项目') || lowerText.includes('流程') || lowerText.includes('教学')) {
          replyContent = `### 启途智学 PBL 项目式学习核心架构

我是**启途智学管家**，平台遵循“真实任务驱动 + 探究证据链 + 双循环教学策略”：

1. **四阶段探究流**：
   - **阶段一：意图确认与选题**（学生明确探索意图，未确认前不创建正式项目）
   - **阶段二：核心理论推导**（必须通过 **\`TheoryMastered\`** 概念门禁，才允许进入实践）
   - **阶段三：工程仿真与实验制作**（安全沙箱编程、物理微观仿真如单缝衍射/细雾室散射）
   - **阶段四：结项答辩与成长建档**（基于 CER 证据模型与多维量规的形成性评价）

2. **多智能体协作小队**：
   - **概念教练（Coach）**：严格遵循苏格拉底发问，启发学生推导物理/科学规律，坚决不直接给答案。
   - **实践向导（Guide）**：指导沙箱代码自检与实验参数调试，提供梯级提示脚手架。
   - **评审导师（Reviewer）**：基于项目量规审核交付物，引导误差溯源与反思。

您可以直接对我输入：
- “**为高中物理力学创建一个探究团队**” -> 一键生成并持久化 3 位角色导师及关联团队；
- “**创建一个化学平衡移动探究助手**” -> 自动生成并持久化遵循苏格拉底教学法的智能体。`;
        } else {
          replyContent = `你好！我是**启途智学管家**。我不仅能为您提供平台规则、PBL 教学设计、模型调配等专业咨询，还能直接执行平台资源的创建与调度：

1. **创建助手**：例如输入“*创建一个高中物理力学启发导师*”或“*创建代码实践助手*”；
2. **组建团队**：例如输入“*为雷霆战机小游戏组建导师团队*”；
3. **配置 MCP 工具**：例如输入“*配置一个 Python 绘图 MCP 工具*”；
4. **定制 Skills 技能包**：例如输入“*创建一个苏格拉底深度启发技能包*”；
5. **设计 PBL 模板与知识库**：例如输入“*为动能定理设计项目模板*”。

当前使用的底座模型为 **${activeModelLabel}**（思考强度: **${thinkingStrength}**），该选择已在本地自动记忆，刷新网页后不会丢失。请问您需要处理哪项任务？`;
        }
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
          title="启途智学管家会话（已折叠）"
          style={{
            width: '60px',
            background: 'rgba(255, 255, 255, 0.92)',
            backdropFilter: 'blur(12px)',
            borderRight: '1px solid #e4ecf7',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '12px 0',
            flexShrink: 0,
            transition: 'all 0.2s ease',
          }}
        >
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed(false)}
            title="展开启途管家会话侧边栏"
            style={{
              width: '40px',
              height: '40px',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '10px',
              color: '#2563eb',
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ▶
          </button>
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#94a3b8', margin: '8px 0 6px', flexShrink: 0 }}>
            {sessions.length}
          </div>
          <div
            style={{
              flex: 1,
              width: '100%',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              padding: '2px 0 8px',
              minHeight: 0,
            }}
          >
            {sessions.length === 0 ? (
              <div
                style={{
                  writingMode: 'vertical-rl',
                  fontSize: '11px',
                  color: '#94a3b8',
                  letterSpacing: '0.1em',
                  marginTop: '8px',
                }}
              >
                暂无会话
              </div>
            ) : (
              sessions.map((sess) => {
                const isActive = sess.id === currentSessionId;
                const isHover = collapsedHoverId === sess.id;
                return (
                  <button
                    key={sess.id}
                    type="button"
                    title={sess.title}
                    onClick={() => setCurrentSessionId(sess.id)}
                    onMouseEnter={() => setCollapsedHoverId(sess.id)}
                    onMouseLeave={() => setCollapsedHoverId((prev) => (prev === sess.id ? null : prev))}
                    style={{
                      width: '40px',
                      height: '40px',
                      flexShrink: 0,
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontSize: '15px',
                      fontWeight: isActive ? 700 : 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'background 0.15s ease, border-color 0.15s ease',
                      background: isActive ? '#eff6ff' : isHover ? '#f1f5f9' : '#ffffff',
                      border: isActive ? '1px solid #2563eb' : isHover ? '1px solid #bfdbfe' : '1px solid #e4ecf7',
                      color: isActive ? '#1d4ed8' : '#475569',
                      boxShadow: isActive ? '0 1px 2px rgba(37,99,235,0.15)' : 'none',
                    }}
                  >
                    {sess.title.trim() ? sess.title.trim().charAt(0) : '💬'}
                  </button>
                );
              })
            )}
          </div>
          <button
            type="button"
            onClick={handleCreateSession}
            title="新建管理会话"
            style={{
              width: '40px',
              height: '40px',
              flexShrink: 0,
              background: '#2563eb',
              border: 'none',
              borderRadius: '10px',
              color: '#ffffff',
              fontSize: '18px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 1px 2px rgba(37,99,235,0.2)',
              marginTop: '8px',
            }}
          >
            +
          </button>
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
                <span style={{ fontSize: '18px' }}><RobotMascot size={22} decorative /></span> 启途智学管家
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
              <span style={{ fontSize: '12px', color: '#1d4ed8', fontWeight: 700 }}><RobotMascot size={18} decorative /> 交互助手:</span>
              <select
                value={activeTestAssistant?.id ?? ''}
                aria-label="交互助手"
                disabled={!catalogReady || isGenerating}
                onChange={(e) => setSelectedAssistantId(e.target.value)}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#1e3a8a', fontWeight: 600, outline: 'none', cursor: 'pointer', maxWidth: '200px' }}
                title="选择在当前控制台中测试的助手角色"
              >
                {!catalogReady && <option value="">{assistantCatalog.kind === 'loading' ? '正在读取助手与团队…' : '暂无可选择的助手'}</option>}
                {assistantOptions.map((assistant) => (
                  <option key={assistant.id} value={assistant.id}>
                    {assistant.name}{assistant.role ? ` (${assistant.role})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '3px 8px' }}>
              <span style={{ fontSize: '12px', color: '#166534', fontWeight: 700 }}>团队:</span>
              <select
                value={selectedTeamId}
                aria-label="选择团队"
                disabled={assistantCatalog.kind !== 'ready' || isGenerating}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#166534', fontWeight: 600, outline: 'none', cursor: 'pointer', maxWidth: '260px' }}
                title="选择在当前控制台中使用的协作团队"
              >
                <option value="">不使用团队</option>
                {teamOptions.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({team.memberCount} 名启用助手)
                  </option>
                ))}
              </select>
            </div>

            {/* Thinking 强度 (参考 Pi Agent: Off / Normal / High / Max) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '3px 8px' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>🧠 思考强度:</span>
              <select
                value={thinkingStrength}
                onChange={(e) => handleThinkingChange(e.target.value as 'off' | 'normal' | 'high' | 'max')}
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
                onChange={(e) => handleModelChange(e.target.value)}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#0f172a', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
              >
                {availableModels.length > 0 ? (
                  availableModels.map((m) => (
                    <option key={configuredModelKey(m)} value={configuredModelKey(m)}>
                      {m.name || m.id}
                    </option>
                  ))
                ) : (
                  <option value="" disabled>暂无可用的已配置模型</option>
                )}
              </select>
            </div>

            {/* 权限设置 (参考 Codex 3 个权限: Read Only / Workspace Write / Full Access) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '3px 8px' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>🛡️ 权限:</span>
              <select
                value={runtimePermission}
                onChange={(e) => handlePermissionChange(e.target.value as 'read_only' | 'workspace_write' | 'full_access')}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#0f172a', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
              >
                <option value="full_access">Full Access (完全访问 · 免确认写入)</option>
                <option value="workspace_write">Workspace Write (工作区写入)</option>
                <option value="read_only">Read Only (只读安全模式)</option>
              </select>
            </div>

            <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: catalogReady ? '#16a34a' : '#64748b', marginLeft: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: catalogReady ? '#22c55e' : '#94a3b8', display: 'inline-block' }} />
              {catalogReady ? `助手目录已同步${activeTeam ? ` · 团队：${activeTeam.name}` : ''}` : '助手目录未就绪'}
            </span>
          </div>
        </div>

        {/* 助手切换提示横幅 */}
        {(catalogError || (assistantCatalog.kind === 'ready' && assistantOptions.length === 0)) && (
          <div role={catalogError ? 'alert' : 'status'} style={{ padding: '10px 24px', background: '#fff7ed', color: '#9a3412', fontSize: '13px' }}>
            {catalogError ?? '当前没有已启用的助手，请到 AI 助手设置中配置。'}
            <button type="button" onClick={() => { void refreshAssistantCatalog(); }} style={{ marginLeft: '12px' }}>重新读取目录</button>
          </div>
        )}

        {activeTestAssistant && selectedAssistantId !== 'qitu-assistant' && (
          <div style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', padding: '7px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#166534', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}><AssistantGlyph value={activeTestAssistant.icon} /></span>
              <strong>当前正在测试平台助手：【{activeTestAssistant.name}】</strong>
              <span style={{ color: '#15803d' }}>（角色：{activeTestAssistant.role} · 遵循自建 Agent SDK 教学与交互约束）</span>
            </div>
            <button
              type="button"
              disabled={!assistantOptions.some((assistant) => assistant.id === 'qitu-assistant')}
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
                    <RobotMascot size={28} decorative />
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
                              <RobotMascot size={18} decorative /> 查看创建的导师助手
                            </Link>
                          </>
                        )}
                        {msg.artifact.type === 'assistant' && (
                          <Link
                            href="/settings/assistants"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '5px 12px', background: '#2563eb', color: '#fff', borderRadius: '6px', textDecoration: 'none', fontWeight: 600 }}
                          >
                            <RobotMascot size={18} decorative /> 前往助手设置查看
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
                <RobotMascot size={28} decorative />
              </div>
              <div style={{ background: '#ffffff', padding: '12px 16px', borderRadius: '16px 16px 16px 2px', fontSize: '13px', color: '#64748b', border: '1px solid #e2e8f0' }}>
                启途管家正在利用 <strong>{selectedModelItem?.id ?? (selectedModel || 'server default')}</strong>（{thinkingStrength === 'max' || thinkingStrength === 'high' ? '深度推理' : '标准推理'}）执行分析...
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
              disabled={!inputMessage.trim() || isGenerating || !catalogReady}
              style={{
                height: '44px',
                padding: '0 20px',
                background: !inputMessage.trim() || isGenerating || !catalogReady ? '#94a3b8' : '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '13.5px',
                cursor: !inputMessage.trim() || isGenerating || !catalogReady ? 'not-allowed' : 'pointer',
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
