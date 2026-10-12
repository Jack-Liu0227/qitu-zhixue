'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { MarkdownRenderer } from './MarkdownRenderer';

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
    title: '系统全自动化构建助手',
    updatedAt: '刚刚',
    messages: [
      {
        id: 'msg-1',
        role: 'system',
        content: '我是启途智学平台核心运维与开发管家（基于自建 Agent SDK），可为您全自动设计与配置智能体、团队组合、MCP 工具、Skill 技能包、PBL 教学模板与知识库。',
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
        content: '启途管家就绪。',
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. 侧边栏折叠状态
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // 2. 快捷设置状态：Thinking 强度（参考 Pi Agent: off | normal | high | max）、底座模型选择、运行权限设置（参考 Codex: read_only | workspace_write | full_access）
  const [thinkingStrength, setThinkingStrength] = useState<'off' | 'normal' | 'high' | 'max'>('high');
  const [selectedModel, setSelectedModel] = useState<string>('deepseek-r1');
  const [runtimePermission, setRuntimePermission] = useState<'read_only' | 'workspace_write' | 'full_access'>('full_access');

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
          content: '我是启途智学全栈管家。输入您的指令，如“创建雷霆战机新关卡设计团队”、“添加一个 Python 绘图 MCP”、“为动能定理添加补充知识库”。',
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

      if (userText.includes('助手') || userText.includes('智能体')) {
        toolSteps = [
          { name: 'agent_sdk_spec_parser', status: 'done', label: `解析导师角色需求：${userText.slice(0, 12)}` },
          { name: 'model_router_bind', status: 'done', label: `挂载模型网关：${selectedModel} (思考强度: ${thinkingStrength})` },
        ];
        replyContent = `已根据自建 Agent SDK 生成全新导师助手配置，已设定严谨的启发式教学模式。底座运行模型挂接为 **${selectedModel}**，权限设为 **${runtimePermission}**。`;
        artifact = {
          type: 'assistant',
          title: `生成新导师：${userText.slice(0, 15)}...`,
          details: '已与模型网关通道接入，开启动态单步检验',
          jsonPreview: JSON.stringify({
            name: '自动生成的启途导师',
            model: selectedModel,
            thinking: thinkingStrength,
            permission: runtimePermission,
            createdAt: new Date().toISOString()
          }, null, 2),
        };
      } else if (userText.includes('团队') || userText.includes('组建')) {
        toolSteps = [
          { name: 'team_orchestrator', status: 'done', label: '调度自建 Agent SDK 多智能体协同引擎' },
          { name: 'pbl_gate_validator', status: 'done', label: '注入 TheoryMastered 强约束门禁' }
        ];
        replyContent = `已成功基于 PBL 规范组建协同团队，包含原理教练、向导与评审导师。在未达成掌握度前遵循：\n\n$$\\text{GateState} = \\text{TheoryMastered}$$`;
        artifact = {
          type: 'team',
          title: '自动生成 PBL 协同团队',
          details: '已绑定项目模板门禁与阶段流转规则',
          jsonPreview: JSON.stringify({
            teamName: 'PBL 自动化研讨小组',
            roles: ['Coach', 'Teammate', 'Reviewer'],
            gateRequired: 'TheoryMastered'
          }, null, 2),
        };
      } else if (userText.includes('MCP') || userText.includes('工具')) {
        toolSteps = [
          { name: 'mcp_json_schema_build', status: 'done', label: '构建标准 JSON-RPC 2.0 MCP 配置' },
          { name: 'security_sandbox_audit', status: 'done', label: `运行权限安全审计 (当前策略: ${runtimePermission})` }
        ];
        replyContent = `已生成对应的 MCP 工具与服务器连接规范，支持在工具矩阵中一键勾选启用。`;
        artifact = {
          type: 'mcp',
          title: 'MCP 配置包 (Model Context Protocol)',
          details: '协议标准：JSON-RPC 2.0 | 权限隔离：只读沙箱环境',
          jsonPreview: JSON.stringify({
            mcpServers: {
              customTool: {
                command: 'npx',
                args: ['-y', '@custom/mcp-server'],
                env: {}
              }
            }
          }, null, 2),
        };
      } else {
        toolSteps = [
          { name: 'qitu_agent_sdk_scan', status: 'done', label: '全量扫描系统配置与微模块依赖' }
        ];
        replyContent = `已收到指令：“${userText}”。我已通过平台 Agent SDK 扫描相关的助手配置、团队依赖与数据模型，随时为您执行结构化变更。您可以在右侧或下方查看生成的配置草案。`;
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
            启途管家会话 ({sessions.length})
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
                <span style={{ fontSize: '18px' }}>🤖</span> 启途管家
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
                <option value="deepseek-r1">deepseek-r1 (推理特化)</option>
                <option value="deepseek-chat">deepseek-chat (通用快速)</option>
                <option value="qwen-max">qwen-max (高智能通义)</option>
                <option value="gpt-4o">gpt-4o (OpenAI)</option>
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
              placeholder="对启途管家说：例如“帮我为高中物理力学创建一个探究小队”或“配置一个新的 GrokSearch MCP”..."
              style={{
                flex: 1,
                minHeight: '44px',
                maxHeight: '120px',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13.5px',
                resize: 'none',
                outline: 'none',
              }}
            />
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
            快捷操作：Enter 发送，Shift + Enter 换行。支持 Markdown、LaTeX 公式、工具调用与配置自动化生成。
          </div>
        </div>
      </div>
    </div>
  );
}
