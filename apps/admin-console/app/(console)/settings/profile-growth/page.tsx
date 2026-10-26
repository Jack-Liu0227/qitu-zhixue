'use client';

import { VisualAsset } from '@qitu/ui';
import { useState } from 'react';
import { configuredModelKey, configuredModelPatch } from '../../../../lib/api/configuredModels';
import { useGrowthProjectionSettings } from '../../../../lib/use-growth-projection-settings';

interface DimensionSetting {
  id: string;
  name: string;
  description: string;
  weight: number;
  evalSource: string;
  enabled: boolean;
  color: string;
  icon: string;
}

const DEFAULT_DIMENSIONS: DimensionSetting[] = [
  {
    id: 'dim-computational-thinking',
    name: '计算思维与算法建模',
    description: '评估学生对事件循环、坐标系、AABB 碰撞检测等算法逻辑的拆解与抽象建构能力。',
    weight: 30,
    evalSource: '雷霆战机主循环代码与算法推导对话',
    enabled: true,
    color: '#2563eb',
    icon: '💻',
  },
  {
    id: 'dim-scientific-modeling',
    name: '科学探究与原理推导',
    description: '评估动能定理 W=ΔEk 公式推导、受力分析以及实验假设求证的严谨度。',
    weight: 25,
    evalSource: 'TheoryMastered 理论门禁测评与概念教练问答',
    enabled: true,
    color: '#7c3aed',
    icon: '⚡',
  },
  {
    id: 'dim-engineering-sandbox',
    name: '工程实践与自检调试',
    description: '通过沙箱 Traceback 报错修复过程与主循环自检指标，评估工程坚韧度与代码整洁度。',
    weight: 25,
    evalSource: 'Python 代码执行沙箱与单元测试日志',
    enabled: true,
    color: '#059669',
    icon: '🛠️',
  },
  {
    id: 'dim-reflection-defense',
    name: '答辩质询与元认知反思',
    description: '评估结项答辩中对方案选型、困难定位及改进规划的口述表达与深度反思。',
    weight: 20,
    evalSource: '评审导师答辩质询量规与结项反思报告',
    enabled: true,
    color: '#d97706',
    icon: '🎯',
  },
];

interface EventCaptureRule {
  id: string;
  event: string;
  label: string;
  description: string;
  enabled: boolean;
  captureDetail: boolean;
  phase: string;
}

const DEFAULT_EVENT_RULES: EventCaptureRule[] = [
  {
    id: 'evt-intent-confirmed',
    event: 'pbl.intent.confirmed',
    label: '开题意图确认',
    description: '记录学生自主确定 PBL 项目目标与玩法设想，生成项目启动里程碑。',
    enabled: true,
    captureDetail: true,
    phase: '阶段一：意图确认',
  },
  {
    id: 'evt-theory-mastered',
    event: 'pbl.gate.theory_mastered',
    label: 'TheoryMastered 理论门禁通关',
    description: '学生通过原理教练核心概念与数学推导考核，进入实践阶段的关键节点。',
    enabled: true,
    captureDetail: true,
    phase: '阶段二：核心原理',
  },
  {
    id: 'evt-sandbox-run',
    event: 'sandbox.code.executed',
    label: '沙箱代码自检与调试',
    description: '捕获代码执行成功、异常栈分析及自主排错轨迹，形成工程调试成长链。',
    enabled: true,
    captureDetail: false,
    phase: '阶段三：工程实践',
  },
  {
    id: 'evt-defense-completed',
    event: 'pbl.defense.completed',
    label: '结项答辩与量规评测',
    description: '记录评审导师的概念掌握度质询评分，生成永久成长档案。',
    enabled: true,
    captureDetail: true,
    phase: '阶段四：总结答辩',
  },
];

export default function ProfileGrowthSettingsPage() {
  const [activeTab, setActiveTab] = useState<'profile' | 'growth'>('profile');

  // 学情画像维度
  const [dimensions, setDimensions] = useState<DimensionSetting[]>(DEFAULT_DIMENSIONS);

  // 成长轨迹事件规则
  const [eventRules, setEventRules] = useState<EventCaptureRule[]>(DEFAULT_EVENT_RULES);

  // 隐私与隔离控制
  const [minorDataDesensitization, setMinorDataDesensitization] = useState(true);
  const [headTeacherExclusive, setHeadTeacherExclusive] = useState(true);
  const [parentReadonlyAccess, setParentReadonlyAccess] = useState(true);

  // AI 分析引擎与助手绑定
  const [refreshCycle, setRefreshCycle] = useState('realtime-phase');
  const configuration = useGrowthProjectionSettings();
  const {
    assistants,
    setAssistants,
    availableModels,
    profileAssistantId,
    setProfileAssistantId,
    growthAssistantId,
    setGrowthAssistantId,
    profileModelValue,
    growthModelValue,
  } = configuration;
  const catalogReady = configuration.ready && !configuration.saving;
  const purposeOptions = configuration.settings?.assistants ?? [];
  const totalWeight = dimensions.reduce((sum, d) => sum + (d.enabled ? d.weight : 0), 0);

  return (
    <div style={{ maxWidth: '100%', width: '100%', margin: 0, display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 顶部标题栏 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{ fontSize: '20px' }}><VisualAsset assetId="avatar-data-v1" size={24} /></span>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#102a5c' }}>
              学情画像与成长轨迹控制
            </h1>
            <span
              className="admin-profile-growth-tag"
              style={{ fontSize: '11px', background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}
            >
              专任助手与证据审核
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '13.5px', color: '#73839b', lineHeight: 1.6 }}>
            分域隔离管理学生学情静态画像（能力雷达与评价模型）与阶段成长动态轨迹（证据流、里程碑与隐私护栏）。
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {configuration.notice ? (
            <span role="status" style={{ fontSize: '13px', color: '#334155', fontWeight: 600 }}>{configuration.notice}</span>
          ) : null}
          <button
            type="button"
            onClick={() => void configuration.save()}
            disabled={!catalogReady}
            style={{
              padding: '9px 20px',
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '13.5px',
              fontWeight: 600,
              cursor: !catalogReady ? 'not-allowed' : 'pointer',
              opacity: !catalogReady ? 0.6 : 1,
              boxShadow: '0 2px 4px rgba(37,99,235,0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>💾</span> {configuration.saving ? '正在保存…' : '保存助手与模型绑定'}
          </button>
        </div>
      </div>

      {/* 状态横幅 */}
      <div
        className="admin-growth-status-banner"
        role={configuration.error ? 'alert' : 'status'}
        style={{
          padding: '12px 18px',
          background: configuration.error ? '#fff7ed' : '#eff6ff',
          border: configuration.error ? '1px solid #fed7aa' : '1px solid #bfdbfe',
          borderRadius: 8,
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <span
          className="admin-growth-status-text"
          style={{
            color: configuration.error ? '#9a3412' : '#1e3a8a',
            lineHeight: 1.5,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>{configuration.error ? '⚠️' : 'ℹ️'}</span>
          {configuration.loading ? '正在读取专任助手与用途绑定…' : configuration.error ?? (purposeOptions.length
            ? `已读取配置修订 ${configuration.settings?.revision}。保存用途时登记对应运行时身份与事件路由；模型与提示词使用助手当前配置。`
            : '暂无可用的助手。请先在助手设置中启用助手；运行时已停用的身份需先由管理员恢复。')}
        </span>
        <button
          type="button"
          className="admin-growth-reload-btn"
          disabled={configuration.loading || configuration.saving}
          onClick={configuration.reload}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            borderRadius: 6,
            border: '1px solid #93c5fd',
            background: '#ffffff',
            color: '#2563eb',
            fontSize: '12.5px',
            fontWeight: 600,
            cursor: configuration.loading || configuration.saving ? 'not-allowed' : 'pointer',
            opacity: configuration.loading || configuration.saving ? 0.6 : 1,
            whiteSpace: 'nowrap',
            transition: 'all 0.15s ease',
          }}
        >
          <span style={{ fontSize: 13 }}>🔄</span> 重新读取配置
        </button>
      </div>

      {/* Tab 导航隔离 */}
      <div className="settings-tabs-row" role="tablist" style={{ marginBottom: '2px' }}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'profile'}
          className={`settings-tab-btn ${activeTab === 'profile' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <span>👤 学生学情静态画像</span>
          <span className="settings-tab-cnt">{dimensions.filter(d => d.enabled).length} 激活维度</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'growth'}
          className={`settings-tab-btn ${activeTab === 'growth' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('growth')}
        >
          <span>📈 阶段成长轨迹与里程碑</span>
          <span className="settings-tab-cnt">{eventRules.filter(r => r.enabled).length} 活跃事件</span>
        </button>
      </div>

      {/* ===================== TAB 1: 学生学情静态画像 ===================== */}
      {activeTab === 'profile' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* 画像专任助手与大模型绑定卡片 */}
          <section
            className="admin-profile-growth-section"
            style={{
              background: '#ffffff',
              border: '1px solid #e4ecf7',
              borderRadius: '12px',
              padding: '20px 24px',
              boxShadow: '0 2px 8px rgba(16, 42, 92, 0.03)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', color: '#102a5c', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🤖 学情画像专任分析助手与推理大模型</span>
                  <span style={{ fontSize: '11px', background: '#f3e8ff', color: '#7e22ce', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                    画像引擎
                  </span>
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#73839b' }}>
                  负责提取学生认知倾向、学科潜能及能力雷达图计算的专任大模型底座。
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', alignItems: 'start' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
                  学情画像专任分析助手
                </label>
                <select
                  value={profileAssistantId}
                  disabled={!catalogReady}
                  onChange={(e) => setProfileAssistantId(e.target.value)}
                  className="admin-growth-assistant-select"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', color: '#0f172a', background: '#ffffff', outline: 'none', marginBottom: '10px' }}
                >
                  <option value="">{configuration.loading ? '正在读取…' : '未配置'}</option>
                  {profileAssistantId && !purposeOptions.some(option => option.id === profileAssistantId) && (
                    <option value={profileAssistantId} disabled>当前绑定已不可用</option>
                  )}
                  {purposeOptions.map(option => (
                    <option key={option.id} value={option.id}>{option.displayName}</option>
                  ))}
                </select>

                <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                  画像分析助手模型（直接绑定于该助手）
                </label>
                <select
                  aria-label="画像分析助手模型"
                  disabled={!catalogReady}
                  value={profileModelValue}
                  onChange={(e) => {
                    const patch = configuredModelPatch(e.target.value, availableModels);
                    setAssistants((prev) =>
                      prev.map((a) => (a.id === profileAssistantId ? { ...a, ...patch } : a))
                    );
                  }}
                  className="admin-growth-assistant-select"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', color: '#0f172a', background: '#ffffff', outline: 'none' }}
                >
                  <option value="" disabled>未绑定，请选择供应商与模型</option>
                  {profileModelValue && !availableModels.some((model) => configuredModelKey(model) === profileModelValue) ? (
                    <option value={profileModelValue} disabled>当前绑定不可用，请重新选择</option>
                  ) : null}
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
                <div style={{ marginTop: '8px', fontSize: '11.5px', color: '#64748b' }}>
                  角色职责：{assistants.find((a) => a.id === profileAssistantId)?.role || '学情画像分析导师'}
                </div>
              </div>

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
                  画像与雷达图刷新周期（策略配置）
                </label>
                <select
                  value={refreshCycle}
                  onChange={(e) => setRefreshCycle(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', color: '#0f172a', background: '#ffffff', outline: 'none', marginBottom: '10px' }}
                >
                  <option value="realtime-phase">阶段门禁触发时实时更新 (推荐)</option>
                  <option value="daily-batch">每日定时夜间跑批更新</option>
                  <option value="project-finish">仅在整个项目结项答辩后汇总更新</option>
                </select>
                <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                  当学生完成理论门禁 (TheoryMastered) 或提交关键作品时，系统按此周期唤醒画像分析专任助手进行雷达图增量重算。
                </p>
              </div>
            </div>
          </section>

          {/* 能力画像多维评价模型与权重卡片 */}
          <section
            className="admin-profile-growth-section"
            style={{
              background: '#ffffff',
              border: '1px solid #e4ecf7',
              borderRadius: '12px',
              padding: '20px 24px',
              boxShadow: '0 2px 8px rgba(16, 42, 92, 0.03)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', color: '#102a5c', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>📊 能力画像多维评价模型 (能力雷达 4 维度)</span>
                  <span
                    className={`admin-growth-weight-badge ${totalWeight === 100 ? 'is-valid' : 'is-invalid'}`}
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: totalWeight === 100 ? '#dcfce7' : '#fee2e2',
                      color: totalWeight === 100 ? '#15803d' : '#b91c1c',
                    }}
                  >
                    总权重: {totalWeight}% {totalWeight === 100 ? '✔' : '⚠️ 需等于 100%'}
                  </span>
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#73839b' }}>
                  定义支撑学生核心素养的 4 个评估维度及雷达图占比权重。
                </p>
              </div>
              <button
                type="button"
                className="admin-growth-reset-btn"
                onClick={() => setDimensions(DEFAULT_DIMENSIONS)}
                style={{
                  padding: '5px 12px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  background: '#f8fafc',
                  fontSize: '12px',
                  color: '#475569',
                  cursor: 'pointer',
                }}
              >
                ↺ 恢复默认权重
              </button>
            </div>

            {/* 综合权重分布条 */}
            <div
              className="admin-growth-progress-track"
              style={{
                height: '10px',
                borderRadius: '5px',
                overflow: 'hidden',
                display: 'flex',
                background: '#f1f5f9',
                marginBottom: '18px',
              }}
            >
              {dimensions.filter((d) => d.enabled).map((dim) => (
                <div
                  key={dim.id}
                  className="admin-dimension-bar-item"
                  style={{
                    width: `${dim.weight}%`,
                    background: dim.color,
                    transition: 'width 0.3s ease',
                  }}
                  title={`${dim.name}: ${dim.weight}%`}
                />
              ))}
            </div>

            {/* 维度卡片网格 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
              {dimensions.map((dim) => (
                <div
                  key={dim.id}
                  className="admin-dimension-card"
                  style={{
                    padding: '16px',
                    borderRadius: '10px',
                    border: dim.enabled ? `1.5px solid ${dim.color}33` : '1px solid #e2e8f0',
                    background: dim.enabled ? '#ffffff' : '#f8fafc',
                    boxShadow: dim.enabled ? '0 2px 8px rgba(0,0,0,0.03)' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '18px' }}>{dim.icon}</span>
                        <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>{dim.name}</strong>
                      </div>
                      <button
                        type="button"
                        className={`admin-dimension-status-btn ${dim.enabled ? 'is-enabled' : 'is-disabled'}`}
                        onClick={() => setDimensions((prev) => prev.map((d) => (d.id === dim.id ? { ...d, enabled: !d.enabled } : d)))}
                        style={{
                          padding: '2px 8px',
                          borderRadius: '6px',
                          border: '1px solid',
                          fontSize: '11px',
                          cursor: 'pointer',
                          background: dim.enabled ? '#eff6ff' : '#f1f5f9',
                          borderColor: dim.enabled ? '#bfdbfe' : '#cbd5e1',
                          color: dim.enabled ? '#1d4ed8' : '#94a3b8',
                          fontWeight: 600,
                        }}
                      >
                        {dim.enabled ? '已启用' : '已停用'}
                      </button>
                    </div>

                    <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#64748b', lineHeight: 1.5, minHeight: '36px' }}>
                      {dim.description}
                    </p>

                    <div className="admin-dimension-source" style={{ fontSize: '11px', background: '#f8fafc', color: '#64748b', padding: '4px 8px', borderRadius: '4px', border: '1px solid #f1f5f9' }}>
                      评定来源: {dim.evalSource}
                    </div>
                  </div>

                  <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', color: '#475569', fontWeight: 500 }}>权重占比</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="number"
                        className="admin-dimension-weight-input"
                        min={0}
                        max={100}
                        value={dim.weight}
                        disabled={!dim.enabled}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          setDimensions((prev) => prev.map((d) => (d.id === dim.id ? { ...d, weight: val } : d)));
                        }}
                        style={{
                          width: '56px',
                          padding: '4px 8px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          fontSize: '13px',
                          fontWeight: 600,
                          color: '#0f172a',
                          textAlign: 'right',
                        }}
                      />
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ===================== TAB 2: 阶段成长轨迹与里程碑 ===================== */}
      {activeTab === 'growth' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* 轨迹专任助手与大模型绑定卡片 */}
          <section
            className="admin-profile-growth-section"
            style={{
              background: '#ffffff',
              border: '1px solid #e4ecf7',
              borderRadius: '12px',
              padding: '20px 24px',
              boxShadow: '0 2px 8px rgba(16, 42, 92, 0.03)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', color: '#102a5c', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🤖 成长轨迹专任追踪助手与大语言模型</span>
                  <span style={{ fontSize: '11px', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                    轨迹流水
                  </span>
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#73839b' }}>
                  负责监控 PBL 探究事件流、汇总关键里程碑并生成学生阶段成长时间线的专任助手。
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', alignItems: 'start' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
                  成长轨迹专任追踪助手
                </label>
                <select
                  value={growthAssistantId}
                  disabled={!catalogReady}
                  onChange={(e) => setGrowthAssistantId(e.target.value)}
                  className="admin-growth-assistant-select"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', color: '#0f172a', background: '#ffffff', outline: 'none', marginBottom: '10px' }}
                >
                  <option value="">{configuration.loading ? '正在读取…' : '未配置'}</option>
                  {growthAssistantId && !purposeOptions.some(option => option.id === growthAssistantId) && (
                    <option value={growthAssistantId} disabled>当前绑定已不可用</option>
                  )}
                  {purposeOptions.map(option => (
                    <option key={option.id} value={option.id}>{option.displayName}</option>
                  ))}
                </select>

                <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                  成长轨迹助手模型（直接绑定于该助手）
                </label>
                <select
                  aria-label="成长轨迹助手模型"
                  disabled={!catalogReady}
                  value={growthModelValue}
                  onChange={(e) => {
                    const patch = configuredModelPatch(e.target.value, availableModels);
                    setAssistants((prev) =>
                      prev.map((a) => (a.id === growthAssistantId ? { ...a, ...patch } : a))
                    );
                  }}
                  className="admin-growth-assistant-select"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', color: '#0f172a', background: '#ffffff', outline: 'none' }}
                >
                  <option value="" disabled>未绑定，请选择供应商与模型</option>
                  {growthModelValue && !availableModels.some((model) => configuredModelKey(model) === growthModelValue) ? (
                    <option value={growthModelValue} disabled>当前绑定不可用，请重新选择</option>
                  ) : null}
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
                <div style={{ marginTop: '8px', fontSize: '11.5px', color: '#64748b' }}>
                  角色职责：{assistants.find((a) => a.id === growthAssistantId)?.role || '成长轨迹导师'}
                </div>
              </div>

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px' }}>
                <strong style={{ fontSize: '13px', color: '#1e3a8a', display: 'block', marginBottom: '6px' }}>
                  🔒 PBL 证据链与审计要求
                </strong>
                <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.6 }}>
                  成长轨迹流水为不可篡改的事实记录。学生自主探究产生真实证据，服务端按既定门禁裁决。模型只能生成候选反思与成长评语，禁止客户端或第三方直接写入进阶事实。
                </p>
              </div>
            </div>
          </section>

          {/* 模块二：成长轨迹事件流捕获（卡片流水流转） */}
          <section
            className="admin-profile-growth-section"
            style={{
              background: '#ffffff',
              border: '1px solid #e4ecf7',
              borderRadius: '12px',
              padding: '20px 24px',
              boxShadow: '0 2px 8px rgba(16, 42, 92, 0.03)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', color: '#102a5c', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>⚡ PBL 关键事件流捕获与档案自动沉淀</span>
                  <span className="admin-growth-audit-badge" style={{ fontSize: '11px', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                    不可篡改审计流
                  </span>
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#73839b' }}>
                  配置各探究阶段向轨迹中沉淀的证据事件类型；候选内容须审核后进入成长展示。
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
              {eventRules.map((rule) => (
                <div
                  key={rule.id}
                  className="admin-growth-event-card"
                  style={{
                    padding: '14px 16px',
                    borderRadius: '10px',
                    border: rule.enabled ? '1px solid #cbd5e1' : '1px solid #e2e8f0',
                    background: rule.enabled ? '#ffffff' : '#f8fafc',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <div>
                        <span style={{ fontSize: '11px', color: '#2563eb', fontWeight: 600, display: 'block' }}>{rule.phase}</span>
                        <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>{rule.label}</strong>
                      </div>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={() => setEventRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)))}
                        style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#2563eb' }}
                      />
                    </div>
                    <code className="admin-growth-event-code" style={{ fontSize: '11px', color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px', display: 'inline-block', marginBottom: '8px' }}>
                      {rule.event}
                    </code>
                    <p style={{ margin: 0, fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                      {rule.description}
                    </p>
                  </div>

                  <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#475569', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={rule.captureDetail}
                        onChange={() => setEventRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, captureDetail: !r.captureDetail } : r)))}
                        style={{ accentColor: '#2563eb' }}
                      />
                      包含代码快照与思维过程
                    </label>
                    <span style={{ fontSize: '11px', color: rule.enabled ? '#16a34a' : '#94a3b8', fontWeight: 600 }}>
                      {rule.enabled ? '● 监听中' : '○ 已挂起'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 模块三：未成年人数据隐私与隔离策略卡片 */}
          <section
            className="admin-profile-growth-section"
            style={{
              background: '#ffffff',
              border: '1px solid #e4ecf7',
              borderRadius: '12px',
              padding: '20px 24px',
              boxShadow: '0 2px 8px rgba(16, 42, 92, 0.03)',
            }}
          >
            <h3 style={{ margin: '0 0 4px', fontSize: '15px', color: '#102a5c', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>🛡️ 未成年人数据隐私与多端隔离策略</span>
              <span className="admin-growth-badge" style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                合规保护
              </span>
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '12.5px', color: '#73839b' }}>
              轨迹数据面向学生、教师与家长多端共享时的严格安全与隐私边界。
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
              <div className="admin-growth-sub-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div>
                  <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>原始对话与学情自动脱敏</strong>
                  <span style={{ fontSize: '11.5px', color: '#64748b' }}>最小化展示未成年人个人敏感信息与语音</span>
                </div>
                <input
                  type="checkbox"
                  checked={minorDataDesensitization}
                  onChange={() => setMinorDataDesensitization(!minorDataDesensitization)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#2563eb' }}
                />
              </div>

              <div className="admin-growth-sub-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div>
                  <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>当前班主任专属隔离</strong>
                  <span style={{ fontSize: '11.5px', color: '#64748b' }}>一个学生同一时间只能由当前班主任查看完整轨迹</span>
                </div>
                <input
                  type="checkbox"
                  checked={headTeacherExclusive}
                  onChange={() => setHeadTeacherExclusive(!headTeacherExclusive)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#2563eb' }}
                />
              </div>

              <div className="admin-growth-sub-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div>
                  <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>家长端只读白名单同步</strong>
                  <span style={{ fontSize: '11.5px', color: '#64748b' }}>家长仅可查看经教师审核的有界结项摘要</span>
                </div>
                <input
                  type="checkbox"
                  checked={parentReadonlyAccess}
                  onChange={() => setParentReadonlyAccess(!parentReadonlyAccess)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#2563eb' }}
                />
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
