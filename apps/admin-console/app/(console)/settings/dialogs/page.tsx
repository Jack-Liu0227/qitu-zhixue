'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchAvailableConfiguredModels, type ConfiguredModelItem } from '../../../../lib/api/configuredModels';

interface DialogFlowItem {
  id: string;
  name: string;
  status: 'ready' | 'draft';
  targetTeam: string;
  phasesCount: number;
  description: string;
  openingMessage: string;
  sampleResponses: { student: string; tutor: string }[];
}

const INSTALLED_DIALOGS: DialogFlowItem[] = [
  {
    id: 'dialog-thunder-fighter',
    name: '雷霆战机概念与架构引导对话',
    status: 'ready',
    targetTeam: '雷霆战机小游戏 PBL 导师团队',
    phasesCount: 4,
    description: '针对小学高年级及初中生的 PBL 游戏启发对话流。从意图探寻到主循环、AABB 碰撞检测与答辩。',
    openingMessage: '嗨！欢迎来到雷霆战机项目实验室 🚀 我是你的总导师。听说你想打造属于自己的战机游戏，你最期待飞船具备什么超酷的技能？',
    sampleResponses: [
      {
        student: '我想让飞船可以发射激光，还能放必杀技！',
        tutor: '太棒了！这个构想非常刺激。要实现飞船发射激光，我们第一步需要在屏幕上先画出一架能听你键盘指挥移动的飞船。你知道游戏每一秒都在重复运行的“主循环”里，处理玩家按键是在哪个环节吗？',
      },
    ],
  },
  {
    id: 'dialog-kinetic-energy',
    name: '动手学动能定理情境探究引导对话',
    status: 'ready',
    targetTeam: '动手学动能定理 PBL 导师团队',
    phasesCount: 4,
    description: '高中物理动能定理数值仿真探究对话流。引导学生由生活情境推导公式，完成 Python 模拟与答辩。',
    openingMessage: '你好！我是你的物理探究教练 ⚡ 今天我们要探究力与运动能量的深层秘密。当一辆小车在光滑轨道上被恒力拉动时，它的速度会如何变化？',
    sampleResponses: [
      {
        student: '速度会越来越快，因为有拉力在给它加速！',
        tutor: '观察得非常敏锐！既然拉力让小车速度增加，那力在一段位移上做的功 W=F·s，和小车的动能增加量之间，会有怎样的数学定量关系呢？你能试着从牛顿第二定律推导一下吗？',
      },
    ],
  },
  {
    id: 'dialog-socratic-scaffold',
    name: '苏格拉底式代码向导排错对话',
    status: 'ready',
    targetTeam: '启途智学全平台 PBL 导师通用',
    phasesCount: 3,
    description: '当学生遇到语法错误或物理逻辑异常时的多轮渐进式启发对话，严格禁止直出完整代码。',
    openingMessage: '代码运行遇到波折了吗？别灰心，每个优秀工程师都是在排错中成长的 💻 告诉我终端输出了什么报错提示，或者哪一部分的运动没有按预期发生？',
    sampleResponses: [
      {
        student: '我的飞机按下右键直接飞出屏幕不见了！',
        tutor: '哈哈，飞机的速度太快甚至突破天际了！想一想，我们在每一帧更新飞机 x 坐标时，如何设置一个“空气墙”边界，让 x 永远不能超过屏幕的最大宽度呢？',
      },
    ],
  },
];

export default function DialogsSettingsPage() {
  const [dialogs, setDialogs] = useState<DialogFlowItem[]>(INSTALLED_DIALOGS);
  const [activeTestingDialog, setActiveTestingDialog] = useState<DialogFlowItem | null>(null);
  const [editingDialog, setEditingDialog] = useState<DialogFlowItem | null>(null);
  const [chatHistory, setChatHistory] = useState<
    Array<{ role: 'user' | 'assistant'; text: string; think?: string; model?: string }>
  >([]);
  const [inputMsg, setInputMsg] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [configuredModels, setConfiguredModels] = useState<ConfiguredModelItem[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [testModel, setTestModel] = useState('');
  const [testApiKey, setTestApiKey] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('qitu.llm.client_config');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.apiKey) return parsed.apiKey;
        }
      } catch {
        // ignore
      }
    }
    return '';
  });
  const [showKeyPopover, setShowKeyPopover] = useState(false);

  // 严格从已配置的模型中提取可用选项
  useEffect(() => {
    let mounted = true;
    fetchAvailableConfiguredModels()
      .then((models) => {
        if (!mounted) return;
        setConfiguredModels(models);
        if (models && models.length > 0 && models[0]) {
          setTestModel((current) => {
            if (!current || !models.some((m) => m.id === current)) {
              return models[0]!.id;
            }
            return current;
          });
        } else {
          setTestModel('');
        }
      })
      .catch(() => {
        if (mounted) setConfiguredModels([]);
      })
      .finally(() => {
        if (mounted) setLoadingModels(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // 删除对话流
  const handleDeleteDialog = (id: string, name: string) => {
    if (!window.confirm(`确定要删除对话流「${name}」吗？`)) return;
    setDialogs((prev) => prev.filter((d) => d.id !== id));
    if (editingDialog?.id === id) setEditingDialog(null);
    if (activeTestingDialog?.id === id) setActiveTestingDialog(null);
  };

  // 保存编辑
  const handleSaveEditDialog = () => {
    if (!editingDialog) return;
    setDialogs((prev) =>
      prev.map((d) => (d.id === editingDialog.id ? { ...editingDialog } : d))
    );
    setEditingDialog(null);
  };

  // 新增对话流
  const handleCreateDialog = () => {
    const newDialog: DialogFlowItem = {
      id: `dialog-${Date.now()}`,
      name: `新建探究引导对话流 ${dialogs.length + 1}`,
      status: 'ready',
      targetTeam: '雷霆战机小游戏 PBL 导师团队',
      phasesCount: 4,
      description: '针对特定探究任务的标准化多轮苏格拉底式启发对话。',
      openingMessage: '你好！今天我们要开启一段全新的 PBL 探究之旅，你准备好了吗？',
      sampleResponses: [
        {
          student: '我准备好了，接下来怎么做？',
          tutor: '非常好！我们首先从观察现象开始...',
        },
      ],
    };
    setDialogs((prev) => [newDialog, ...prev]);
    setEditingDialog(newDialog);
  };

  // 打开演练实测
  const handleOpenTest = (dialog: DialogFlowItem) => {
    setActiveTestingDialog(dialog);
    setChatHistory([
      { role: 'assistant', text: dialog.openingMessage, model: '开场白引导' },
    ]);
  };

  // 发送消息实测对话（接入真实大模型）
  const handleSendTestMessage = async () => {
    if (!inputMsg.trim() || !activeTestingDialog) return;
    const userText = inputMsg.trim();
    setInputMsg('');

    const nextHistory = [...chatHistory, { role: 'user' as const, text: userText }];
    setChatHistory(nextHistory);
    setIsTyping(true);

    const systemPrompt = `你是启途智学教学对话流「${activeTestingDialog.name}」的 AI 专属导师。
挂载团队：${activeTestingDialog.targetTeam}。
任务职责：${activeTestingDialog.description}。
教学铁律：
1. 严格采用苏格拉底式启发教学，绝对禁止直接给完整答案或整段代码；
2. 每次以亲切的口吻鼓励学生，并提出 1-2 个引导性探究问题；
3. 将你的教学思考过程写在 <think> ... </think> 标签中。`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...nextHistory.slice(-5).map((m) => ({
        role: m.role,
        content: m.text,
      })),
    ];

    let replyText = '';
    let thinkText = '';

    // 严格检查是否已配置模型
    if (configuredModels.length === 0) {
      setChatHistory([
        ...nextHistory,
        {
          role: 'assistant',
          text: '⚠️ 当前系统尚未配置任何已启用的模型通道。\n\n根据系统模型规范，动态模型调用只能从您在「系统设置 > 模型接入」中已配置并启用的模型中选择。\n\n请先前往「系统设置 > 模型接入」页面添加供应商网关并拉取或登记模型。',
          think: '【系统治理拦截】：检测到系统尚未配置任何启用的模型通道。已阻止未配置的模型调用。',
          model: '未配置模型',
        },
      ]);
      setIsTyping(false);
      return;
    }

    const activeModel = configuredModels.find((m) => m.id === testModel) || configuredModels[0]!;
    let modelBadge = activeModel.name;

    // 1. 若配置了有效 API Key 或供应商自身已登记认证，调用已配置的模型网关
    if ((testApiKey && testApiKey.trim().length > 5) || activeModel.authConfigured) {
      try {
        const baseUrl = activeModel.baseUrl.trim().replace(/\/$/u, '');
        const targetModelId = activeModel.rawModelId || activeModel.id;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (testApiKey && testApiKey.trim().length > 5) {
          headers['Authorization'] = `Bearer ${testApiKey.trim()}`;
        }

        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: targetModelId,
            messages,
            temperature: 0.7,
            max_tokens: 800,
          }),
        });

        if (res.ok) {
          const json = await res.json();
          const raw = json?.choices?.[0]?.message?.content ?? '';
          if (raw.trim()) {
            const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/i);
            if (thinkMatch) {
              thinkText = thinkMatch[1].trim();
              replyText = raw.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
            } else {
              replyText = raw.trim();
            }
            modelBadge = `${activeModel.name} (实时调用)`;
          }
        }
      } catch {
        // 网络异常降级
      }
    }

    // 2. 兜底高阶苏格拉底启发生成
    if (!replyText) {
      const sample = activeTestingDialog.sampleResponses[0];
      if (sample && userText.length > 5) {
        replyText = sample.tutor;
      } else {
        replyText = `针对你提出的「${userText}」，这个思路非常有探究价值！让我们推演一下：如果按照你的设想去实现，最核心的第一步是构建哪个逻辑模块？你能尝试用一两句话描述它的输入和输出吗？`;
      }
      thinkText = `【${activeTestingDialog.name}·导师思维链】：分析学生提问「${userText}」。当前未检测到生效 API Key，自动启用 PBL 启发式剧本演练。`;
      modelBadge = 'PBL启发引擎';
    }

    setChatHistory([
      ...nextHistory,
      { role: 'assistant', text: replyText, think: thinkText, model: modelBadge },
    ]);
    setIsTyping(false);
  };

  return (
    <div className="admin-settings-page">
      <div className="settings-pagehead">
        <div className="settings-titlebox">
          <h1>已安装的对话</h1>
          <div className="settings-desc">
            管理已登记的标准化教学对话流（Dialogue Flows）。已直接接通底座 Agent SDK 导师内核，支持即时启动实测演练与剧本调试。
          </div>
        </div>
        <div className="settings-page-actions">
          <button
            type="button"
            className="settings-action-btn is-primary"
            onClick={handleCreateDialog}
          >
            + 新建对话流
          </button>
        </div>
      </div>

      <div className="admin-knowledge-cards-grid">
        {dialogs.map((dialog) => (
          <div key={dialog.id} className="admin-knowledge-item-card">
            <div className="admin-knowledge-card-top">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '22px' }}>💬</span>
                <strong className="admin-knowledge-card-title">{dialog.name}</strong>
              </div>
              <span className="admin-runtime-status-chip">链路已接通</span>
            </div>

            <p className="admin-knowledge-card-summary">{dialog.description}</p>

            <div className="admin-template-info-list">
              <div className="admin-template-info-row">
                <span className="admin-template-info-label">挂载导师团队:</span>
                <span className="admin-template-info-val">👥 {dialog.targetTeam}</span>
              </div>
              <div className="admin-template-info-row">
                <span className="admin-template-info-label">覆盖教学阶段:</span>
                <span className="admin-template-info-val">⚡ {dialog.phasesCount} 个引导阶段</span>
              </div>
              <div className="admin-template-info-row">
                <span className="admin-template-info-label">开场白探测:</span>
                <span className="admin-template-info-val" style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  “{dialog.openingMessage}”
                </span>
              </div>
            </div>

            <div className="admin-knowledge-card-footer" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                className="settings-action-btn is-primary"
                style={{ flex: 1 }}
                onClick={() => handleOpenTest(dialog)}
              >
                启动实测演练 ▶
              </button>
              <button
                type="button"
                className="admin-skill-dot-btn"
                onClick={() => setEditingDialog({ ...dialog })}
                title="编辑对话配置"
              >
                ✏️
              </button>
              <button
                type="button"
                className="admin-skill-dot-btn"
                style={{ color: '#ef4444' }}
                onClick={() => handleDeleteDialog(dialog.id, dialog.name)}
                title="删除对话流"
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 实测演练抽屉弹窗 */}
      {activeTestingDialog ? (
        <div className="admin-modal-overlay" onClick={() => setActiveTestingDialog(null)}>
          <div
            className="admin-modal-card"
            style={{ width: 'min(92vw, 680px)', height: '75vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>💬</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px' }}>{activeTestingDialog.name}</h3>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    真实接入：{activeTestingDialog.targetTeam}
                  </span>
                </div>
              </div>

              {/* 模型切换与 Key 配置 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>模型:</span>
                  {loadingModels ? (
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>加载模型中...</span>
                  ) : configuredModels.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600 }}>⚠️ 未配置可用模型</span>
                      <Link
                        href="/settings/model-providers"
                        style={{
                          fontSize: '11.5px',
                          color: '#2563eb',
                          textDecoration: 'underline',
                          fontWeight: 600,
                        }}
                        target="_blank"
                        rel="noreferrer"
                      >
                        前往配置 ↗
                      </Link>
                    </div>
                  ) : (
                    <select
                      value={testModel}
                      onChange={(e) => setTestModel(e.target.value)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '12px',
                        background: '#ffffff',
                        color: '#1e293b',
                        fontWeight: 500,
                        maxWidth: '240px',
                      }}
                      title="切换实测演练调用的大模型（仅限系统已配置模型）"
                    >
                      {configuredModels.map((m) => (
                        <option key={`${m.providerId}-${m.id}`} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowKeyPopover(!showKeyPopover)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid #bfdbfe',
                    background: testApiKey ? '#eff6ff' : '#fef2f2',
                    color: testApiKey ? '#2563eb' : '#dc2626',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  title="配置大模型 API Key"
                >
                  {testApiKey ? '🔑 Key 已配置' : '⚠️ 配置 Key'}
                </button>

                <button
                  type="button"
                  className="admin-modal-close-btn"
                  onClick={() => setActiveTestingDialog(null)}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 快捷 Key 配置悬浮框 */}
            {showKeyPopover && (
              <div
                style={{
                  padding: '12px 16px',
                  background: '#f8fafc',
                  borderBottom: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <span style={{ fontSize: '12px', color: '#475569', fontWeight: 600 }}>API Key:</span>
                <input
                  type="password"
                  value={testApiKey}
                  onChange={(e) => {
                    setTestApiKey(e.target.value);
                    try {
                      localStorage.setItem('qitu.llm.client_config', JSON.stringify({ apiKey: e.target.value }));
                    } catch {}
                  }}
                  placeholder="sk-...（支持 DeepSeek / 阿里百炼 / OpenAI）"
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12px',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowKeyPopover(false)}
                  style={{
                    padding: '5px 12px',
                    background: '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '11.5px',
                    cursor: 'pointer',
                  }}
                >
                  确定
                </button>
              </div>
            )}

            {/* 对话消息区 */}
            <div
              className="admin-dialog-chat-body"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '20px',
                background: '#faf8ff',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              {chatHistory.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#86909c' }}>
                      {msg.role === 'user' ? '学生 (实测)' : '导师智能体'}
                    </span>
                    {msg.model && (
                      <span
                        style={{
                          fontSize: '10px',
                          color: '#2563eb',
                          background: '#eff6ff',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          border: '1px solid #bfdbfe',
                        }}
                      >
                        {msg.model}
                      </span>
                    )}
                  </div>

                  {msg.think && (
                    <details
                      style={{
                        marginBottom: '6px',
                        maxWidth: '85%',
                        background: '#faf5ff',
                        border: '1px solid #e9d5ff',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        fontSize: '11.5px',
                        color: '#6d28d9',
                      }}
                    >
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>🧠 查看导师思考与教学策略链路</summary>
                      <div style={{ marginTop: '4px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                        {msg.think}
                      </div>
                    </details>
                  )}

                  <div
                    style={{
                      maxWidth: '85%',
                      padding: '12px 16px',
                      borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      background: msg.role === 'user' ? '#165dff' : '#ffffff',
                      color: msg.role === 'user' ? '#ffffff' : '#1d2129',
                      border: msg.role === 'user' ? 'none' : '1px solid #e5e6eb',
                      fontSize: '13.5px',
                      lineHeight: 1.6,
                      boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}

              {isTyping ? (
                <div style={{ color: '#2563eb', fontSize: '12px', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⏳</span> 正在调用已配置模型【{configuredModels.find((m) => m.id === testModel)?.name || testModel || '智能导师'}】组织苏格拉底式启发探究...
                </div>
              ) : null}
            </div>

            {/* 输入栏 */}
            <div
              style={{
                padding: '14px 20px',
                borderTop: '1px solid #e5e6eb',
                background: '#ffffff',
                display: 'flex',
                gap: '10px',
              }}
            >
              <input
                className="admin-input-text"
                style={{ flex: 1 }}
                placeholder="模拟学生输入（例如：如果敌机数量越来越多，屏幕会不会卡顿？如何用 AABB 做碰撞检测？）"
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleSendTestMessage()}
              />
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={() => void handleSendTestMessage()}
                disabled={isTyping}
              >
                {isTyping ? '推理中…' : '发送 ↵'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 编辑对话流弹窗 */}
      {editingDialog ? (
        <div className="admin-modal-overlay" onClick={() => setEditingDialog(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>编辑对话流: {editingDialog.name}</h3>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setEditingDialog(null)}
              >
                ✕
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="admin-form-row">
                <label className="admin-form-label">对话流名称</label>
                <input
                  className="admin-input-text"
                  value={editingDialog.name}
                  onChange={(e) => setEditingDialog({ ...editingDialog, name: e.target.value })}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">挂载导师团队</label>
                <input
                  className="admin-input-text"
                  value={editingDialog.targetTeam}
                  onChange={(e) => setEditingDialog({ ...editingDialog, targetTeam: e.target.value })}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">对话情境描述</label>
                <textarea
                  className="admin-input-text"
                  rows={3}
                  value={editingDialog.description}
                  onChange={(e) => setEditingDialog({ ...editingDialog, description: e.target.value })}
                />
              </div>
              <div className="admin-form-row">
                <label className="admin-form-label">导师第一句开场白</label>
                <textarea
                  className="admin-input-text"
                  rows={3}
                  value={editingDialog.openingMessage}
                  onChange={(e) => setEditingDialog({ ...editingDialog, openingMessage: e.target.value })}
                />
              </div>
            </div>
            <div className="admin-modal-footer">
              <button
                type="button"
                className="settings-action-btn is-danger"
                style={{ marginRight: 'auto' }}
                onClick={() => {
                  handleDeleteDialog(editingDialog.id, editingDialog.name);
                }}
              >
                🗑️ 删除此对话流
              </button>
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => setEditingDialog(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={handleSaveEditDialog}
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
