'use client';
import { ResizablePanels } from '@qitu/ui';

import { AssistantGlyph, RobotMascot } from '@qitu/ui';

import { useState, useEffect, useRef, useMemo } from 'react';
import { KnowledgeUpload } from '../../../lib/copilot/KnowledgeUpload';
import { useCopilotModel } from '../../../lib/copilot/use-copilot-model';
import { useAssistantCatalog } from '../../../lib/copilot/use-assistant-catalog';
import { resolveCopilotSelection, resolveCopilotTeamSelection } from '../../../lib/copilot/assistant-catalog';
import Link from 'next/link';
import { MarkdownRenderer } from './MarkdownRenderer';
import { configuredModelKey } from '../../../lib/api/configuredModels';
import type { AdminCopilotReceipt, AdminCopilotConfirmationRequest, AdminCopilotRequest } from '@qitu/contracts';
import { confirmCopilotTurn, runCopilotTurn } from '../../../lib/api/copilot';
import { useProjectCatalog } from '../../../lib/copilot/use-project-catalog';
import { useCopilotCapabilities } from '../../../lib/copilot/use-copilot-capabilities';
import { CopilotCapabilities } from './CopilotCapabilities';
import { newIdempotencyKey } from '../../../lib/api/modelRegistry';

// v2 intentionally avoids replaying pre-audit sessions that claimed persistence
// without a server acknowledgement. They remain in the old key for diagnostics.
// v3 intentionally drops pre-registry examples and stale local artifacts.
// Runtime entities are server-owned; old browser history must not resurrect a
// deleted team or disabled assistant in the copilot surface.
const COPILOT_SESSIONS_STORAGE_KEY = 'qitu.admin.copilot.sessions.v4';
const COPILOT_PERMISSION_STORAGE_KEY = 'qitu.admin.copilot.permission.v1';

interface ToolExecutionStep {
  name: string;
  status: 'running' | 'done' | 'error' | 'pending' | 'cancelled';
  label: string;
  input?: Record<string, unknown> | unknown;
  output?: Record<string, unknown> | unknown;
  detail?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolSteps?: ToolExecutionStep[];
  pendingDeletions?: AdminCopilotReceipt[];
  confirmationRequest?: { request: AdminCopilotRequest; key: string; startedAt: number };
  retry?: { request: AdminCopilotRequest; key: string; startedAt: number };
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
  templateId?: string | null;
  templateVersionId?: string | null;
}

const QUICK_PROMPTS = [
  {
    icon: '🔍',
    title: '平台全局健康检查',
    desc: '检查全局助手、底座模型、运行时技能及知识库配置，说明哪些已启用就绪。',
    prompt: '检查全局助手、底座模型、技能及知识库配置，说明哪些已启用。',
  },
  {
    icon: '👥',
    title: '导师团队与角色分析',
    desc: '查看当前导师团队配置与角色分配，分析技能覆盖完整度与可用性。',
    prompt: '查看当前导师团队配置与角色分配，分析技能覆盖完整度。',
  },
  {
    icon: '📚',
    title: 'PBL 教学模板核查',
    desc: '检查当前模板的课时、团队与技能绑定，列出需要补齐的配置项。',
    prompt: '检查当前选中的 PBL 教学模板的课时、团队与技能绑定，列出需要补齐的配置。',
  },
  {
    icon: '🛡️',
    title: '知识库与授权范围审计',
    desc: '排查当前绑定的知识库资源与授权范围，校验已挂载的教材文档与索引。',
    prompt: '检查当前绑定的知识库资源与授权范围，排查未挂载文档与索引状态。',
  },
];

const INITIAL_SESSIONS: Session[] = [
  {
    id: 'sess-default',
    title: '新对话',
    updatedAt: 'just now',
    messages: [
      {
        id: 'msg-1',
        role: 'system',
        content: '启途智学管家可在全局范围管理平台资源，也可围绕选中的项目模板进行配置。可执行操作以核验后的技能目录为准，保存、校验和启用分别提供服务端回执。',
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
  const { availableModels, selectedModel, modelError, modelSaving, modelLoading, modelIsDefault, modelNotice, handleModelChange, reloadModels } = useCopilotModel();
  const [runtimePermission, setRuntimePermission] = useState<'read_only' | 'full_access'>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem(COPILOT_PERMISSION_STORAGE_KEY);
        if (cached && ['read_only', 'full_access'].includes(cached)) {
          return cached as 'read_only' | 'full_access';
        }
      } catch {}
    }
    return 'read_only';
  });
  const [selectedAssistantId, setSelectedAssistantId] = useState<string>('qitu-assistant');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [thinkingStrength, setThinkingStrength] = useState<'off' | 'normal' | 'high' | 'max'>('high');
  const { state: assistantCatalog, error: catalogError, refresh: refreshAssistantCatalog } = useAssistantCatalog();
  const capabilities = useCopilotCapabilities();
  const selectedModelItem = availableModels.find((model) => configuredModelKey(model) === selectedModel) ?? null;
  const assistantOptions = useMemo(() => assistantCatalog.kind === 'ready' ? assistantCatalog.catalog.assistants : [], [assistantCatalog]);
  const teamOptions = useMemo(() => assistantCatalog.kind === 'ready' ? assistantCatalog.catalog.teams : [], [assistantCatalog]);
  const activeTestAssistant = assistantOptions.find((assistant) => assistant.id === selectedAssistantId);
  const activeTeam = teamOptions.find((team) => team.id === selectedTeamId);
  const catalogReady = assistantCatalog.kind === 'ready' && activeTestAssistant !== undefined;

  const handlePermissionChange = (perm: 'read_only' | 'full_access') => {
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
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(COPILOT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
      } catch {
        // quota guard
      }
    }
  }, [sessions]);

  const activeSession = sessions.find((s) => s.id === currentSessionId) ?? sessions[0]!;
  const scope = activeSession.templateId ? 'selected_template' as const : 'global' as const;
  const projectCatalog = useProjectCatalog(activeSession.templateId ?? null);
  const setProject = (templateId: string | null, templateVersionId: string | null) => {
    setSessions(previous => previous.map(session => session.id === activeSession.id
      ? { ...session, templateId, templateVersionId } : session));
  };
  useEffect(() => {
    if (!projectCatalog.loading && !projectCatalog.error && activeSession.templateId && !activeSession.templateVersionId) {
      const first = projectCatalog.versions[0];
      if (first) setProject(activeSession.templateId, first.id);
    }
  }, [projectCatalog.loading, projectCatalog.error, projectCatalog.versions, activeSession.id, activeSession.templateId, activeSession.templateVersionId]);
  const requestInFlight = useRef(false);


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

  const performTurn = async (
    sessionId: string,
    retry: NonNullable<Message['retry']>,
    decision?: Pick<AdminCopilotConfirmationRequest, 'actionId' | 'confirmationId' | 'decision'>,
    existingMessageId?: string
  ) => {
    if (requestInFlight.current || !capabilities.ready) return;
    requestInFlight.current = true;
    setIsGenerating(true);

    try {
      if (Date.now() - retry.startedAt > 23 * 60 * 60 * 1000) {
        throw new Error('本轮重试期限已过，请先核对资源状态，再发起新指令。');
      }

      const result = decision
        ? await confirmCopilotTurn({ request: retry.request, turnKey: retry.key, ...decision })
        : await runCopilotTurn(retry.request, retry.key);

      // 构建工具执行步骤（默认折叠、成功绿色、失败红色、支持查看输入输出详情）
      let toolSteps: ToolExecutionStep[] = [];
      if (result.receipts && result.receipts.length > 0) {
        toolSteps = result.receipts.map((receipt) => {
          const isSucceeded = receipt.status === 'succeeded';
          const isFailed = receipt.status === 'failed' || receipt.status === 'blocked';
          const isPending = receipt.status === 'awaiting_confirmation';
          const isCancelled = receipt.status === 'cancelled';
          return {
            name: receipt.kind,
            label: receipt.label,
            status: isSucceeded ? 'done' : isFailed ? 'error' : isPending ? 'pending' : isCancelled ? 'cancelled' : 'error',
            input: receipt.input ?? {},
            output: receipt.result ?? (receipt.confirmation ? { confirmation: receipt.confirmation } : { code: receipt.code, message: receipt.message }),
            detail: JSON.stringify(receipt.result ?? { code: receipt.code, message: receipt.message }, null, 2),
          };
        });
      } else {
        // 无写操作的查询类指令：记录后台环境探测与推理步骤，让用户明确知晓 Agent 背景工作
        toolSteps = [
          {
            name: 'context.inspect',
            label: '读取平台配置与权限范围',
            status: 'done',
            input: {
              scope: retry.request.scope,
              templateId: retry.request.templateId,
              assistantId: retry.request.assistantId,
              teamId: retry.request.teamId,
              model: `${retry.request.modelProviderId} / ${retry.request.modelId}`,
              permission: retry.request.permission,
            },
            output: {
              status: result.status,
              scope: result.scope,
              actionsCount: 0,
              mode: retry.request.permission === 'full_access' ? '配置模式 (可修改资源)' : '只读分析模式',
            },
            detail: JSON.stringify({ status: result.status, scope: result.scope }, null, 2),
          },
          {
            name: 'agent.reasoning',
            label: '智能推理与策略解答生成',
            status: 'done',
            input: {
              userMessage: retry.request.message,
              contextTurns: retry.request.history?.length ?? 0,
            },
            output: {
              status: 'succeeded',
              replyLength: result.reply.length,
            },
            detail: JSON.stringify({ replyLength: result.reply.length }, null, 2),
          },
        ];
      }

      // 产物卡片自动识别
      let artifact: Message['artifact'] = undefined;
      const teamReceipt = result.receipts?.find(r => r.kind === 'team.create' && r.status === 'succeeded');
      const asstReceipt = result.receipts?.find(r => r.kind === 'assistant.create' && r.status === 'succeeded');
      const mcpReceipt = result.receipts?.find(r => r.kind === 'mcp.register' && r.status === 'succeeded');
      const skillReceipt = result.receipts?.find(r => r.kind === 'skill.create' && r.status === 'succeeded');
      if (teamReceipt) {
        artifact = {
          type: 'team',
          title: `导师团队已创建：${(teamReceipt.result as any)?.name ?? teamReceipt.label}`,
          details: '团队已录入平台，可在团队设置中进一步调整角色与课时绑定。',
          jsonPreview: JSON.stringify(teamReceipt.result, null, 2),
        };
      } else if (asstReceipt) {
        artifact = {
          type: 'assistant',
          title: `AI 助手已创建：${(asstReceipt.result as any)?.name ?? asstReceipt.label}`,
          details: '助手已录入平台目录，可在助手设置中配置其技能与权限。',
          jsonPreview: JSON.stringify(asstReceipt.result, null, 2),
        };
      } else if (mcpReceipt) {
        artifact = {
          type: 'mcp',
          title: `MCP 工具服务已登记：${(mcpReceipt.result as any)?.name ?? mcpReceipt.label}`,
          details: '工具服务已成功注册，平台助手可按需调用该工具。',
          jsonPreview: JSON.stringify(mcpReceipt.result, null, 2),
        };
      } else if (skillReceipt) {
        artifact = {
          type: 'skill',
          title: `技能已登记：${(skillReceipt.result as any)?.name ?? skillReceipt.label}`,
          details: '运行时技能已就绪，可在技能矩阵中绑定给团队或助手。',
          jsonPreview: JSON.stringify(skillReceipt.result, null, 2),
        };
      }

      const assistantMessage: Message = {
        id: existingMessageId ?? newIdempotencyKey(),
        role: 'assistant',
        content: result.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        toolSteps,
        retry: result.status === 'partial' ? retry : undefined,
        pendingDeletions: result.receipts?.filter(receipt => receipt.status === 'awaiting_confirmation'),
        confirmationRequest: result.status === 'awaiting_confirmation' ? retry : undefined,
        artifact,
      };

      setSessions(previous => previous.map(session => {
        if (session.id !== sessionId) return session;
        if (existingMessageId) {
          return {
            ...session,
            messages: session.messages.map(m => m.id === existingMessageId ? assistantMessage : m),
          };
        }
        return {
          ...session,
          messages: [...session.messages, assistantMessage],
        };
      }));

      const versionReceipt = result.receipts.slice().reverse().find(r => r.kind === 'template.version' && r.status === 'succeeded');
      const createdTemplate = result.receipts.slice().reverse().find(r => r.kind === 'template.create' && r.status === 'succeeded');
      const saved = versionReceipt?.result as { id?: string; templateId?: string } | undefined;
      const created = createdTemplate?.result as { id?: string } | undefined;
      if (saved?.id && saved.templateId) setSessions(previous => previous.map(s => s.id === sessionId ? { ...s, templateId: saved.templateId!, templateVersionId: saved.id! } : s));
      else if (created?.id) setSessions(previous => previous.map(s => s.id === sessionId ? { ...s, templateId: created.id!, templateVersionId: null } : s));
      await refreshAssistantCatalog();
      projectCatalog.refresh();
      capabilities.refresh();
      await reloadModels();
    } catch (error) {
      const errorMessage: Message = {
        id: existingMessageId ?? newIdempotencyKey(),
        role: 'assistant',
        content: `请求未完成：${error instanceof Error ? error.message : '服务器不可用'}。可使用下方按钮重试同一操作。`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        retry,
        toolSteps: [
          {
            name: 'turn.execute',
            label: '执行管家请求',
            status: 'error',
            input: {
              message: retry.request.message,
              scope: retry.request.scope,
            },
            output: {
              error: error instanceof Error ? error.message : '未知错误',
            },
            detail: error instanceof Error ? error.stack : undefined,
          },
        ],
      };

      setSessions(previous => previous.map(session => {
        if (session.id !== sessionId) return session;
        if (existingMessageId) {
          return {
            ...session,
            messages: session.messages.map(m => m.id === existingMessageId ? errorMessage : m),
          };
        }
        return {
          ...session,
          messages: [...session.messages, errorMessage],
        };
      }));
    } finally {
      requestInFlight.current = false;
      setIsGenerating(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isGenerating || modelSaving || modelLoading || modelError || !catalogReady || !capabilities.ready || !selectedModelItem || projectCatalog.loading || projectCatalog.error) return;
    const content = inputMessage.trim();
    const sessionId = activeSession.id;
    const request: AdminCopilotRequest = {
      message: content,
      scope,
      history: activeSession.messages.filter((m): m is Message & { role: 'user' | 'assistant' } => m.role !== 'system')
        .slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 6000) })),
      templateId: activeSession.templateId ?? null, templateVersionId: activeSession.templateVersionId ?? null,
      assistantId: selectedAssistantId, teamId: selectedTeamId || null,
      modelProviderId: selectedModelItem.providerId, modelId: selectedModelItem.id, permission: runtimePermission,
    };
    const retry = { request, key: newIdempotencyKey(), startedAt: Date.now() };
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setSessions(previous => previous.map(session => session.id !== sessionId ? session : {
      ...session,
      title: session.messages.some(m => m.role === 'user') ? session.title : content.slice(0, 24),
      updatedAt: '刚刚',
      messages: [...session.messages, { id: newIdempotencyKey(), role: 'user', content, timestamp }],
    }));
    setInputMessage('');
    await performTurn(sessionId, retry);
  };

  return (
    <div className="copilot-page" style={{
      display: 'flex',
      height: '100%',
      width: '100%',
      margin: 0,
      overflow: 'hidden',
      background: 'radial-gradient(900px 520px at 8% -10%, rgb(30 79 217 / 10%), transparent 62%), radial-gradient(760px 500px at 108% 110%, rgb(111 250 208 / 12%), transparent 58%), linear-gradient(135deg, #f8faff 0%, #faf8ff 48%, #effcf8 100%)'
    }}>
      <ResizablePanels storageKey="admin-copilot" className="copilot-columns" initialSizes={[24, 76]} minWidths={[220, 400]}
        fixedWidths={[isSidebarCollapsed ? 60 : null, null]} labels={['管理会话', '管家对话']}>
      {/* 1. 左侧会话列表与管理（支持折叠） */}
      {isSidebarCollapsed ? (
        <aside
          className="copilot-sidebar is-collapsed"
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
          className="copilot-sidebar"
          style={{
            width: '100%',
            height: '100%',
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(12px)',
            borderRight: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          <div style={{ padding: '16px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <RobotMascot size={22} decorative /> 启途智学管家
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
                    padding: '2px 4px',
                    borderRadius: '4px',
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
                padding: '9px 12px',
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
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
                boxShadow: '0 2px 4px rgba(37,99,235,0.2)',
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span> 新建管理会话
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', padding: '4px 8px', letterSpacing: '0.05em' }}>
              会话历史 ({sessions.length})
            </div>
            {sessions.map((sess) => {
              const isActive = sess.id === currentSessionId;
              return (
                <div
                  key={sess.id}
                  className={`copilot-session-item ${isActive ? 'is-active' : ''}`}
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
          <div className="copilot-settings-jump-box" style={{ padding: '12px 14px', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <div className="copilot-settings-jump-title" style={{ color: '#64748b', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>⚙️</span> 快速配置导航
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <Link className="copilot-settings-jump-link" href="/settings/assistants" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', height: '30px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '11.5px', fontWeight: 600, color: '#334155', textDecoration: 'none', transition: 'all 0.15s' }}>
                <span>🤖</span> AI 助手
              </Link>
              <Link className="copilot-settings-jump-link" href="/settings/teams" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', height: '30px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '11.5px', fontWeight: 600, color: '#334155', textDecoration: 'none', transition: 'all 0.15s' }}>
                <span>👥</span> 导师团队
              </Link>
              <Link className="copilot-settings-jump-link" href="/settings/tools" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', height: '30px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '11.5px', fontWeight: 600, color: '#334155', textDecoration: 'none', transition: 'all 0.15s' }}>
                <span>🔧</span> 工具与MCP
              </Link>
              <Link className="copilot-settings-jump-link" href="/settings/templates" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', height: '30px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '11.5px', fontWeight: 600, color: '#334155', textDecoration: 'none', transition: 'all 0.15s' }}>
                <span>📚</span> PBL模板
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* 2. 中间 Agent 交互流 */}
      <div className="copilot-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
        {/* 顶部控制命令台 */}
        <div className="copilot-toolbar" style={{ background: 'rgba(255, 255, 255, 0.98)', borderBottom: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', padding: '10px 24px', gap: '8px', flexShrink: 0 }}>
          {/* 状态与当前会话概览行 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {isSidebarCollapsed && (
                <button
                  type="button"
                  className="copilot-expand-btn"
                  onClick={() => setIsSidebarCollapsed(false)}
                  title="展开侧边栏"
                  style={{
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    color: '#334155',
                    fontWeight: 600,
                  }}
                >
                  📁 会话列表
                </button>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>{activeSession.title}</span>
                <span style={{
                  fontSize: '11.5px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: scope === 'global' ? '#f1f5f9' : '#eff6ff',
                  color: scope === 'global' ? '#475569' : '#1d4ed8',
                  border: '1px solid',
                  borderColor: scope === 'global' ? '#e2e8f0' : '#bfdbfe',
                }}>
                  {scope === 'global' ? '🌐 全局配置' : '📑 模板专有'}
                </span>
                <span style={{ fontSize: '12px', color: '#64748b' }}>· 执行结果以服务端回执为准</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: catalogReady ? '#16a34a' : '#64748b' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: catalogReady ? '#22c55e' : '#94a3b8', display: 'inline-block' }} />
                {catalogReady ? `助手目录已同步${activeTeam ? ` · 团队：${activeTeam.name}` : ''}` : '助手目录未就绪'}
              </span>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                {modelLoading ? '正在读取默认模型…' : modelSaving ? '正在保存默认模型…' : modelNotice || ''}
              </span>
            </div>
          </div>

          {/* 统一控制药丸货架 (统一高度 32px，一致边框与背景) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '4px' }}>
            {/* 范围选择 */}
            <div className="copilot-control-pill copilot-control-scope" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '32px', padding: '0 10px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              <span className="copilot-control-label" style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>🌐 范围:</span>
              <select
                className="copilot-control-select"
                aria-label="选择已有项目"
                value={activeSession.templateId ?? ''}
                disabled={isGenerating || projectCatalog.loading}
                onChange={event => setProject(event.target.value || null, null)}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#0f172a', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
              >
                <option value="">全局配置</option>
                {projectCatalog.templates.map(t => <option key={t.id} value={t.id}>{t.title} · {t.status}</option>)}
              </select>
            </div>

            {/* 版本选择（若选中模板） */}
            {activeSession.templateId && (
              <div className="copilot-control-pill copilot-control-version" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '32px', padding: '0 10px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                <span className="copilot-control-label" style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>📑 版本:</span>
                <select
                  className="copilot-control-select"
                  aria-label="选择项目版本"
                  value={activeSession.templateVersionId ?? ''}
                  disabled={isGenerating || projectCatalog.loading}
                  onChange={event => setProject(activeSession.templateId ?? null, event.target.value || null)}
                  style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#0f172a', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
                >
                  <option value="">{projectCatalog.loading ? '正在读取…' : '暂无版本'}</option>
                  {projectCatalog.versions.map(v => <option key={v.id} value={v.id}>{v.version} · {v.status}</option>)}
                </select>
              </div>
            )}

            {/* 工作与测试助手选择 */}
            <div className="copilot-control-pill copilot-control-assistant" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '32px', padding: '0 10px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              <span className="copilot-control-label" style={{ fontSize: '12px', color: '#1d4ed8', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <RobotMascot size={16} decorative /> 交互助手:
              </span>
              <select
                className="copilot-control-select"
                value={activeTestAssistant?.id ?? ''}
                aria-label="交互助手"
                disabled={assistantCatalog.kind !== 'ready' || assistantOptions.length === 0 || isGenerating}
                onChange={(e) => setSelectedAssistantId(e.target.value)}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#1e3a8a', fontWeight: 600, outline: 'none', cursor: 'pointer', maxWidth: '180px' }}
                title="选择在当前控制台中测试的助手角色"
              >
                {assistantCatalog.kind === 'loading' && <option value="">正在读取助手与团队…</option>}
                {assistantCatalog.kind === 'ready' && assistantOptions.length === 0 && <option value="">暂无可选择的助手</option>}
                {assistantCatalog.kind === 'ready' && assistantOptions.length > 0 && !activeTestAssistant && <option value="">请选择助手</option>}
                {assistantOptions.map((assistant) => (
                  <option key={assistant.id} value={assistant.id}>
                    {assistant.name}{assistant.role ? ` (${assistant.role})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* 团队选择 */}
            <div className="copilot-control-pill copilot-control-team" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '32px', padding: '0 10px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              <span className="copilot-control-label" style={{ fontSize: '12px', color: '#166534', fontWeight: 700 }}>👥 团队:</span>
              <select
                className="copilot-control-select"
                value={selectedTeamId}
                aria-label="选择团队"
                disabled={assistantCatalog.kind !== 'ready' || isGenerating}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#166534', fontWeight: 600, outline: 'none', cursor: 'pointer', maxWidth: '200px' }}
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

            {/* 底座模型选择 */}
            <div className="copilot-control-pill copilot-control-model" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '32px', padding: '0 10px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              <span className="copilot-control-label" style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>◈ 模型:</span>
              <select
                className="copilot-control-select"
                value={selectedModel}
                aria-label="管家默认模型"
                disabled={!availableModels.length || isGenerating || modelSaving || modelLoading}
                onChange={(e) => void handleModelChange(e.target.value)}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#0f172a', fontWeight: 600, outline: 'none', cursor: 'pointer', maxWidth: '210px' }}
              >
                <option value="" disabled>请选择默认模型</option>
                {availableModels.length > 0 ? (
                  availableModels.map((m) => (
                    <option key={configuredModelKey(m)} value={configuredModelKey(m)}>
                      {m.providerName} / {m.name || m.id}
                    </option>
                  ))
                ) : (
                  <option value="" disabled>暂无可用的已配置模型</option>
                )}
              </select>
              {!modelIsDefault && selectedModel && (
                <button
                  type="button"
                  disabled={isGenerating || modelSaving || modelLoading}
                  onClick={() => void handleModelChange(selectedModel)}
                  style={{
                    background: '#eff6ff',
                    color: '#2563eb',
                    border: '1px solid #bfdbfe',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  设为默认
                </button>
              )}
            </div>

            {/* Thinking 思考强度 */}
            <div className="copilot-control-pill copilot-control-thinking" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '32px', padding: '0 10px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              <span className="copilot-control-label" style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>🧠 思考:</span>
              <select
                className="copilot-control-select"
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

            {/* 权限设置 */}
            <div className="copilot-control-pill copilot-control-permission" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '32px', padding: '0 10px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
              <span className="copilot-control-label" style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>🛡️ 权限:</span>
              <select
                className="copilot-control-select"
                value={runtimePermission}
                onChange={(e) => handlePermissionChange(e.target.value as 'read_only' | 'full_access')}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#0f172a', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
              >
                <option value="full_access">配置模式 (可修改资源)</option>
                <option value="read_only">只读模式 (分析建议)</option>
              </select>
            </div>
          </div>
        </div>

        {/* 知识库上传与操作能力折叠区 */}
        <KnowledgeUpload
          enabled={scope === 'global' && runtimePermission === 'full_access' && !isGenerating}
          onSaved={content => setSessions(previous => previous.map(session => session.id !== currentSessionId ? session : {
            ...session, messages: [...session.messages, {
              id: newIdempotencyKey(),
              role: 'assistant',
              content,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              toolSteps: [{
                name: 'knowledge.upload',
                label: '上传知识库文档并挂载索引',
                status: 'done',
                input: { scope: 'global', action: 'knowledge.upload' },
                output: { status: 'succeeded', message: content },
                detail: content,
              }],
            }],
          }))}
        />
        <CopilotCapabilities data={capabilities.data} loading={capabilities.loading} error={capabilities.error} scope={scope} refresh={capabilities.refresh} />

        {/* 状态与告警栏 */}
        {(projectCatalog.loading || projectCatalog.error || modelLoading || modelError || (!selectedModelItem && !isGenerating)) && (
          <div role={projectCatalog.error || modelError ? 'alert' : 'status'} style={{ padding: '8px 24px', background: '#fff7ed', borderBottom: '1px solid #fed7aa', color: '#9a3412', fontSize: '12.5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>⚠️ {projectCatalog.error ?? modelError ?? (modelLoading ? '正在读取管家默认模型…' : projectCatalog.loading ? '正在读取已有项目…' : '没有可用模型，请先在模型设置中配置供应商与模型。')}</span>
            {projectCatalog.error && (
              <button onClick={projectCatalog.refresh} style={{ padding: '2px 8px', background: '#fff', border: '1px solid #fdba74', borderRadius: '4px', fontSize: '11.5px', color: '#9a3412', cursor: 'pointer', fontWeight: 600 }}>
                重读项目目录
              </button>
            )}
            {modelError && (
              <button type="button" disabled={modelSaving} onClick={() => void reloadModels()} style={{ padding: '2px 8px', background: '#fff', border: '1px solid #fdba74', borderRadius: '4px', fontSize: '11.5px', color: '#9a3412', cursor: 'pointer', fontWeight: 600 }}>
                重新加载模型
              </button>
            )}
          </div>
        )}

        {(catalogError || (assistantCatalog.kind === 'ready' && assistantOptions.length === 0)) && (
          <div role={catalogError ? 'alert' : 'status'} style={{ padding: '8px 24px', background: '#fff7ed', borderBottom: '1px solid #fed7aa', color: '#9a3412', fontSize: '12.5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>⚠️ {catalogError ?? '当前没有已启用的助手，请到 AI 助手设置中配置。'}</span>
            <button type="button" onClick={() => { void refreshAssistantCatalog(); }} style={{ padding: '2px 8px', background: '#fff', border: '1px solid #fdba74', borderRadius: '4px', fontSize: '11.5px', color: '#9a3412', cursor: 'pointer', fontWeight: 600 }}>
              重新读取目录
            </button>
          </div>
        )}

        {activeTestAssistant && selectedAssistantId !== 'qitu-assistant' && (
          <div className="copilot-team-banner" style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', padding: '8px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#166534', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}><AssistantGlyph value={activeTestAssistant.icon} /></span>
              <strong>当前正在测试平台助手：【{activeTestAssistant.name}】</strong>
              <span style={{ color: '#15803d' }}>（角色：{activeTestAssistant.role} · 单助手预览，团队作为配置上下文）</span>
            </div>
            <button
              type="button"
              className="copilot-team-banner-btn"
              disabled={!assistantOptions.some((assistant) => assistant.id === 'qitu-assistant')}
              onClick={() => setSelectedAssistantId('qitu-assistant')}
              style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: '4px', padding: '3px 10px', fontSize: '11.5px', color: '#166534', cursor: 'pointer', fontWeight: 600 }}
            >
              切回管家管理模式
            </button>
          </div>
        )}

        {/* 3. 消息流与空状态工作区 */}
        <div className="copilot-messages-container" style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* 当会话中没有用户发言时，展示精美的 AI 工作台英雄迎新卡与快捷操作卡 */}
          {!activeSession.messages.some((m) => m.role === 'user') ? (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '32px 24px',
              maxWidth: '100%',
              margin: 0,
              width: '100%',
            }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '20px',
                background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                border: '1px solid #bfdbfe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
                boxShadow: '0 8px 16px rgba(37,99,235,0.08)',
              }}>
                <RobotMascot size={42} decorative />
              </div>

              <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px', textAlign: 'center' }}>
                启途智学 AI 管家工作台
              </h2>

              <p style={{ fontSize: '13.5px', color: '#64748b', margin: '0 0 24px', textAlign: 'center', maxWidth: '100%', lineHeight: 1.6 }}>
                统一调度底层模型、校验运行时技能、配置导师团队与编排 PBL 教学资源。操作以核验后的技能目录为准，变更具有严格的服务端闭环回执。
              </p>

              {/* 4 个快捷操作引导卡片 */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '12px',
                width: '100%',
                marginBottom: '24px',
              }}>
                {QUICK_PROMPTS.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setInputMessage(item.prompt)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      padding: '14px 16px',
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#2563eb';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(37,99,235,0.08)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.02)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '18px' }}>{item.icon}</span>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{item.title}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                      {item.desc}
                    </div>
                  </button>
                ))}
              </div>

              {/* 系统安全审计提示 */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 16px',
                background: '#f1f5f9',
                border: '1px solid #e2e8f0',
                borderRadius: '999px',
                fontSize: '11.5px',
                color: '#475569',
              }}>
                <span>🔒</span>
                <span>{activeSession.messages.find(m => m.role === 'system')?.content || '启途智学管家可在全局范围管理平台资源，也可围绕选中的项目模板进行配置。'}</span>
              </div>
            </div>
          ) : (
            activeSession.messages.map((msg) => {
              const isUser = msg.role === 'user';
              const isSystem = msg.role === 'system';

              if (isSystem) {
                return (
                  <div key={msg.id} style={{ alignSelf: 'center', maxWidth: '100%', background: '#f1f5f9', color: '#475569', fontSize: '12px', padding: '6px 14px', borderRadius: '20px', textAlign: 'center' }}>
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
                    maxWidth: isUser ? (isSidebarCollapsed ? '94%' : '88%') : '100%',
                    width: isUser ? 'auto' : '100%',
                  }}
                >
                  {!isUser && (
                    <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#dbeafe', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                      <RobotMascot size={28} decorative />
                    </div>
                  )}
                  <div style={{ flex: isUser ? undefined : 1, minWidth: 0 }}>
                    <div
                      className={`copilot-bubble ${isUser ? 'copilot-bubble-user' : 'copilot-bubble-assistant'}`}
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
                        <>
                          {/* 步骤与工具调用展示 (默认折叠，成功为绿，失败为红，包含详细输入输出) */}
                          {msg.toolSteps && msg.toolSteps.length > 0 && (
                            <details
                              className="copilot-tool-steps-container"
                              style={{
                                marginBottom: '12px',
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                borderRadius: '8px',
                                padding: '8px 12px',
                                fontSize: '12px',
                              }}
                            >
                              <summary
                                style={{
                                  cursor: 'pointer',
                                  color: '#334155',
                                  fontWeight: 600,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  userSelect: 'none',
                                  listStyle: 'none',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontSize: '13px' }}>≡</span>
                                  <span>查看执行步骤 · {msg.toolSteps.length} 个后台操作</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                                  {msg.toolSteps.every((s) => s.status === 'done') ? (
                                    <span style={{ color: '#16a34a', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                                      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} /> 全部成功
                                    </span>
                                  ) : msg.toolSteps.some((s) => s.status === 'error') ? (
                                    <span style={{ color: '#dc2626', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                                      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} /> 存在错误
                                    </span>
                                  ) : (
                                    <span style={{ color: '#d97706', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                                      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#d97706', display: 'inline-block' }} /> 待处理
                                    </span>
                                  )}
                                  <span style={{ color: '#94a3b8', fontSize: '10px' }}>▼</span>
                                </div>
                              </summary>

                              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
                                {msg.toolSteps.map((step, idx) => {
                                  const isSuccess = step.status === 'done';
                                  const isError = step.status === 'error';
                                  const isPending = step.status === 'pending';
                                  const statusColor = isSuccess ? '#16a34a' : isError ? '#dc2626' : isPending ? '#d97706' : '#64748b';
                                  const statusLabel = isSuccess ? '成功' : isError ? '失败' : isPending ? '待确认' : '已取消';

                                  return (
                                    <div
                                      key={idx}
                                      className="copilot-step-item"
                                      style={{
                                        background: '#ffffff',
                                        border: `1px solid ${isSuccess ? '#bbf7d0' : isError ? '#fecaca' : '#e2e8f0'}`,
                                        borderRadius: '6px',
                                        padding: '8px 10px',
                                        fontSize: '11.5px',
                                      }}
                                    >
                                      {/* 步骤基本信息栏 */}
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                          <span
                                            style={{
                                              display: 'inline-block',
                                              width: '8px',
                                              height: '8px',
                                              borderRadius: '50%',
                                              background: statusColor,
                                              flexShrink: 0,
                                            }}
                                            title={statusLabel}
                                          />
                                          <strong style={{ color: '#0f172a', fontWeight: 600 }}>{step.label}</strong>
                                          <code
                                            style={{
                                              fontSize: '10.5px',
                                              color: '#64748b',
                                              background: '#f1f5f9',
                                              padding: '1px 5px',
                                              borderRadius: '3px',
                                            }}
                                          >
                                            {step.name}
                                          </code>
                                        </div>
                                        <span
                                          style={{
                                            fontSize: '11px',
                                            fontWeight: 600,
                                            color: statusColor,
                                            background: isSuccess ? '#f0fdf4' : isError ? '#fef2f2' : '#f8fafc',
                                            border: `1px solid ${isSuccess ? '#bbf7d0' : isError ? '#fecaca' : '#e2e8f0'}`,
                                            padding: '1px 6px',
                                            borderRadius: '4px',
                                          }}
                                        >
                                          {statusLabel}
                                        </span>
                                      </div>

                                      {/* 工具输入输出 (默认折叠) */}
                                      <details
                                        className="copilot-step-io-details"
                                        style={{
                                          marginTop: '6px',
                                          paddingTop: '6px',
                                          borderTop: '1px dashed #e2e8f0',
                                        }}
                                      >
                                        <summary
                                          style={{
                                            cursor: 'pointer',
                                            fontSize: '11px',
                                            color: '#64748b',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            userSelect: 'none',
                                          }}
                                        >
                                          <span>🔍 查看详细调用信息 (输入 / 输出)</span>
                                        </summary>
                                        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                          {step.input !== undefined && (
                                            <div>
                                              <div style={{ fontSize: '10.5px', fontWeight: 600, color: '#475569', marginBottom: '2px' }}>
                                                输入参数 (Input):
                                              </div>
                                              <pre
                                                className="copilot-step-json-block"
                                                style={{
                                                  margin: 0,
                                                  padding: '6px 8px',
                                                  background: '#0f172a',
                                                  color: '#e2e8f0',
                                                  borderRadius: '4px',
                                                  fontSize: '10.5px',
                                                  overflowX: 'auto',
                                                  maxHeight: '160px',
                                                  fontFamily: 'monospace',
                                                }}
                                              >
                                                <code>{typeof step.input === 'string' ? step.input : JSON.stringify(step.input, null, 2)}</code>
                                              </pre>
                                            </div>
                                          )}
                                          {step.output !== undefined && (
                                            <div>
                                              <div style={{ fontSize: '10.5px', fontWeight: 600, color: '#475569', marginBottom: '2px' }}>
                                                输出结果 (Output):
                                              </div>
                                              <pre
                                                className="copilot-step-json-block"
                                                style={{
                                                  margin: 0,
                                                  padding: '6px 8px',
                                                  background: isError ? '#450a0a' : '#0f172a',
                                                  color: isError ? '#fecaca' : '#86efac',
                                                  borderRadius: '4px',
                                                  fontSize: '10.5px',
                                                  overflowX: 'auto',
                                                  maxHeight: '160px',
                                                  fontFamily: 'monospace',
                                                }}
                                              >
                                                <code>{typeof step.output === 'string' ? step.output : JSON.stringify(step.output, null, 2)}</code>
                                              </pre>
                                            </div>
                                          )}
                                        </div>
                                      </details>
                                    </div>
                                  );
                                })}
                              </div>
                            </details>
                          )}
                          <MarkdownRenderer content={msg.content} />
                        </>
                      )}
                    </div>

                    {msg.confirmationRequest && msg.pendingDeletions?.map(receipt => receipt.confirmation && (
                      <section key={receipt.id} aria-label="待确认删除" style={{ marginTop: 10, padding: 14, border: '1px solid #fdba74', borderRadius: 8, background: '#fff7ed' }}>
                        <strong>{receipt.label} · 等待二次确认</strong>
                        <p>操作：{receipt.kind} · 对象：{receipt.confirmation.target}</p>
                        <details><summary>核对操作参数</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(receipt.confirmation.parameters, null, 2)}</pre></details>
                        <p>{receipt.confirmation.impact}</p>
                        <p>有效期至 {new Date(receipt.confirmation.expiresAt).toLocaleTimeString()}。尚未执行。</p>
                        <button type="button" disabled={isGenerating || runtimePermission !== 'full_access' || Date.now() >= Date.parse(receipt.confirmation.expiresAt)}
                          onClick={() => void performTurn(activeSession.id, msg.confirmationRequest!, {
                            actionId: receipt.id, confirmationId: receipt.confirmation!.id, decision: 'confirm',
                          }, msg.id)}>{receipt.kind === 'mcp.invoke' ? '确认调用' : '确认删除'}</button>
                        <button type="button" disabled={isGenerating}
                          onClick={() => void performTurn(activeSession.id, msg.confirmationRequest!, {
                            actionId: receipt.id, confirmationId: receipt.confirmation!.id, decision: 'cancel',
                          }, msg.id)}>取消</button>
                      </section>
                    ))}

                    {msg.retry && (
                      <button
                        type="button"
                        disabled={isGenerating || !capabilities.ready}
                        onClick={() => void performTurn(activeSession.id, msg.retry!, undefined, msg.id)}
                        style={{
                          marginTop: '8px',
                          padding: '4px 10px',
                          fontSize: '11.5px',
                          color: '#dc2626',
                          background: '#fef2f2',
                          border: '1px solid #fecaca',
                          borderRadius: '6px',
                          cursor: isGenerating ? 'not-allowed' : 'pointer',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <span>↺</span> 重试未完成操作
                      </button>
                    )}

                    {/* 结构化产物卡片展示 */}
                    {msg.artifact && (
                      <div className="copilot-artifact-card" style={{ marginTop: '10px', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '10px', padding: '14px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
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
            })
          )}

          {isGenerating && (
            <div style={{ display: 'flex', gap: '12px', alignSelf: 'flex-start' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#dbeafe', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
                <RobotMascot size={28} decorative />
              </div>
              <div className="copilot-thinking-bubble" style={{ background: '#ffffff', padding: '12px 16px', borderRadius: '16px 16px 16px 2px', fontSize: '13px', color: '#64748b', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                启途管家正在利用 <strong>{selectedModelItem?.id ?? (selectedModel || 'server default')}</strong>（{thinkingStrength === 'max' || thinkingStrength === 'high' ? '深度推理' : '标准推理'}）执行分析...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 4. 底部现代化输入框 */}
        <div className="copilot-composer-container" style={{ padding: '16px 24px 20px', background: 'rgba(255, 255, 255, 0.96)', borderTop: '1px solid #e2e8f0', flexShrink: 0 }}>
          <div style={{ maxWidth: '100%', width: '100%' }}>
            {isListening && (
              <div style={{ marginBottom: '10px', padding: '8px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '12px', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
                <strong>正在语音输入：</strong>
                <span>{voiceInterim || '请对麦克风说话，语音将自动转写为文字...'}</span>
              </div>
            )}

            <div
              style={{
                border: '1.5px solid #cbd5e1',
                borderRadius: '14px',
                background: '#ffffff',
                boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
            >
              <textarea
                className="copilot-textarea"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={scope === 'global' ? '向启途智学管家下发指令，例如：检查全局助手、模型、技能及知识库配置...' : '围绕当前模板下发指令，例如：检查当前光学模板的课时、团队与技能绑定...'}
                style={{
                  width: '100%',
                  minHeight: '56px',
                  maxHeight: '140px',
                  padding: '12px 16px 6px',
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: '13.5px',
                  lineHeight: 1.6,
                  resize: 'none',
                  color: '#0f172a',
                  boxSizing: 'border-box',
                }}
              />

              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 14px 10px',
                borderTop: '1px solid #f8fafc',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: scope === 'global' ? '#f1f5f9' : '#eff6ff',
                    color: scope === 'global' ? '#475569' : '#1d4ed8',
                    border: '1px solid',
                    borderColor: scope === 'global' ? '#e2e8f0' : '#bfdbfe',
                    fontWeight: 600,
                  }}>
                    {scope === 'global' ? '🌐 全局模式' : '📑 模板专有'}
                  </span>
                  <span style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: runtimePermission === 'full_access' ? '#f0fdf4' : '#f8fafc',
                    color: runtimePermission === 'full_access' ? '#166534' : '#64748b',
                    border: '1px solid',
                    borderColor: runtimePermission === 'full_access' ? '#bbf7d0' : '#cbd5e1',
                    fontWeight: 600,
                  }}>
                    {runtimePermission === 'full_access' ? '🛡️ 配置模式 (写权限)' : '🛡️ 只读模式'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className={`copilot-voice-btn ${isListening ? 'is-listening' : ''}`}
                    onClick={toggleVoiceInput}
                    title={isListening ? '点击停止语音输入' : '开启语音输入'}
                    style={{
                      height: '34px',
                      padding: '0 12px',
                      background: isListening ? '#ef4444' : '#f8fafc',
                      color: isListening ? '#ffffff' : '#334155',
                      border: '1px solid',
                      borderColor: isListening ? '#ef4444' : '#cbd5e1',
                      borderRadius: '8px',
                      fontWeight: 600,
                      fontSize: '12.5px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      transition: 'all 0.15s',
                    }}
                  >
                    <span>{isListening ? '⏹️' : '🎙️'}</span>
                    <span>{isListening ? '停止' : '语音'}</span>
                  </button>

                  <button
                    className="copilot-send-btn"
                    onClick={handleSendMessage}
                    disabled={!inputMessage.trim() || isGenerating || modelSaving || modelLoading || !!modelError || !catalogReady || !capabilities.ready || !selectedModelItem || projectCatalog.loading || !!projectCatalog.error}
                    style={{
                      height: '34px',
                      padding: '0 18px',
                      background: !inputMessage.trim() || isGenerating || !catalogReady || !capabilities.ready ? '#cbd5e1' : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: !inputMessage.trim() || isGenerating || !catalogReady || !capabilities.ready ? 'not-allowed' : 'pointer',
                      boxShadow: !inputMessage.trim() || isGenerating || !catalogReady || !capabilities.ready ? 'none' : '0 2px 6px rgba(37,99,235,0.25)',
                      transition: 'all 0.15s',
                    }}
                  >
                    发送指令 ↵
                  </button>
                </div>
              </div>
            </div>

            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px', textAlign: 'center' }}>
              快捷操作：Enter 发送 · Shift + Enter 换行 · 支持麦克风语音转写、Markdown 与全链路配置自动化执行
            </div>
          </div>
        </div>
      </div>
      </ResizablePanels>
    </div>
  );
}
