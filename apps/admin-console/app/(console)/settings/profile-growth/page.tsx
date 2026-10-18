'use client';

import { useEffect, useState } from 'react';
import { fetchAvailableConfiguredModels, type ConfiguredModelItem } from '../../../../lib/api/configuredModels';
import { fetchAdminAssistantConfigs, updatePersistedAssistant } from '../../../../lib/api/assistants';
import type { AdminAssistantConfig } from '@qitu/contracts';

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
  const [dimensions, setDimensions] = useState<DimensionSetting[]>(DEFAULT_DIMENSIONS);
  const [eventRules, setEventRules] = useState<EventCaptureRule[]>(DEFAULT_EVENT_RULES);

  // 隐私与隔离控制
  const [minorDataDesensitization, setMinorDataDesensitization] = useState(true);
  const [headTeacherExclusive, setHeadTeacherExclusive] = useState(true);
  const [parentReadonlyAccess, setParentReadonlyAccess] = useState(true);

  // AI 分析引擎与助手绑定
  const [profilingModel, setProfilingModel] = useState('');
  const [refreshCycle, setRefreshCycle] = useState('realtime-phase');
  const [saveNotice, setSaveNotice] = useState('');
  const [availableModels, setAvailableModels] = useState<ConfiguredModelItem[]>([]);
  const [assistants, setAssistants] = useState<AdminAssistantConfig[]>([]);
  const [profileAssistantId, setProfileAssistantId] = useState('profile-analyst-assistant');
  const [growthAssistantId, setGrowthAssistantId] = useState('growth-trajectory-assistant');

  useEffect(() => {
    fetchAvailableConfiguredModels()
      .then((models) => {
        if (models && models.length > 0 && models[0]) {
          setAvailableModels(models);
          setProfilingModel(`${models[0].providerId}:${models[0].id}`);
        }
      })
      .catch(() => {});

    fetchAdminAssistantConfigs()
      .then((res) => {
        if (res && res.length > 0) setAssistants(res);
      })
      .catch(() => {});
  }, []);

  const totalWeight = dimensions.reduce((sum, d) => sum + (d.enabled ? d.weight : 0), 0);

  const handleSave = async () => {
    if (totalWeight !== 100) {
      alert(`当前启用的维度权重之和为 ${totalWeight}%，请调整至 100% 后保存。`);
      return;
    }
    const updates = [profileAssistantId, growthAssistantId]
      .map((assistantId) => assistants.find((assistant) => assistant.id === assistantId))
      .filter((assistant): assistant is AdminAssistantConfig => Boolean(assistant?.modelId))
      .map((assistant) => updatePersistedAssistant(assistant.id, {
        modelId: assistant.modelId,
        modelProviderId: assistant.modelProviderId || null,
      }));
    const results = await Promise.allSettled(updates);
    if (results.some((result) => result.status === 'rejected')) {
      setSaveNotice('部分助手配置保存失败；请检查权限或网络后重试。');
      return;
    }
    setSaveNotice('学情画像与成长轨迹专任助手及模型配置已成功保存并同步全平台！✔');
    setTimeout(() => setSaveNotice(''), 2500);
  };

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 顶部标题栏 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <span style={{ fontSize: '20px' }}>📊</span>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#102a5c' }}>
              学情画像与成长轨迹控制
            </h1>
            <span style={{ fontSize: '11px', background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
              Agent SDK 自动打分
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '13.5px', color: '#73839b', lineHeight: 1.6 }}>
            统筹配置学生个人能力画像多维权重、PBL 四阶段事件流捕获、未成年人隐私隔离策略与 AI 动态分析引擎。
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {saveNotice ? (
            <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: 600 }}>{saveNotice}</span>
          ) : null}
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '9px 20px',
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '13.5px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(37,99,235,0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>💾</span> 保存配置
          </button>
        </div>
      </div>

      {/* 模块一：能力画像维度设置（精美网格卡片与权重进度条） */}
      <section style={{ background: '#ffffff', border: '1px solid #e4ecf7', borderRadius: '14px', padding: '20px 24px', boxShadow: '0 4px 16px rgba(16, 42, 92, 0.03)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', color: '#102a5c', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>1. 能力画像多维评价模型</span>
              <span
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
              基于雷达图的四维核心素养评价体系，各维度权重自动影响学生结项报告。
            </p>
          </div>
          <button
            type="button"
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
        <div style={{ height: '10px', borderRadius: '5px', overflow: 'hidden', display: 'flex', background: '#f1f5f9', marginBottom: '18px' }}>
          {dimensions.filter((d) => d.enabled).map((dim) => (
            <div
              key={dim.id}
              style={{
                width: `${dim.weight}%`,
                background: dim.color,
                transition: 'width 0.3s ease',
              }}
              title={`${dim.name}: ${dim.weight}%`}
            />
          ))}
        </div>

        {/* 维度卡片列表 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
          {dimensions.map((dim) => (
            <div
              key={dim.id}
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

                <div style={{ fontSize: '11px', background: '#f8fafc', color: '#64748b', padding: '4px 8px', borderRadius: '4px', border: '1px solid #f1f5f9' }}>
                  评定来源: {dim.evalSource}
                </div>
              </div>

              <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', color: '#475569', fontWeight: 500 }}>权重占比</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="number"
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

      {/* 模块二：成长轨迹事件流捕获（卡片流水流转） */}
      <section style={{ background: '#ffffff', border: '1px solid #e4ecf7', borderRadius: '14px', padding: '20px 24px', boxShadow: '0 4px 16px rgba(16, 42, 92, 0.03)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', color: '#102a5c', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>2. PBL 关键事件流捕获与档案自动沉淀</span>
              <span style={{ fontSize: '11px', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                不可篡改审计流
              </span>
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#73839b' }}>
              自动监听学生探究过程中的重大节点，生成永久链式成长记录。
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
          {eventRules.map((rule) => (
            <div
              key={rule.id}
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
                <code style={{ fontSize: '11px', color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px', display: 'inline-block', marginBottom: '8px' }}>
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

      {/* 模块三与四：双栏卡片（未成年人隐私策略 + AI 引擎配置） */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px' }}>
        {/* 未成年人隐私与隔离 */}
        <section style={{ background: '#ffffff', border: '1px solid #e4ecf7', borderRadius: '14px', padding: '20px 24px', boxShadow: '0 4px 16px rgba(16, 42, 92, 0.03)' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '15px', color: '#102a5c', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>3. 未成年人数据隐私与隔离策略</span>
            <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
              合规保护
            </span>
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: '12.5px', color: '#73839b' }}>
            遵循未成年人个人信息保护规范，严格限制可见范围与脱敏标准。
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#f8fafc', borderRadius: '8px' }}>
              <div>
                <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>原始对话与学情自动脱敏</strong>
                <span style={{ fontSize: '11.5px', color: '#64748b' }}>自动抹除姓名、手机号、家庭住址与人脸敏感信息</span>
              </div>
              <input
                type="checkbox"
                checked={minorDataDesensitization}
                onChange={() => setMinorDataDesensitization(!minorDataDesensitization)}
                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#2563eb' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#f8fafc', borderRadius: '8px' }}>
              <div>
                <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>当前班主任专属隔离</strong>
                <span style={{ fontSize: '11.5px', color: '#64748b' }}>一个学生同一时间只能由其绑定的当前班主任查看完整轨迹</span>
              </div>
              <input
                type="checkbox"
                checked={headTeacherExclusive}
                onChange={() => setHeadTeacherExclusive(!headTeacherExclusive)}
                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#2563eb' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#f8fafc', borderRadius: '8px' }}>
              <div>
                <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>家长端只读白名单同步</strong>
                <span style={{ fontSize: '11.5px', color: '#64748b' }}>仅推送已通过阶段门禁的正面里程碑与作品反思摘要</span>
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

        {/* AI 画像分析引擎 */}
        <section style={{ background: '#ffffff', border: '1px solid #e4ecf7', borderRadius: '14px', padding: '20px 24px', boxShadow: '0 4px 16px rgba(16, 42, 92, 0.03)' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '15px', color: '#102a5c', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>4. AI 分析推理模型与生成频率</span>
            <span style={{ fontSize: '11px', background: '#f3e8ff', color: '#7e22ce', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
              推理引擎
            </span>
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: '12.5px', color: '#73839b' }}>
            配置负责整合多源学情日志并输出能力雷达分析的底层大语言模型。
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* 提示：模型配置在助手里实现 */}
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#166534', lineHeight: 1.5 }}>
              💡 <strong>模型配置规范：</strong>学情画像与成长轨迹分析模型直接在专任助手中配置与托管，无需在系统级独立指定。选择专任助手后，下方直接联动该助手的专属大语言模型。
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
              {/* 学情画像专任助手及模型 */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
                  学情画像专任分析助手
                </label>
                <select
                  value={profileAssistantId}
                  onChange={(e) => setProfileAssistantId(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', color: '#0f172a', background: '#ffffff', outline: 'none', marginBottom: '10px' }}
                >
                  {assistants.length > 0 ? (
                    assistants.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.role || '智能导师'})
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="profile-analyst-assistant">学情画像分析助手 (专任导师)</option>
                      <option value="qitu-assistant">启途智学管家</option>
                      <option value="tutor-leader">启途总导师</option>
                    </>
                  )}
                </select>

                <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                  画像分析助手模型（直接绑定于该助手）
                </label>
                <select
                  value={(() => {
                    const assistant = assistants.find((a) => a.id === profileAssistantId);
                    return assistant?.modelId && assistant.modelProviderId
                      ? `${assistant.modelProviderId}:${assistant.modelId}`
                      : '';
                  })()}
                  onChange={(e) => {
                    const [modelProviderId, modelId] = e.target.value.split(':', 2);
                    setAssistants((prev) =>
                      prev.map((a) => (a.id === profileAssistantId ? { ...a, modelId: modelId || null, modelProviderId: modelProviderId || null } : a))
                    );
                  }}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', color: '#0f172a', background: '#ffffff', outline: 'none' }}
                >
                  {availableModels.length > 0 ? (
                    availableModels.map((m) => (
                      <option key={`${m.providerId}:${m.id}`} value={`${m.providerId}:${m.id}`}>
                        {m.name || m.id}
                      </option>
                    ))
                  ) : (
                    <option value="" disabled>暂无可用的已配置模型</option>
                  )}
                </select>
                <div style={{ marginTop: '6px', fontSize: '11px', color: '#64748b' }}>
                  角色：{assistants.find((a) => a.id === profileAssistantId)?.role || '学情画像分析导师'}
                </div>
              </div>

              {/* 成长轨迹专任助手及模型 */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
                  成长轨迹专任追踪助手
                </label>
                <select
                  value={growthAssistantId}
                  onChange={(e) => setGrowthAssistantId(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', color: '#0f172a', background: '#ffffff', outline: 'none', marginBottom: '10px' }}
                >
                  {assistants.length > 0 ? (
                    assistants.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.role || '智能导师'})
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="growth-trajectory-assistant">成长轨迹生成助手 (专任导师)</option>
                      <option value="tutor-leader">启途总导师</option>
                      <option value="qitu-assistant">启途智学管家</option>
                    </>
                  )}
                </select>

                <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                  成长轨迹助手模型（直接绑定于该助手）
                </label>
                <select
                  value={(() => {
                    const assistant = assistants.find((a) => a.id === growthAssistantId);
                    return assistant?.modelId && assistant.modelProviderId
                      ? `${assistant.modelProviderId}:${assistant.modelId}`
                      : '';
                  })()}
                  onChange={(e) => {
                    const [modelProviderId, modelId] = e.target.value.split(':', 2);
                    setAssistants((prev) =>
                      prev.map((a) => (a.id === growthAssistantId ? { ...a, modelId: modelId || null, modelProviderId: modelProviderId || null } : a))
                    );
                  }}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', color: '#0f172a', background: '#ffffff', outline: 'none' }}
                >
                  {availableModels.length > 0 ? (
                    availableModels.map((m) => (
                      <option key={`${m.providerId}:${m.id}`} value={`${m.providerId}:${m.id}`}>
                        {m.name || m.id}
                      </option>
                    ))
                  ) : (
                    <option value="" disabled>暂无可用的已配置模型</option>
                  )}
                </select>
                <div style={{ marginTop: '6px', fontSize: '11px', color: '#64748b' }}>
                  角色：{assistants.find((a) => a.id === growthAssistantId)?.role || '成长轨迹导师'}
                </div>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>
                画像与雷达图刷新周期
              </label>
              <select
                value={refreshCycle}
                onChange={(e) => setRefreshCycle(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', color: '#0f172a', background: '#f8fafc', outline: 'none' }}
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
