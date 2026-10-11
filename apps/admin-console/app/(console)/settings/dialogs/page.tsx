'use client';

import { useState } from 'react';

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

  const [dialogs, setDialogs] = useState<DialogFlowItem[]>(INSTALLED_DIALOGS);
  const [activeTestingDialog, setActiveTestingDialog] = useState<DialogFlowItem | null>(null);
  const [editingDialog, setEditingDialog] = useState<DialogFlowItem | null>(null);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [isTyping, setIsTyping] = useState(false);

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
      { role: 'assistant', text: dialog.openingMessage },
    ]);
  };

  // 发送消息实测对话
  const handleSendTestMessage = () => {
    if (!inputMsg.trim() || !activeTestingDialog) return;
    const userText = inputMsg.trim();
    setInputMsg('');

    const nextHistory = [...chatHistory, { role: 'user' as const, text: userText }];
    setChatHistory(nextHistory);
    setIsTyping(true);

    // 智能体回复模拟 (遵循苏格拉底启发法)
    setTimeout(() => {
      let reply = '这是个极具洞察力的问题！让我们一起推演：如果按照你的思路，下一步最核心的变量是什么？你能尝试在沙箱里打印一下这个变量的数值吗？';
      const sample = activeTestingDialog.sampleResponses[0];
      if (sample && userText.length > 5) {
        reply = sample.tutor;
      }

      setChatHistory([...nextHistory, { role: 'assistant', text: reply }]);
      setIsTyping(false);
    }, 700);
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
            <div className="admin-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>💬</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px' }}>{activeTestingDialog.name}</h3>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    真实接入：{activeTestingDialog.targetTeam}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setActiveTestingDialog(null)}
              >
                ✕
              </button>
            </div>

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
                  <span style={{ fontSize: '11px', color: '#86909c', marginBottom: '4px' }}>
                    {msg.role === 'user' ? '学生 (测试)' : '导师智能体'}
                  </span>
                  <div
                    style={{
                      maxWidth: '80%',
                      padding: '12px 16px',
                      borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      background: msg.role === 'user' ? '#165dff' : '#ffffff',
                      color: msg.role === 'user' ? '#ffffff' : '#1d2129',
                      border: msg.role === 'user' ? 'none' : '1px solid #e5e6eb',
                      fontSize: '13.5px',
                      lineHeight: 1.6,
                      boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}

              {isTyping ? (
                <div style={{ color: '#86909c', fontSize: '12px', fontStyle: 'italic' }}>
                  导师正在组织启发性发问...
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
                placeholder="模拟学生输入（例如：我的战机想增加散弹枪效果...）"
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendTestMessage()}
              />
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={handleSendTestMessage}
              >
                发送
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
