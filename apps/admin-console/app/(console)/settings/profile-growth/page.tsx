'use client';

import { useState } from 'react';

interface DimensionSetting {
  id: string;
  name: string;
  description: string;
  weight: number;
  evalSource: string;
  enabled: boolean;
}

const DEFAULT_DIMENSIONS: DimensionSetting[] = [
  {
    id: 'dim-computational-thinking',
    name: '计算思维与算法建模',
    description: '评估学生对事件循环、坐标系、AABB 碰撞检测等算法逻辑的拆解与抽象建构能力。',
    weight: 30,
    evalSource: '雷霆战机主循环代码与算法推导对话',
    enabled: true,
  },
  {
    id: 'dim-scientific-modeling',
    name: '科学探究与原理推导',
    description: '评估动能定理 W=ΔEk 公式推导、受力分析以及实验假设求证的严谨度。',
    weight: 25,
    evalSource: 'TheoryMastered 理论门禁测评与概念教练问答',
    enabled: true,
  },
  {
    id: 'dim-engineering-sandbox',
    name: '工程实践与自检调试',
    description: '通过沙箱 Traceback 报错修复过程与主循环自检指标，评估工程坚韧度与代码整洁度。',
    weight: 25,
    evalSource: 'Python 代码执行沙箱与单元测试日志',
    enabled: true,
  },
  {
    id: 'dim-reflection-defense',
    name: '答辩质询与元认知反思',
    description: '评估结项答辩中对方案选型、困难定位及改进规划的口述表达与深度反思。',
    weight: 20,
    evalSource: '评审导师答辩质询量规与结项反思报告',
    enabled: true,
  },
];

interface EventCaptureRule {
  id: string;
  event: string;
  label: string;
  description: string;
  enabled: boolean;
  captureDetail: boolean;
}

const DEFAULT_EVENT_RULES: EventCaptureRule[] = [
  {
    id: 'evt-intent-confirmed',
    event: 'pbl.intent.confirmed',
    label: '开题意图确认',
    description: '记录学生自主确定 PBL 项目目标与玩法设想，生成项目启动里程碑。',
    enabled: true,
    captureDetail: true,
  },
  {
    id: 'evt-theory-mastered',
    event: 'pbl.gate.theory_mastered',
    label: 'TheoryMastered 理论门禁通关',
    description: '学生通过原理教练核心概念与数学推导考核，进入实践阶段的关键节点。',
    enabled: true,
    captureDetail: true,
  },
  {
    id: 'evt-sandbox-run',
    event: 'sandbox.code.executed',
    label: '沙箱代码自检与调试',
    description: '捕获代码执行成功、异常栈分析及自主排错轨迹，形成工程调试成长链。',
    enabled: true,
    captureDetail: false,
  },
  {
    id: 'evt-defense-completed',
    event: 'pbl.defense.completed',
    label: '结项答辩与量规评测',
    description: '记录评审导师的概念掌握度质询评分，生成永久成长档案。',
    enabled: true,
    captureDetail: true,
  },
];

export default function ProfileGrowthSettingsPage() {
  const [dimensions, setDimensions] = useState<DimensionSetting[]>(DEFAULT_DIMENSIONS);
  const [eventRules, setEventRules] = useState<EventCaptureRule[]>(DEFAULT_EVENT_RULES);

  // 隐私与隔离控制
  const [minorDataDesensitization, setMinorDataDesensitization] = useState(true);
  const [headTeacherExclusive, setHeadTeacherExclusive] = useState(true);
  const [parentReadonlyAccess, setParentReadonlyAccess] = useState(true);

  // AI 分析引擎
  const [profilingModel, setProfilingModel] = useState('gpt-4o');
  const [refreshCycle, setRefreshCycle] = useState('realtime-phase');
  const [saveNotice, setSaveNotice] = useState('');

  const totalWeight = dimensions.reduce((sum, d) => sum + (d.enabled ? d.weight : 0), 0);

  const handleSave = () => {
    if (totalWeight !== 100) {
      alert(`当前启用的维度权重之和为 ${totalWeight}%，请调整至 100% 后保存。`);
      return;
    }
    setSaveNotice('学情画像与成长轨迹配置已成功保存并同步全平台！✔');
    setTimeout(() => setSaveNotice(''), 2500);
  };

  return (
    <div className="admin-settings-page">
      <div className="settings-pagehead">
        <div className="settings-titlebox">
          <h1>学情画像与成长轨迹控制</h1>
          <div className="settings-desc">
            统一配置学生个人能力画像维度、PBL 四阶段事件流捕获、未成年人隐私隔离策略与 AI 动态分析模型。
          </div>
        </div>
        <div className="settings-page-actions">
          {saveNotice ? (
            <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: 600 }}>{saveNotice}</span>
          ) : null}
          <button type="button" className="settings-action-btn is-primary" onClick={handleSave}>
            💾 保存所有配置
          </button>
        </div>
      </div>

      {/* 模块一：能力画像维度设置 */}
      <section className="admin-editor-card" style={{ marginBottom: '16px' }}>
        <div className="admin-editor-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span className="admin-editor-section-title">1. 能力画像多维评价模型</span>
            <span style={{ marginLeft: '10px', fontSize: '12px', color: totalWeight === 100 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
              (当前总权重: {totalWeight}% {totalWeight === 100 ? '✔' : '⚠️ 需调整至 100%'})
            </span>
          </div>
          <button
            type="button"
            className="settings-action-btn"
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => {
              setDimensions(DEFAULT_DIMENSIONS);
            }}
          >
            ↺ 恢复默认权重
          </button>
        </div>

        <div style={{ display: 'grid', gap: '12px', marginTop: '12px' }}>
          {dimensions.map((dim) => (
            <div
              key={dim.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 140px 80px',
                alignItems: 'center',
                gap: '16px',
                padding: '12px 16px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <strong style={{ fontSize: '14px', color: '#0f172a' }}>{dim.name}</strong>
                  <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px' }}>
                    来源: {dim.evalSource}
                  </span>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                  {dim.description}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#475569' }}>权重:</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  style={{ width: '60px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  value={dim.weight}
                  disabled={!dim.enabled}
                  onChange={(e) => {
                    const val = Number(e.target.value) || 0;
                    setDimensions((prev) => prev.map((d) => (d.id === dim.id ? { ...d, weight: val } : d)));
                  }}
                />
                <span style={{ fontSize: '13px', color: '#64748b' }}>%</span>
              </div>

              <div style={{ textAlign: 'right' }}>
                <button
                  type="button"
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: '1px solid',
                    fontSize: '12px',
                    cursor: 'pointer',
                    background: dim.enabled ? '#eff6ff' : '#f1f5f9',
                    borderColor: dim.enabled ? '#bfdbfe' : '#cbd5e1',
                    color: dim.enabled ? '#1d4ed8' : '#94a3b8',
                    fontWeight: dim.enabled ? 600 : 400,
                  }}
                  onClick={() => {
                    setDimensions((prev) => prev.map((d) => (d.id === dim.id ? { ...d, enabled: !d.enabled } : d)));
                  }}
                >
                  {dim.enabled ? '已启用' : '已停用'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 模块二：成长轨迹事件流捕获 */}
      <section className="admin-editor-card" style={{ marginBottom: '16px' }}>
        <div className="admin-editor-card-header">
          <span className="admin-editor-section-title">2. PBL 关键事件流捕获与档案自动沉淀</span>
          <span className="admin-editor-tag is-green">不可篡改审计流</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '12px', marginTop: '12px' }}>
          {eventRules.map((rule) => (
            <div
              key={rule.id}
              style={{
                padding: '14px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <strong style={{ fontSize: '13px', color: '#0f172a' }}>{rule.label}</strong>
                  <code style={{ fontSize: '11px', color: '#165dff' }}>{rule.event}</code>
                </div>
                <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                  {rule.description}
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#475569', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={rule.captureDetail}
                    onChange={() => {
                      setEventRules((prev) =>
                        prev.map((r) => (r.id === rule.id ? { ...r, captureDetail: !r.captureDetail } : r))
                      );
                    }}
                  />
                  记录快照详情与代码 Diff
                </label>
                <div
                  className={`admin-toggle-switch${rule.enabled ? ' is-on' : ''}`}
                  onClick={() => {
                    setEventRules((prev) =>
                      prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
                    );
                  }}
                  title={rule.enabled ? '已启用捕获' : '已暂停捕获'}
                >
                  <div className="admin-toggle-knob" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 模块三：未成年人隐私与隔离控制 + AI 引擎配置 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* 隐私与安全隔离 */}
        <section className="admin-editor-card">
          <div className="admin-editor-card-header">
            <span className="admin-editor-section-title">3. 未成年人数据隐私与隔离策略</span>
            <span className="admin-editor-tag is-green">基线安全规约</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>原始对话与学情自动脱敏</strong>
                <span style={{ fontSize: '12px', color: '#64748b' }}>过滤学生手机号、家庭住址与人脸敏感信息</span>
              </div>
              <input
                type="checkbox"
                checked={minorDataDesensitization}
                onChange={() => setMinorDataDesensitization(!minorDataDesensitization)}
                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#165dff' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>当前班主任专属隔离</strong>
                <span style={{ fontSize: '12px', color: '#64748b' }}>一个学生同一时间只能由其当前班主任查看完整轨迹</span>
              </div>
              <input
                type="checkbox"
                checked={headTeacherExclusive}
                onChange={() => setHeadTeacherExclusive(!headTeacherExclusive)}
                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#165dff' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>家长端只读白名单同步</strong>
                <span style={{ fontSize: '12px', color: '#64748b' }}>仅推送已通过阶段门禁的积极里程碑与反思总结</span>
              </div>
              <input
                type="checkbox"
                checked={parentReadonlyAccess}
                onChange={() => setParentReadonlyAccess(!parentReadonlyAccess)}
                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#165dff' }}
              />
            </div>
          </div>
        </section>

        {/* AI 画像生成与刷新配置 */}
        <section className="admin-editor-card">
          <div className="admin-editor-card-header">
            <span className="admin-editor-section-title">4. AI 分析推理模型与生成频率</span>
            <span className="admin-editor-tag is-green">Agent SDK 智能分析</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '14px' }}>
            <div className="admin-form-row">
              <label className="admin-form-label">学情分析推理模型</label>
              <select
                className="admin-select"
                value={profilingModel}
                onChange={(e) => setProfilingModel(e.target.value)}
              >
                <option value="gpt-4o">GPT-4o (高精度多模态画像与思维链分析)</option>
                <option value="claude-3-5-sonnet">Claude 3.5 Sonnet (深度教学反思与长文本分析)</option>
                <option value="deepseek-r1">DeepSeek-R1 (第一性原理推理验证)</option>
              </select>
            </div>

            <div className="admin-form-row">
              <label className="admin-form-label">画像与雷达图刷新周期</label>
              <select
                className="admin-select"
                value={refreshCycle}
                onChange={(e) => setRefreshCycle(e.target.value)}
              >
                <option value="realtime-phase">阶段门禁触发时实时更新 (推荐)</option>
                <option value="daily-batch">每日定时夜间跑批更新</option>
                <option value="project-finish">仅在整个项目结项答辩后汇总更新</option>
              </select>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
