'use client';

import { useState, useEffect } from 'react';
import { TeamStatusBadge, type TeamNodeStatus } from '@qitu/ui';

interface TutorTeamRailProps {
  currentTeam?: 'team-thunder-fighter' | 'team-kinetic-energy';
  streaming: boolean;
  ready: boolean;
  failed: boolean;
  offline: boolean;
  isOpen?: boolean;
  onToggleOpen?: () => void;
  initialTab?: 'progress' | 'members';
}

export function TutorTeamRail({
  currentTeam = 'team-kinetic-energy',
  streaming,
  ready,
  failed,
  offline,
  isOpen = false,
  onToggleOpen,
  initialTab = 'progress',
}: TutorTeamRailProps) {
  const [activeTab, setActiveTab] = useState<'progress' | 'members'>(initialTab);
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set([2]));

  // 当外部传入 initialTab 改变时同步更新（例如从 HUD 点击子 Agent 展开）
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const togglePhase = (id: number) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const leaderStatus: TeamNodeStatus = offline
    ? 'offline'
    : failed
    ? 'failed'
    : streaming
    ? 'running'
    : ready
    ? 'ready'
    : 'waiting';

  const isKinetic = currentTeam === 'team-kinetic-energy';

  // 多层级项目规划树 (Phases -> Subtasks & Checkpoints)
  const phasesHierarchy = isKinetic
    ? [
        {
          id: 1,
          title: '受力与运动生活情境观察',
          status: 'completed' as const,
          progress: 100,
          phaseLabel: '阶段一：意图与情境',
          description: '从汽车刹车距离与生活力学现象中提出探究假设。',
          subTasks: [
            { id: '1.1', title: '刹车距离与生活力学情境感知', status: 'completed' as const, duration: '15m', checkpoint: '情境反思已记录' },
            { id: '1.2', title: '提出探究假设与控制变量方案', status: 'completed' as const, duration: '20m', checkpoint: '假设表单已归档' },
          ],
        },
        {
          id: 2,
          title: '原理推导与动态仿真交互',
          status: 'current' as const,
          progress: 65,
          phaseLabel: '阶段二：核心原理探究',
          description: '推导动能定理 W=ΔEk，通过参数实验台观察做功与动能非线性变化。',
          subTasks: [
            { id: '2.1', title: '恒力做功与微元法理论推导 (W=F·s)', status: 'completed' as const, duration: '30m', checkpoint: 'KaTeX 彩色公式推导完成' },
            { id: '2.2', title: '动能定理动态探究工作台参数测试', status: 'in_progress' as const, duration: '25m', checkpoint: '质量线性 vs 速度平方倍增对比中' },
            { id: '2.3', title: '动态电路欧姆定律与串并联仿真实验', status: 'in_progress' as const, duration: '20m', checkpoint: '串联分压与并联分流模型交互就绪' },
          ],
        },
        {
          id: 3,
          title: '门禁核准：TheoryMastered 概念评估',
          status: 'pending' as const,
          progress: 0,
          phaseLabel: '强门禁审查',
          description: '概念教练对能量转化、标量性质进行全面考评，阻断代码阶段抢跑。',
          subTasks: [
            { id: '3.1', title: '核心物理概念掌握度测试量规', status: 'locked' as const, duration: '25m', checkpoint: '需达标 85% 解锁实践' },
            { id: '3.2', title: '苏格拉底导师答辩质询考核', status: 'locked' as const, duration: '15m', checkpoint: '概念盲区排除' },
          ],
        },
        {
          id: 4,
          title: '工程实践：Python 物理数值仿真与绘图',
          status: 'pending' as const,
          progress: 0,
          phaseLabel: '阶段三：算法与仿真',
          description: '利用 RK4 数值微分算法仿真受阻运动，绘制动能拟合曲线。',
          subTasks: [
            { id: '4.1', title: '配置 Python RK4 数值积分物理沙箱', status: 'locked' as const, duration: '45m', checkpoint: '沙箱 Traceback 自检' },
            { id: '4.2', title: '绘制功-动能增量实验拟合曲线', status: 'locked' as const, duration: '30m', checkpoint: '拟合误差控制在 5% 以内' },
          ],
        },
        {
          id: 5,
          title: '结项答辩与综合素养归档',
          status: 'pending' as const,
          progress: 0,
          phaseLabel: '阶段四：反思复盘',
          description: '撰写能量守恒元认知反思报告，由评审导师生成核心素养档案。',
          subTasks: [
            { id: '5.1', title: '撰写物理探究与元认知反思报告', status: 'locked' as const, duration: '30m', checkpoint: '反思自评量规提交' },
            { id: '5.2', title: '答辩质询与生成核心素养证书', status: 'locked' as const, duration: '20m', checkpoint: '终期成长雷达建档' },
          ],
        },
      ]
    : [
        {
          id: 1,
          title: '游戏概念构思：玩法机制与素材规划',
          status: 'completed' as const,
          progress: 100,
          phaseLabel: '阶段一：意图确认',
          description: '确定飞机射击游戏基本玩法机制、敌机波次与武器系统。',
          subTasks: [
            { id: '1.1', title: '玩法机制设计与关卡规则制定', status: 'completed' as const, duration: '20m', checkpoint: '游戏规则确认' },
            { id: '1.2', title: '游戏资源与精灵素材清单规划', status: 'completed' as const, duration: '20m', checkpoint: '资源目录初始化' },
          ],
        },
        {
          id: 2,
          title: '核心原理探索：游戏主循环与坐标刷新',
          status: 'completed' as const,
          progress: 100,
          phaseLabel: '阶段二：核心概念',
          description: '理解游戏 60FPS 帧率循环、事件捕获与笛卡尔坐标系统。',
          subTasks: [
            { id: '2.1', title: 'Pygame 游戏主循环机制深度拆解', status: 'completed' as const, duration: '25m', checkpoint: '事件队列机制掌握' },
            { id: '2.2', title: '精灵移动与笛卡尔坐标变换原理', status: 'completed' as const, duration: '25m', checkpoint: '坐标连续帧更新验证' },
          ],
        },
        {
          id: 3,
          title: '几何算法攻坚：AABB 矩形碰撞检测',
          status: 'current' as const,
          progress: 50,
          phaseLabel: '阶段二：碰撞算法',
          description: '探索重叠区域区间交集算法，从几何数学推导到代码落地。',
          subTasks: [
            { id: '3.1', title: 'AABB 碰撞检测数学模型推导', status: 'completed' as const, duration: '30m', checkpoint: '区间不重叠反证法掌握' },
            { id: '3.2', title: '子弹击中敌机碰撞算法代码实现', status: 'in_progress' as const, duration: '35m', checkpoint: '碰撞响应自检调试' },
          ],
        },
        {
          id: 4,
          title: '门禁核准：TheoryMastered 掌握度评估',
          status: 'pending' as const,
          progress: 0,
          phaseLabel: '强门禁审查',
          description: '确保学生透彻理解游戏循环与碰撞几何原理，阻断代码盲目复制。',
          subTasks: [
            { id: '4.1', title: '游戏主循环与碰撞算法综合测评', status: 'locked' as const, duration: '20m', checkpoint: '理论掌握度 > 85%' },
          ],
        },
        {
          id: 5,
          title: '代码构建：完整战机小游戏实现与答辩',
          status: 'pending' as const,
          progress: 0,
          phaseLabel: '阶段三：工程与答辩',
          description: '整合玩家飞机、敌机生成、生命值与计分系统，完成作品答辩。',
          subTasks: [
            { id: '5.1', title: '多文件结构重构与音效粒子特效', status: 'locked' as const, duration: '60m', checkpoint: '可执行游戏包交付' },
            { id: '5.2', title: '作品结项答辩与能力画像更新', status: 'locked' as const, duration: '25m', checkpoint: '代码评审报告归档' },
          ],
        },
      ];

  if (!isOpen) {
    return (
      <aside
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
        onClick={onToggleOpen}
        title="点击展开项目进度与导师状态面板"
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
          ◀
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
          {isKinetic ? '动能定理 · 进度与团队' : '雷霆战机 · 进度与团队'}
        </span>
      </aside>
    );
  }

  return (
    <aside
      className="qitu-tutor-col qitu-tutor-col-right qitu-tutor-team-rail"
      aria-label="项目进度与 AI 导师 Team"
      style={{
        width: '320px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
        border: '1px solid #e4ecf7',
        borderRadius: '14px',
        boxShadow: '0 4px 16px rgba(16, 42, 92, 0.04)',
        overflow: 'hidden',
      }}
    >
      {/* 头部与折叠按钮 */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: '11px', color: '#2563eb', fontWeight: 700, letterSpacing: '0.08em' }}>PBL WORKSPACE</span>
          <h3 style={{ margin: '2px 0 0', fontSize: '14px', color: '#0f172a', fontWeight: 700 }}>
            {isKinetic ? '动手学动能定理' : '雷霆战机小游戏'}
          </h3>
        </div>
        <button
          type="button"
          onClick={onToggleOpen}
          title="收起右侧面板"
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '4px',
            borderRadius: '4px',
          }}
        >
          ▶
        </button>
      </div>

      {/* 两个 Tab 切换 */}
      <div style={{ display: 'flex', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
        <button
          type="button"
          onClick={() => setActiveTab('progress')}
          style={{
            flex: 1,
            padding: '9px 0',
            fontSize: '12.5px',
            fontWeight: activeTab === 'progress' ? 700 : 500,
            color: activeTab === 'progress' ? '#2563eb' : '#64748b',
            border: 'none',
            borderBottom: activeTab === 'progress' ? '2px solid #2563eb' : '2px solid transparent',
            background: activeTab === 'progress' ? '#ffffff' : 'transparent',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          📊 项目进度与检查点
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('members')}
          style={{
            flex: 1,
            padding: '9px 0',
            fontSize: '12.5px',
            fontWeight: activeTab === 'members' ? 700 : 500,
            color: activeTab === 'members' ? '#2563eb' : '#64748b',
            border: 'none',
            borderBottom: activeTab === 'members' ? '2px solid #2563eb' : '2px solid transparent',
            background: activeTab === 'members' ? '#ffffff' : 'transparent',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          👥 导师团队状态
        </button>
      </div>

      {/* Tab 内容区 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {activeTab === 'progress' ? (
          <div>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: '#64748b' }}>PBL 项目推进总览</span>
                <span style={{ fontSize: '11px', background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: '12px', fontWeight: 700 }}>
                  总体进度: 45% (阶段 2 推进中)
                </span>
              </div>
              <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ width: '45%', height: '100%', background: 'linear-gradient(90deg, #2563eb, #7c3aed)', borderRadius: '999px' }} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {phasesHierarchy.map((phase) => {
                const isDone = phase.status === 'completed';
                const isCur = phase.status === 'current';
                const isExpanded = expandedPhases.has(phase.id);

                return (
                  <div
                    key={phase.id}
                    style={{
                      borderRadius: '10px',
                      border: isCur ? '1.5px solid #3b82f6' : '1px solid #e2e8f0',
                      background: isCur ? '#f8faff' : isDone ? '#f0fdf4' : '#ffffff',
                      overflow: 'hidden',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {/* 阶段层级头部 (Level 2) - 点击展开/折叠 */}
                    <div
                      onClick={() => togglePhase(phase.id)}
                      style={{
                        padding: '10px 12px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '10px',
                        cursor: 'pointer',
                        background: isCur ? '#eff6ff' : 'transparent',
                      }}
                    >
                      <div
                        style={{
                          width: '22px',
                          height: '22px',
                          borderRadius: '50%',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: '11px',
                          fontWeight: 700,
                          background: isDone ? '#10b981' : isCur ? '#3b82f6' : '#e2e8f0',
                          color: isDone || isCur ? '#ffffff' : '#64748b',
                          flexShrink: 0,
                          marginTop: '1px',
                        }}
                      >
                        {isDone ? '✓' : phase.id}
                      </div>

                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                          <span style={{ fontSize: '13px', fontWeight: isCur ? 700 : 600, color: isCur ? '#1d4ed8' : '#1e293b' }}>
                            {phase.title}
                          </span>
                          <span style={{ fontSize: '11px', color: '#64748b' }}>
                            {isExpanded ? '▲' : '▼'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                          <span style={{ fontSize: '10.5px', color: '#64748b' }}>{phase.phaseLabel}</span>
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 600,
                              padding: '1px 6px',
                              borderRadius: '999px',
                              background: isDone ? '#dcfce7' : isCur ? '#fef3c7' : '#f1f5f9',
                              color: isDone ? '#15803d' : isCur ? '#b45309' : '#64748b',
                            }}
                          >
                            {isDone ? '● 已完成 100%' : isCur ? `● 推进中 ${phase.progress}%` : '○ 锁定'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 子任务与检查点层级 (Level 3 - 展开树) */}
                    {isExpanded ? (
                      <div
                        style={{
                          padding: '8px 12px 10px 38px',
                          borderTop: '1px solid #f1f5f9',
                          background: '#ffffff',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        <p style={{ margin: '0 0 4px', fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
                          {phase.description}
                        </p>

                        {phase.subTasks.map((task) => (
                          <div
                            key={task.id}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              justifyContent: 'space-between',
                              gap: '8px',
                              padding: '6px 8px',
                              borderRadius: '6px',
                              background: task.status === 'in_progress' ? '#eff6ff' : '#f8fafc',
                              border: task.status === 'in_progress' ? '1px solid #bfdbfe' : '1px solid #f1f5f9',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', minWidth: 0 }}>
                              <span style={{ fontSize: '12px' }}>
                                {task.status === 'completed' ? '✅' : task.status === 'in_progress' ? '⚡' : '🔒'}
                              </span>
                              <div>
                                <div style={{ fontSize: '12px', fontWeight: task.status === 'in_progress' ? 700 : 500, color: task.status === 'in_progress' ? '#1d4ed8' : '#334155' }}>
                                  {task.title}
                                </div>
                                <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px' }}>
                                  检查点: {task.checkpoint}
                                </div>
                              </div>
                            </div>
                            <span style={{ fontSize: '10.5px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                              {task.duration}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: '16px', padding: '10px 12px', background: '#fefce8', border: '1px solid #fef08a', borderRadius: '8px', fontSize: '12px', color: '#854d0e' }}>
              <strong>🔒 门禁规则锁定 (TheoryMastered)：</strong>
              <div style={{ marginTop: '2px', color: '#713f12' }}>在通过物理原理与数学推导考核前，系统将阻断代码实践任务，确保理论建构扎实。</div>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '12px', padding: '10px 12px', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>🤖 实时协作团队架构 (Herdr Multi-Agent)</span>
              </div>
              <div style={{ fontSize: '11px', color: '#3b82f6', marginTop: '4px', lineHeight: 1.4 }}>
                各子 Agent 协同运行，完成当前环节任务后自动休眠回收，触发新阶段时自动唤醒接入。
              </div>
            </div>

            <ol className="qitu-tutor-team-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
                    <strong style={{ fontSize: '13px', color: '#1e293b' }}>{isKinetic ? '苏格拉底物理教练' : '战机主循环教练'}</strong>
                  </div>
                  <TeamStatusBadge status="running" />
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  角色: Concept Coach · 主导苏格拉底启发式追问与门禁提问
                </div>
                <div style={{ fontSize: '10.5px', color: '#0369a1', marginTop: '4px', background: '#e0f2fe', padding: '2px 6px', borderRadius: '4px', display: 'inline-block' }}>
                  执行模型: DeepSeek R1 (思维链推理) · 活跃中
                </div>
              </div>

              <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#94a3b8' }} />
                    <strong style={{ fontSize: '13px', color: '#1e293b' }}>{isKinetic ? 'RK4 数值仿真 Agent' : 'AABB 碰撞检测引擎'}</strong>
                  </div>
                  <TeamStatusBadge status="ready" />
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  角色: Sandbox Runner · 执行微分方程积分与动态沙箱参数反馈
                </div>
                <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '4px', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', display: 'inline-block' }}>
                  执行模型: Python WebAssembly / Qwen-Coder · 待命
                </div>
              </div>

              <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#94a3b8' }} />
                    <strong style={{ fontSize: '13px', color: '#1e293b' }}>{isKinetic ? '严谨评审导师' : '代码架构评审导师'}</strong>
                  </div>
                  <TeamStatusBadge status="waiting" />
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  角色: Gate Reviewer · TheoryMastered 强门禁考核与代码安全审计
                </div>
                <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '4px', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', display: 'inline-block' }}>
                  执行模型: Claude 3.5 Sonnet (严谨考评) · 待命
                </div>
              </div>

              <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
                    <strong style={{ fontSize: '13px', color: '#1e293b' }}>学情画像与成长轨迹分析引擎</strong>
                  </div>
                  <TeamStatusBadge status="ready" />
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  角色: Profile & Growth Tracker · 实时捕获对话与交互维度的能力增长
                </div>
                <div style={{ fontSize: '10.5px', color: '#15803d', marginTop: '4px', background: '#dcfce7', padding: '2px 6px', borderRadius: '4px', display: 'inline-block' }}>
                  执行模型: 平台统一配置助手 · 后台常驻
                </div>
              </div>
            </ol>
            <p className="qitu-tutor-team-footnote" style={{ marginTop: '14px', fontSize: '11.5px', color: '#94a3b8' }}>
              各导师依据自建 Agent SDK 协同运作，在会话中根据阶段自动交接主导权。
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

function TutorTeamItem({ label, detail, status }: { label: string; detail: string; status: TeamNodeStatus }) {
  return (
    <li className="qitu-tutor-team-item">
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <TeamStatusBadge status={status} />
    </li>
  );
}
