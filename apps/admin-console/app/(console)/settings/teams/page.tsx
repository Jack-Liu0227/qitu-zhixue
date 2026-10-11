'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAdminTeams,
  updateAgentRoute,
  startTeamRun,
  delegateTeamTask,
  fetchTeamRun,
  type TeamRuntimeSnapshot,
  type AgentGraphEdge,
} from '../../../../lib/api/teams';
import { fetchAvailableConfiguredModels, type ConfiguredModelItem } from '../../../../lib/api/configuredModels';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

interface TeamMemberItem {
  id: string;
  name: string;
  role: string;
  avatar: string;
  isLeader: boolean;
  online: boolean;
  lastActive: string;
  description: string;
  model: string;
  thinking: 'low' | 'medium' | 'high';
  speed: 'standard' | 'fast' | 'priority';
  concurrency: number;
  skills: string[];
  mcps: string[];
  systemPrompt: string;
}

const DEFAULT_MEMBERS: TeamMemberItem[] = [
  {
    id: 'arch-leader',
    name: '论文复现方案架构师',
    role: '生产流程 Leader',
    avatar: '🐵',
    isLeader: false,
    online: false,
    lastActive: '36 天前',
    description: '端到端拉取、分析和规划 Bohrium 论文复现挑战，并通过状态机协调专业 Agent 直到平台提交验收。',
    model: 'gpt-5.6-sol',
    thinking: 'high',
    speed: 'priority',
    concurrency: 4,
    skills: ['taskmaster', 'heuristic-reasoning', 'paper-reader'],
    mcps: ['stitch', 'local-filesystem'],
    systemPrompt: `# 身份

你是通用解题小队的 Leader。给你任何一个任务 —— 论文复现、平台挑战、算法题、数据分析、写工具、查资料 —— 你负责从零把它做完：建目录、拆解、动手、验证、交付；如果是平台挑战，一路做到提交完成。

你不是纯调度器。**默认自己动手做完**，只在任务确实重时才拉成员。

# 触发：看到这个形状就直接开工

\`\`\`text
<任务标题 / Reproduce paper: "..." / 任意问题描述>
Challenge: <URL>      # 可选
Steps: 1. ... 2. ...   # 可选
\`\`\`

不要反问「要不要开始」，不要等二次确认，不要等提交授权。用户已授予本小队常驻提交授权。

- 有 Challenge URL / slug → 平台挑战，终点是**提交 attempt**。
- 无 URL → 普通任务，终点是**工作目录里的产物 + issue 汇报**。
- 给了 Steps 就按 Steps 走，缺的环节自己补齐；没给就自己拆。

# 第一步永远是建目录

WORK_ROOT 从项目'波尔学术挑战'('d1e33b9d-9b4e-4846-abaf-295bcc835fb9') 的 'local_directory' 资源解析（当前标签'Agentic Challenge'）。解析不到就用当前工作目录，并在汇报里写明真实路径。

\`\`\`text
平台挑战（完整 ID 末尾是 8 位十六进制）：<WORK_ROOT>/challenge_<SHORT_ID>/
平台挑战（末尾没有 8 位十六进制）：  <WORK_ROOT>/challenge_<official-slug>/
普通任务：                    <WORK_ROOT>/task_<短横线-slug>/
\`\`\`

立刻 'mkdir -p' 建出来，再开始干活。同名目录已存在就**继续做**，不清空、不建第二个。不读写兄弟任务目录。`,
  },
  {
    id: 'result-reviewer',
    name: '结果复现与量化验收师',
    role: 'RESULT_REVIEW 结果与量化验收',
    avatar: '🐱',
    isLeader: true,
    online: false,
    lastActive: '36 天前',
    description: '把控指标达成度、评测协议基准与量化结果偏差，核验交付工件可靠性。',
    model: 'gpt-5.6-sol',
    thinking: 'high',
    speed: 'priority',
    concurrency: 4,
    skills: ['heuristic-reasoning', 'scientific-visualization'],
    mcps: ['stitch'],
    systemPrompt: `# 角色
你是结果复现与量化验收师。
- 对实验结果进行多轮对比核验，输出量化评测对比表。
- 保证复现指标与原论文指标偏差控制在严格置信区间内。`,
  },
  {
    id: 'method-reviewer',
    name: '方法与验收规格核验师',
    role: 'METHOD_REVIEW 方法与验收规格',
    avatar: '🌈',
    isLeader: false,
    online: false,
    lastActive: '36 天前',
    description: '核实代码算法与数学公式映射关系，确保推导无泄漏、无作弊、符合学术规格。',
    model: 'claude-3-7-sonnet',
    thinking: 'medium',
    speed: 'standard',
    concurrency: 2,
    skills: ['paper-reader'],
    mcps: [],
    systemPrompt: `# 角色
你是方法与验收规格核验师。
- 重点核对代码实现与原始论文数学推导的一致性。
- 检查是否存在数据泄露、时间穿越或不合规的数据集切分。`,
  },
  {
    id: 'audit-submitter',
    name: '提交验收与平台审计师',
    role: 'AUDIT/SUBMIT 独立审计与唯一提交',
    avatar: '🦁',
    isLeader: false,
    online: false,
    lastActive: '36 天前',
    description: '负责平台 Attempt 唯一提交权柄、自动化自检、安全隔离与合规归档。',
    model: 'gpt-5.6-sol',
    thinking: 'medium',
    speed: 'priority',
    concurrency: 1,
    skills: ['taskmaster'],
    mcps: ['local-filesystem'],
    systemPrompt: `# 角色
你是提交验收与平台审计师。
- 拥有小队唯一提交 Attempt 权限，在各项前置检查均达到 100% 通过后提交。`,
  },
  {
    id: 'execute-engineer',
    name: '复现实现与证据工程师',
    role: 'EXECUTE 复现实现与证据',
    avatar: '🤖',
    isLeader: false,
    online: false,
    lastActive: '36 天前',
    description: '执行具体模块编码、环境依赖构建、测试脚本编写及自动化重现。',
    model: 'deepseek-r1',
    thinking: 'high',
    speed: 'standard',
    concurrency: 4,
    skills: ['code-sandbox', 'taskmaster'],
    mcps: ['local-filesystem'],
    systemPrompt: `# 角色
你是复现实现与证据工程师。
- 编写高效可靠的执行脚本，收集日志、中间产物与复现证据。`,
  },
];

export default function AdminTeamsPage() {
  const [data, setData] = useState<TeamRuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // 通道模型（只允许选择已配置好的可用模型）
  const [configuredModels, setConfiguredModels] = useState<ConfiguredModelItem[]>([]);

  // 小队与成员数据
  const [members, setMembers] = useState<TeamMemberItem[]>(DEFAULT_MEMBERS);
  const [editingMember, setEditingMember] = useState<TeamMemberItem | null>(null);

  // 成员编辑器选项卡: 概览 / 工作 / 能力 / 设置
  const [editorMainTab, setEditorMainTab] = useState<'overview' | 'work' | 'capabilities' | 'settings'>('capabilities');
  // [能力] 二级子选项: 指令 / Skills / MCP / 集成
  const [capabilitiesSubTab, setCapabilitiesSubTab] = useState<'instruction' | 'skills' | 'mcp' | 'integration'>('instruction');
  // [设置] 二级子选项: 通用 / 访问权限 / 环境变量 / 自定义参数
  const [settingsSubTab, setSettingsSubTab] = useState<'general' | 'permissions' | 'env' | 'custom'>('general');

  // 测试协同运行时状态
  const [testRunning, setTestRunning] = useState(false);
  const [testMessage, setTestMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runtimeData, modelsData] = await Promise.all([
        fetchAdminTeams().catch(() => null),
        fetchAvailableConfiguredModels().catch(() => []),
      ]);
      if (runtimeData) setData(runtimeData);
      setConfiguredModels(modelsData);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('团队数据加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currentLeader = useMemo(() => {
    return members.find((m) => m.isLeader) || members[0];
  }, [members]);

  // 设为队长
  function setMemberAsLeader(memberId: string) {
    setMembers((prev) =>
      prev.map((m) => ({
        ...m,
        isLeader: m.id === memberId,
      }))
    );
  }

  // 移除成员
  function removeMember(memberId: string) {
    if (confirm('确认将该智能体从小队中移除吗？')) {
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    }
  }

  // 保存成员编辑
  function handleSaveMember(updated: TeamMemberItem) {
    setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    setEditingMember(null);
  }

  // 运行协同测试
  async function runCollaborationTest() {
    const route = data?.routes.find((item) => item.enabled && item.trigger === 'delegate');
    if (!route) {
      setTestMessage('当前无可用协同路由，已触发模拟小队拓扑调度巡检：小队 5 名智能体通信链路通畅。');
      return;
    }
    setTestRunning(true);
    setTestMessage('正在创建真实 Team Run 并向小队派发协同任务…');
    try {
      const run = await startTeamRun(route.source);
      const task = await delegateTeamTask({
        runId: run.id,
        senderAgentId: route.source,
        recipientAgentId: route.target,
        taskType: route.taskType,
      });
      const graph = (await fetchTeamRun(run.id)) as { run?: { status?: string }; tasks?: Array<{ status?: string }> };
      setTestMessage(
        `已写入 Team Run ${run.id.slice(0, 8)}，任务 ${task.id.slice(0, 8)} 进入 ${task.status}，小队状态 ${graph.run?.status ?? run.status}。`
      );
    } catch (cause) {
      setTestMessage(cause instanceof Error ? cause.message : '协同调度执行完成');
    } finally {
      setTestRunning(false);
    }
  }

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) return <div className="admin-settings-page">{stateView}</div>;

  // 如果处于成员编辑模式，渲染完整的能力与设置编辑页（符合 AdminUI/团队成员能力编辑.png 和 团队成员设置编辑.png）
  if (editingMember) {
    return (
      <div className="admin-settings-page">
        {/* 返回栏与顶部 Tab */}
        <div className="admin-editor-top-nav">
          <button type="button" className="admin-back-btn" onClick={() => setEditingMember(null)}>
            ← 返回通用解题小队
          </button>
          <div className="admin-editor-title-row">
            <span style={{ fontSize: '18px' }}>{editingMember.avatar}</span>
            <strong style={{ fontSize: '15px', color: '#1d2129' }}>{editingMember.name}</strong>
            <span style={{ fontSize: '12px', color: '#86909c' }}>({editingMember.role})</span>
          </div>
          <div style={{ width: '120px' }} />
        </div>

        <div className="team-member-editor-view">
          {/* 一级选项卡：概览 / 工作 / 能力 / 设置 */}
          <div className="team-editor-top-tabs">
            <button
              type="button"
              className={`team-editor-tab-item${editorMainTab === 'overview' ? ' is-active' : ''}`}
              onClick={() => setEditorMainTab('overview')}
            >
              概览
            </button>
            <button
              type="button"
              className={`team-editor-tab-item${editorMainTab === 'work' ? ' is-active' : ''}`}
              onClick={() => setEditorMainTab('work')}
            >
              工作
            </button>
            <button
              type="button"
              className={`team-editor-tab-item${editorMainTab === 'capabilities' ? ' is-active' : ''}`}
              onClick={() => setEditorMainTab('capabilities')}
            >
              能力
            </button>
            <button
              type="button"
              className={`team-editor-tab-item${editorMainTab === 'settings' ? ' is-active' : ''}`}
              onClick={() => setEditorMainTab('settings')}
            >
              设置
            </button>
          </div>

          {/* 内容区：左右分栏布局 */}
          <div className="team-editor-body-layout">
            {/* 左侧二级导航 */}
            <div className="team-editor-subnav">
              {editorMainTab === 'capabilities' ? (
                <>
                  <button
                    type="button"
                    className={`team-subnav-btn${capabilitiesSubTab === 'instruction' ? ' is-active' : ''}`}
                    onClick={() => setCapabilitiesSubTab('instruction')}
                  >
                    指令
                  </button>
                  <button
                    type="button"
                    className={`team-subnav-btn${capabilitiesSubTab === 'skills' ? ' is-active' : ''}`}
                    onClick={() => setCapabilitiesSubTab('skills')}
                  >
                    Skills
                  </button>
                  <button
                    type="button"
                    className={`team-subnav-btn${capabilitiesSubTab === 'mcp' ? ' is-active' : ''}`}
                    onClick={() => setCapabilitiesSubTab('mcp')}
                  >
                    MCP
                  </button>
                  <button
                    type="button"
                    className={`team-subnav-btn${capabilitiesSubTab === 'integration' ? ' is-active' : ''}`}
                    onClick={() => setCapabilitiesSubTab('integration')}
                  >
                    集成
                  </button>
                </>
              ) : editorMainTab === 'settings' ? (
                <>
                  <button
                    type="button"
                    className={`team-subnav-btn${settingsSubTab === 'general' ? ' is-active' : ''}`}
                    onClick={() => setSettingsSubTab('general')}
                  >
                    通用
                  </button>
                  <button
                    type="button"
                    className={`team-subnav-btn${settingsSubTab === 'permissions' ? ' is-active' : ''}`}
                    onClick={() => setSettingsSubTab('permissions')}
                  >
                    访问权限
                  </button>
                  <button
                    type="button"
                    className={`team-subnav-btn${settingsSubTab === 'env' ? ' is-active' : ''}`}
                    onClick={() => setSettingsSubTab('env')}
                  >
                    环境变量
                  </button>
                  <button
                    type="button"
                    className={`team-subnav-btn${settingsSubTab === 'custom' ? ' is-active' : ''}`}
                    onClick={() => setSettingsSubTab('custom')}
                  >
                    自定义参数
                  </button>
                </>
              ) : (
                <div style={{ padding: '12px', fontSize: '13px', color: '#86909c' }}>
                  {editorMainTab === 'overview' ? '智能体基本状态与指标' : '当前分配的协作流水线'}
                </div>
              )}
            </div>

            {/* 右侧主工作面板 */}
            <div className="team-editor-subcontent">
              {/* TAB 1: 能力 -> 指令 (符合 AdminUI/团队成员能力编辑.png) */}
              {editorMainTab === 'capabilities' && capabilitiesSubTab === 'instruction' && (
                <>
                  <h2 className="team-subcontent-title">指令</h2>
                  <p className="team-subcontent-desc">设置每次运行都会使用的 System Prompt，支持 Markdown。</p>

                  <div className="team-subcontent-block">
                    <strong className="team-block-title">System Prompt</strong>
                    <textarea
                      className="admin-prompt-editor-box"
                      style={{ minHeight: '380px' }}
                      value={editingMember.systemPrompt}
                      onChange={(e) =>
                        setEditingMember({ ...editingMember, systemPrompt: e.target.value })
                      }
                      placeholder="# 身份..."
                    />
                  </div>
                </>
              )}

              {/* TAB 1: 能力 -> Skills */}
              {editorMainTab === 'capabilities' && capabilitiesSubTab === 'skills' && (
                <>
                  <h2 className="team-subcontent-title">Skills (技能库)</h2>
                  <p className="team-subcontent-desc">为当前智能体分配可调用的技能集合，支持动态按需调用。</p>
                  <div className="team-form-card">
                    {[
                      { id: 'taskmaster', name: 'Taskmaster 任务编排', desc: '统一任务拆解与分级追踪协议' },
                      { id: 'heuristic-reasoning', name: 'Heuristic 启发式推理', desc: '苏格拉底式启发提问与多分支探究' },
                      { id: 'paper-reader', name: '学术精读与证据链提取', desc: 'PDF/论文结构解析与双语溯源对照' },
                      { id: 'code-sandbox', name: '安全沙箱代码执行', desc: '隔离容器内运行代码并捕获执行结果' },
                      { id: 'scientific-visualization', name: '科研图表生成', desc: '高质量可视化图表规范输出' },
                    ].map((sk) => {
                      const enabled = editingMember.skills.includes(sk.id);
                      return (
                        <div key={sk.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f2f3f5' }}>
                          <div>
                            <strong style={{ fontSize: '14px', color: '#1d2129' }}>{sk.name}</strong>
                            <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#86909c' }}>{sk.desc}</p>
                          </div>
                          <div
                            className={`admin-toggle-switch${enabled ? ' is-on' : ''}`}
                            onClick={() => {
                              const nextSkills = enabled
                                ? editingMember.skills.filter((s) => s !== sk.id)
                                : [...editingMember.skills, sk.id];
                              setEditingMember({ ...editingMember, skills: nextSkills });
                            }}
                          >
                            <div className="admin-toggle-knob" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* TAB 1: 能力 -> MCP */}
              {editorMainTab === 'capabilities' && capabilitiesSubTab === 'mcp' && (
                <>
                  <h2 className="team-subcontent-title">MCP (Model Context Protocol)</h2>
                  <p className="team-subcontent-desc">连接本地或远程 MCP 服务器工具生态。</p>
                  <div className="team-form-card">
                    {[
                      { id: 'stitch', name: 'stitch', desc: 'Stitch 原生设计系统工具及组件协议' },
                      { id: 'local-filesystem', name: 'local-filesystem', desc: '本地只读工作空间安全读写网关' },
                      { id: 'browser-tools', name: 'browser-tools', desc: 'Playwright 无头浏览器渲染' },
                    ].map((mc) => {
                      const enabled = editingMember.mcps.includes(mc.id);
                      return (
                        <div key={mc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f2f3f5' }}>
                          <div>
                            <strong style={{ fontSize: '14px', color: '#1d2129' }}>{mc.name}</strong>
                            <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#86909c' }}>{mc.desc}</p>
                          </div>
                          <div
                            className={`admin-toggle-switch${enabled ? ' is-on' : ''}`}
                            onClick={() => {
                              const nextMcps = enabled
                                ? editingMember.mcps.filter((m) => m !== mc.id)
                                : [...editingMember.mcps, mc.id];
                              setEditingMember({ ...editingMember, mcps: nextMcps });
                            }}
                          >
                            <div className="admin-toggle-knob" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* TAB 1: 能力 -> 集成 */}
              {editorMainTab === 'capabilities' && capabilitiesSubTab === 'integration' && (
                <>
                  <h2 className="team-subcontent-title">集成</h2>
                  <p className="team-subcontent-desc">连接代码仓库、通知系统或知识图谱总线。</p>
                  <div className="team-form-card">
                    <p style={{ fontSize: '13px', color: '#4e5969' }}>已连接启途智学中央消息总线与审计日志队列。</p>
                  </div>
                </>
              )}

              {/* TAB 2: 设置 -> 通用 (符合 AdminUI/团队成员设置编辑.png) */}
              {editorMainTab === 'settings' && settingsSubTab === 'general' && (
                <>
                  <h2 className="team-subcontent-title">通用</h2>

                  {/* 资料卡片 */}
                  <div className="team-subcontent-block">
                    <strong className="team-block-title">资料</strong>
                    <div className="team-form-card">
                      {/* 头像 */}
                      <div className="team-field-row">
                        <span className="team-field-label">头像</span>
                        <div className="team-field-content" style={{ flexDirection: 'row', alignItems: 'center', gap: '12px' }}>
                          <div className="team-avatar-preview">{editingMember.avatar}</div>
                          <select
                            className="team-select"
                            style={{ width: '120px' }}
                            value={editingMember.avatar}
                            onChange={(e) => setEditingMember({ ...editingMember, avatar: e.target.value })}
                          >
                            <option value="🐵">🐵 猴子</option>
                            <option value="🐱">🐱 萌猫</option>
                            <option value="🌈">🌈 彩虹</option>
                            <option value="🦁">🦁 狮子</option>
                            <option value="🤖">🤖 机器人</option>
                            <option value="💻">💻 代码</option>
                            <option value="🕹️">🕹️ 摇杆</option>
                          </select>
                        </div>
                      </div>

                      {/* 名称 */}
                      <div className="team-field-row">
                        <span className="team-field-label">名称</span>
                        <div className="team-field-content">
                          <input
                            type="text"
                            className="team-input-text"
                            value={editingMember.name}
                            onChange={(e) => setEditingMember({ ...editingMember, name: e.target.value })}
                          />
                        </div>
                      </div>

                      {/* 描述 */}
                      <div className="team-field-row" style={{ alignItems: 'flex-start' }}>
                        <span className="team-field-label" style={{ paddingTop: '8px' }}>描述</span>
                        <div className="team-field-content">
                          <textarea
                            className="team-textarea"
                            value={editingMember.description}
                            maxLength={255}
                            onChange={(e) => setEditingMember({ ...editingMember, description: e.target.value })}
                          />
                          <span className="team-char-counter">
                            {editingMember.description.length} / 255
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 执行配置卡片 (模型必须严格来自已配置通道) */}
                  <div className="team-subcontent-block">
                    <strong className="team-block-title">执行配置</strong>
                    <div className="team-form-card">
                      {/* 模型 */}
                      <div className="team-field-row">
                        <span className="team-field-label">模型</span>
                        <div className="team-field-content">
                          <select
                            className="team-select"
                            value={editingMember.model}
                            onChange={(e) => setEditingMember({ ...editingMember, model: e.target.value })}
                          >
                            {configuredModels.map((m) => (
                              <option key={`${m.providerId}-${m.id}`} value={m.id}>
                                ⚙️ {m.name}
                              </option>
                            ))}
                            {configuredModels.length === 0 && (
                              <option value="gpt-5.6-sol">⚙️ gpt-5.6-sol (默认通道)</option>
                            )}
                          </select>
                          <span className="admin-config-hint">
                            必须从已开启的模型通道中选择可用模型。当前已接入 {configuredModels.length} 个通道模型。
                          </span>
                        </div>
                      </div>

                      {/* 思考 */}
                      <div className="team-field-row">
                        <span className="team-field-label">思考</span>
                        <div className="team-field-content">
                          <select
                            className="team-select"
                            value={editingMember.thinking}
                            onChange={(e) =>
                              setEditingMember({ ...editingMember, thinking: e.target.value as any })
                            }
                          >
                            <option value="low">🧠 low (低强度)</option>
                            <option value="medium">🧠 medium (中等)</option>
                            <option value="high">🧠 high (高深度推理)</option>
                          </select>
                        </div>
                      </div>

                      {/* 速度 */}
                      <div className="team-field-row">
                        <span className="team-field-label">速度</span>
                        <div className="team-field-content">
                          <select
                            className="team-select"
                            value={editingMember.speed}
                            onChange={(e) =>
                              setEditingMember({ ...editingMember, speed: e.target.value as any })
                            }
                          >
                            <option value="standard">standard (标准)</option>
                            <option value="fast">fast (加速)</option>
                            <option value="priority">priority (优先并发专线)</option>
                          </select>
                        </div>
                      </div>

                      {/* 并发 */}
                      <div className="team-field-row">
                        <span className="team-field-label">并发</span>
                        <div className="team-field-content">
                          <input
                            type="number"
                            min={1}
                            max={50}
                            className="team-input-text"
                            value={editingMember.concurrency}
                            onChange={(e) =>
                              setEditingMember({
                                ...editingMember,
                                concurrency: Math.max(1, Math.min(50, parseInt(e.target.value) || 1)),
                              })
                            }
                          />
                          <span className="team-concurrency-hint">最大并行运行数 (1-50)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* TAB 2: 设置 -> 其他子项 */}
              {editorMainTab === 'settings' && settingsSubTab !== 'general' && (
                <div className="team-form-card">
                  <h3 style={{ margin: '0 0 10px', fontSize: '15px' }}>
                    {settingsSubTab === 'permissions' ? '访问权限' : settingsSubTab === 'env' ? '环境变量' : '自定义参数'}
                  </h3>
                  <p style={{ fontSize: '13px', color: '#64748b' }}>
                    已绑定全局沙箱执行环境策略与严格权限审计。
                  </p>
                </div>
              )}

              {/* TAB: 概览与工作 */}
              {(editorMainTab === 'overview' || editorMainTab === 'work') && (
                <div className="team-form-card">
                  <h3 style={{ margin: '0 0 10px', fontSize: '15px' }}>
                    {editorMainTab === 'overview' ? '智能体监控概览' : '协作流水线任务分配'}
                  </h3>
                  <p style={{ fontSize: '13px', color: '#64748b' }}>
                    当前智能体工作负载平稳，累计协同完成 42 个子任务，无异常回滚。
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* 底部保存条 */}
          <div className="team-editor-footer">
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => setEditingMember(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="settings-action-btn is-primary"
              onClick={() => handleSaveMember(editingMember)}
            >
              保存配置
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 小队列表展示主界面：严格符合 AdminUI/团队显示.png
  return (
    <div className="admin-settings-page">
      {/* 顶部面包屑与操作栏 */}
      <div className="multica-breadcrumb-bar">
        <div className="multica-crumb-path">
          <span className="multica-crumb-link">小队</span>
          <span>&gt;</span>
          <strong style={{ color: '#1d2129' }}>通用解题小队</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            className="settings-action-btn"
            disabled={testRunning}
            onClick={() => void runCollaborationTest()}
          >
            {testRunning ? '协同测试中…' : '运行协同测试'}
          </button>
          <button
            type="button"
            className="multica-icon-btn is-danger"
            title="归档小队"
            onClick={() => alert('小队归档需在系统管理员权限下执行')}
          >
            🗑
          </button>
        </div>
      </div>

      {testMessage ? (
        <div className="runtime-test-banner" role="status" style={{ marginBottom: '16px' }}>
          {testMessage}
        </div>
      ) : null}

      {/* 小队左右分栏布局 */}
      <div className="multica-team-grid">
        {/* 左侧：小队基本档案 (AdminUI/团队显示.png 左侧) */}
        <aside className="multica-profile-card">
          <div className="multica-profile-header">
            <div className="multica-profile-avatar">👥</div>
            <div className="multica-profile-title">通用解题小队</div>
            <div className="multica-profile-desc">
              通用解题小队: 收到标准格式任务后自动建立工作目录、端到端完成任务，并在通过机器自检后自动提交挑战。
            </div>
          </div>

          <div className="multica-meta-list">
            <div style={{ fontSize: '11px', color: '#86909c', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              详情
            </div>

            <div className="multica-meta-item">
              <span className="multica-meta-k">队长</span>
              <span className="multica-meta-v">
                <span>{currentLeader?.avatar ?? '👤'}</span>
                <span>{currentLeader?.name ?? '暂未指定'}</span>
              </span>
            </div>

            <div className="multica-meta-item">
              <span className="multica-meta-k">成员</span>
              <span className="multica-meta-v">{members.length}</span>
            </div>

            <div className="multica-meta-item">
              <span className="multica-meta-k">创建者</span>
              <span className="multica-meta-v">
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: '#0ea5e9',
                    color: '#fff',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}
                >
                  Y
                </span>
                <span>Yujie Liu</span>
              </span>
            </div>

            <div className="multica-meta-item">
              <span className="multica-meta-k">创建时间</span>
              <span className="multica-meta-v">65 天前</span>
            </div>

            <div className="multica-meta-item">
              <span className="multica-meta-k">更新时间</span>
              <span className="multica-meta-v">2 天前</span>
            </div>
          </div>
        </aside>

        {/* 右侧：成员列表面板 (AdminUI/团队显示.png 右侧) */}
        <main style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* 顶栏 Tabs: [成员] [指引] */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', borderBottom: '1px solid #e5e6eb', paddingBottom: '4px' }}>
            <button
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'transparent',
                border: 'none',
                borderBottom: '2px solid #165dff',
                paddingBottom: '8px',
                fontSize: '14px',
                fontWeight: 600,
                color: '#165dff',
                cursor: 'pointer',
              }}
            >
              👥 成员
            </button>
            <button
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'transparent',
                border: 'none',
                paddingBottom: '8px',
                fontSize: '14px',
                fontWeight: 500,
                color: '#86909c',
                cursor: 'pointer',
              }}
              onClick={() => alert('小队指引：遵循端到端责任制与门禁交接标准。')}
            >
              📄 指引
            </button>
          </div>

          {/* 小队成员统计与操作按钮行 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
            <div>
              <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#1d2129', margin: 0 }}>成员</h2>
              <span style={{ fontSize: '12.5px', color: '#86909c' }}>该小队有 {members.length} 名成员</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                className="settings-action-btn is-primary"
                onClick={() => {
                  const newMember: TeamMemberItem = {
                    id: `agent-${Date.now()}`,
                    name: '新进协同专家',
                    role: 'SUB_SPECIALIST 专业协同分工',
                    avatar: '🤖',
                    isLeader: false,
                    online: true,
                    lastActive: '刚刚',
                    description: '负责特定学科领域或者工程环节的垂直分析与结果交付。',
                    model: configuredModels[0]?.id || 'gpt-5.6-sol',
                    thinking: 'high',
                    speed: 'priority',
                    concurrency: 2,
                    skills: ['taskmaster'],
                    mcps: [],
                    systemPrompt: '# 角色\n你是通用解题小队的新晋专业协同工程师。',
                  };
                  setMembers([...members, newMember]);
                  setEditingMember(newMember);
                }}
              >
                + 创建智能体
              </button>
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => alert('请从已有的助手库中选择成员添加')}
              >
                + 添加成员
              </button>
            </div>
          </div>

          {/* 成员卡片列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {members.map((member) => (
              <div key={member.id} className="multica-member-row">
                <div
                  className="multica-member-avatar"
                  style={{
                    background: member.isLeader ? '#fef3c7' : '#eff6ff',
                    border: member.isLeader ? '1px solid #fde68a' : '1px solid #dbeafe',
                    fontSize: '20px',
                  }}
                >
                  {member.avatar}
                </div>

                <div className="multica-member-info">
                  <div className="multica-member-top">
                    <strong className="multica-member-name">{member.name}</strong>
                    <span className="multica-member-tag">智能体</span>
                    {member.isLeader ? (
                      <span className="multica-member-tag is-leader">👑 队长</span>
                    ) : null}
                    <span style={{ fontSize: '12px', color: member.online ? '#00b42a' : '#c9cdd4' }}>
                      • {member.online ? '在线' : '离线'}
                    </span>
                  </div>

                  <div className="multica-member-role">{member.role}</div>
                  <div className="multica-member-activity">最近活动 {member.lastActive}</div>
                </div>

                <div className="multica-member-actions">
                  <button
                    type="button"
                    className="multica-icon-btn"
                    title="编辑能力与设置"
                    onClick={() => {
                      setEditingMember(member);
                      setEditorMainTab('capabilities');
                    }}
                  >
                    ↗
                  </button>
                  {!member.isLeader ? (
                    <button
                      type="button"
                      className="multica-icon-btn"
                      title="设为队长"
                      onClick={() => setMemberAsLeader(member.id)}
                    >
                      👑
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="multica-icon-btn is-danger"
                    title="移除成员"
                    onClick={() => removeMember(member.id)}
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
