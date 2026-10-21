'use client';

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

  const performTurn = async (sessionId: string, messageId: string, retry: NonNullable<Message['retry']>, decision?: Pick<AdminCopilotConfirmationRequest, 'actionId' | 'confirmationId' | 'decision'>) => {
    if (requestInFlight.current || !capabilities.ready) return;
    requestInFlight.current = true;
    setIsGenerating(true);
    const update = (patch: Partial<Message>) => setSessions(previous => previous.map(session => session.id !== sessionId
      ? session : { ...session, messages: session.messages.map(message => message.id === messageId ? { ...message, ...patch } : message) }));
    try {
      if (Date.now() - retry.startedAt > 23 * 60 * 60 * 1000) throw new Error('本轮重试期限已过，请先核对资源状态，再发起新指令。');
      update({ content: '正在读取配置、生成计划并执行…' });
      const result = decision
        ? await confirmCopilotTurn({ request: retry.request, turnKey: retry.key, ...decision })
        : await runCopilotTurn(retry.request, retry.key);
      update({ content: result.reply, retry: result.status === 'partial' ? retry : undefined,
        pendingDeletions: result.receipts.filter(receipt => receipt.status === 'awaiting_confirmation'),
        confirmationRequest: result.status === 'awaiting_confirmation' ? retry : undefined,
        toolSteps: result.receipts.map(receipt => ({ name: receipt.kind, label: receipt.label,
          status: receipt.status === 'succeeded' ? 'done' : receipt.status === 'cancelled' ? 'cancelled' : receipt.status === 'awaiting_confirmation' ? 'pending' : 'error',
          detail: JSON.stringify(receipt.result ?? { code: receipt.code, message: receipt.message }, null, 2) })) });
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
      update({ content: `请求未完成：${error instanceof Error ? error.message : '服务器不可用'}。可使用下方按钮重试同一操作。`, retry });
    } finally {
      requestInFlight.current = false;
      setIsGenerating(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isGenerating || modelSaving || modelLoading || modelError || !catalogReady || !capabilities.ready || !selectedModelItem || projectCatalog.loading || projectCatalog.error) return;
    const content = inputMessage.trim();
    const sessionId = activeSession.id;
    const messageId = newIdempotencyKey();
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
      ...session, title: session.messages.some(m => m.role === 'user') ? session.title : content.slice(0, 24), updatedAt: '刚刚',
      messages: [...session.messages, { id: newIdempotencyKey(), role: 'user', content, timestamp },
        { id: messageId, role: 'assistant', content: '正在处理…', timestamp, retry }],
    }));
    setInputMessage('');
    await performTurn(sessionId, messageId, retry);
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
              <div style={{ fontSize: '11.5px', color: '#64748b' }}>{scope === 'global' ? '全局配置' : '当前模板配置'} · 执行结果以服务端回执为准</div>
            </div>
          </div>

          {/* 快捷设置区 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}>范围：
              <select aria-label="选择已有项目" value={activeSession.templateId ?? ''} disabled={isGenerating || projectCatalog.loading}
                onChange={event => setProject(event.target.value || null, null)}>
                <option value="">全局配置</option>
                {projectCatalog.templates.map(t => <option key={t.id} value={t.id}>{t.title} · {t.status}</option>)}
              </select>
            </label>
            {activeSession.templateId && <label style={{ fontSize: 12 }}>版本：
              <select aria-label="选择项目版本" value={activeSession.templateVersionId ?? ''} disabled={isGenerating || projectCatalog.loading}
                onChange={event => setProject(activeSession.templateId ?? null, event.target.value || null)}>
                <option value="">{projectCatalog.loading ? '正在读取…' : '暂无版本'}</option>
                {projectCatalog.versions.map(v => <option key={v.id} value={v.id}>{v.version} · {v.status}</option>)}
              </select>
            </label>}
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

            {/* 模型选择 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '3px 8px' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>◈ 模型:</span>
              <select
                value={selectedModel}
                aria-label="管家默认模型"
                disabled={!availableModels.length || isGenerating || modelSaving || modelLoading}
                onChange={(e) => void handleModelChange(e.target.value)}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#0f172a', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
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
              {!modelIsDefault && selectedModel && <button type="button" disabled={isGenerating || modelSaving || modelLoading}
                onClick={() => void handleModelChange(selectedModel)}>设为默认</button>}
            </div>

            {/* 权限设置 (参考 Codex 3 个权限: Read Only / Workspace Write / Full Access) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '3px 8px' }}>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>🛡️ 权限:</span>
              <select
                value={runtimePermission}
                onChange={(e) => handlePermissionChange(e.target.value as 'read_only' | 'full_access')}
                style={{ border: 'none', background: 'transparent', fontSize: '12px', color: '#0f172a', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
              >
                <option value="full_access">配置模式（可创建和修改资源）</option>
                <option value="read_only">只读模式（分析与建议）</option>
              </select>
            </div>

            <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: catalogReady ? '#16a34a' : '#64748b', marginLeft: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: catalogReady ? '#22c55e' : '#94a3b8', display: 'inline-block' }} />
              {catalogReady ? `助手目录已同步${activeTeam ? ` · 团队：${activeTeam.name}` : ''}` : '助手目录未就绪'}
            </span>
          </div>
        </div>

        <KnowledgeUpload enabled={scope === 'global' && runtimePermission === 'full_access' && !isGenerating}
          onSaved={content => setSessions(previous => previous.map(session => session.id !== currentSessionId ? session : {
            ...session, messages: [...session.messages, { id: newIdempotencyKey(), role: 'assistant', content, timestamp: new Date().toLocaleTimeString() }],
          }))} />
        <CopilotCapabilities data={capabilities.data} loading={capabilities.loading} error={capabilities.error} scope={scope} refresh={capabilities.refresh} />
        <div role="status" style={{ padding: '4px 24px', fontSize: 12 }}>{modelLoading ? '正在读取默认模型…' : modelSaving ? '正在保存默认模型…' : modelNotice || '模型选择后自动保存为管家默认模型。'} {modelError && <button type="button" disabled={modelSaving} onClick={() => void reloadModels()}>重新加载模型</button>}</div>
        {(projectCatalog.loading || projectCatalog.error || modelLoading || modelError || (!selectedModelItem && !isGenerating)) && <div role={projectCatalog.error || modelError ? 'alert' : 'status'} style={{ padding: '10px 24px', background: '#fff7ed', color: '#9a3412', fontSize: 13 }}>
          {projectCatalog.error ?? modelError ?? (modelLoading ? '正在读取管家默认模型…' : projectCatalog.loading ? '正在读取已有项目…' : '没有可用模型，请先在模型设置中配置供应商与模型。')}
          {projectCatalog.error && <button onClick={projectCatalog.refresh}>重读项目目录</button>}
        </div>}
        {!projectCatalog.loading && !projectCatalog.error && !projectCatalog.templates.length && <div role="status" style={{ padding: '8px 24px', fontSize: 12 }}>暂无已有项目，可让管家创建项目模板。</div>}
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
              <span style={{ color: '#15803d' }}>（角色：{activeTestAssistant.role} · 单助手预览，团队作为配置上下文）</span>
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

                  {msg.confirmationRequest && msg.pendingDeletions?.map(receipt => receipt.confirmation && (
                    <section key={receipt.id} aria-label="待确认删除" style={{ marginTop: 10, padding: 14, border: '1px solid #fdba74', borderRadius: 8, background: '#fff7ed' }}>
                      <strong>{receipt.label} · 等待二次确认</strong>
                      <p>操作：{receipt.kind} · 对象：{receipt.confirmation.target}</p>
                      <details><summary>核对操作参数</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(receipt.confirmation.parameters, null, 2)}</pre></details>
                      <p>{receipt.confirmation.impact}</p>
                      <p>有效期至 {new Date(receipt.confirmation.expiresAt).toLocaleTimeString()}。尚未执行。</p>
                      <button type="button" disabled={isGenerating || runtimePermission !== 'full_access' || Date.now() >= Date.parse(receipt.confirmation.expiresAt)}
                        onClick={() => void performTurn(activeSession.id, msg.id, msg.confirmationRequest!, {
                          actionId: receipt.id, confirmationId: receipt.confirmation!.id, decision: 'confirm',
                        })}>{receipt.kind === 'mcp.invoke' ? '确认调用' : '确认删除'}</button>
                      <button type="button" disabled={isGenerating}
                        onClick={() => void performTurn(activeSession.id, msg.id, msg.confirmationRequest!, {
                          actionId: receipt.id, confirmationId: receipt.confirmation!.id, decision: 'cancel',
                        })}>取消</button>
                    </section>
                  ))}

                  {/* 工具调用情况详细展示 */}
                  {msg.toolSteps && msg.toolSteps.length > 0 && (
                    <div style={{ marginTop: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px', fontSize: '12px' }}>
                      <div style={{ color: '#64748b', fontWeight: 600, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>⚡</span> 工具调用与执行过程 ({msg.toolSteps.length} 步)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {msg.toolSteps.map((step, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#334155' }}>
                            <span aria-label={step.status === 'pending' ? '等待确认' : step.status === 'cancelled' ? '已取消' : step.status === 'done' ? '已完成' : '未完成'} style={{ color: step.status === 'done' ? '#16a34a' : step.status === 'pending' ? '#b45309' : step.status === 'cancelled' ? '#64748b' : '#dc2626', fontWeight: 700 }}>{step.status === 'done' ? '✓' : step.status === 'pending' ? '◷' : step.status === 'cancelled' ? '—' : '!'}</span>
                            <span>{step.label}</span>
                            {step.detail && <details><summary>回读详情</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>{step.detail}</pre></details>}
                            <code style={{ fontSize: '11px', color: '#64748b', background: '#f1f5f9', padding: '1px 4px', borderRadius: '3px' }}>{step.name}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {msg.retry && <button type="button" disabled={isGenerating || !capabilities.ready} onClick={() => void performTurn(activeSession.id, msg.id, msg.retry!)} style={{ marginTop: 8 }}>重试未完成操作</button>}
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
                启途管家正在利用 <strong>{selectedModelItem?.id ?? (selectedModel || 'server default')}</strong>执行分析...
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
              placeholder={scope === 'global' ? '例如：检查全局助手、模型、技能及知识库配置，说明哪些已启用。' : '例如：检查当前光学模板的课时、团队与技能绑定，列出需要补齐的配置。'}
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
              disabled={!inputMessage.trim() || isGenerating || modelSaving || modelLoading || !!modelError || !catalogReady || !capabilities.ready || !selectedModelItem || projectCatalog.loading || !!projectCatalog.error}
              style={{
                height: '44px',
                padding: '0 20px',
                background: !inputMessage.trim() || isGenerating || !catalogReady || !capabilities.ready ? '#94a3b8' : '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '13.5px',
                cursor: !inputMessage.trim() || isGenerating || !catalogReady || !capabilities.ready ? 'not-allowed' : 'pointer',
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
