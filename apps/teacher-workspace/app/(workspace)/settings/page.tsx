'use client';

import { useState } from 'react';
import {
  ActivityIcon,
  CheckCircleIcon,
  PhoneIcon,
  SettingsIcon,
  SparklesIcon,
  TrendingUpIcon,
} from '../../../components/icons';
import { MetricCard } from '../../../components/metric-card';
import { settingsSections } from '../../../lib/mock-data';

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 24, borderRadius: 999, border: 0, cursor: 'pointer',
        background: checked ? '#2563eb' : '#cbd5e1', position: 'relative', transition: 'background .15s ease', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 22 : 2, width: 20, height: 20, borderRadius: '50%',
        background: '#fff', transition: 'left .15s ease', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
      }} />
    </button>
  );
}

export default function SettingsPage() {
  const [section, setSection] = useState('strategy');
  const [antiCram, setAntiCram] = useState(true);
  const [heuristic, setHeuristic] = useState(true);
  const [emotionProbe, setEmotionProbe] = useState(true);
  const [parentSync, setParentSync] = useState(true);

  return (
    <div className="qtx-page">
      {/* 页面横幅 */}
      <section className="qtx-banner">
        <div className="qtx-banner-inner">
          <div className="qtx-banner-left">
            <div className="qtx-banner-avatar">
              <div>
                <SettingsIcon size={28} />
              </div>
            </div>
            <div>
              <h2>系统设置</h2>
              <p>调整 AI 导师策略、协同干预与三端权限规则。</p>
            </div>
          </div>
          <div className="qtx-banner-slogan">好的系统设置，是让老师少操心、多陪伴。</div>
          <div className="qtx-banner-right">
            <div className="qtx-bubble">🤖 所有策略变更都会生成审计记录，请放心调整～</div>
            <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'linear-gradient(135deg,#38bdf8,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>🤖</div>
          </div>
        </div>
      </section>

      {/* 监控卡 */}
      <section className="qtx-grid qtx-grid-4">
        <MetricCard label="AI 推理与语音网关" value="正常" delta={<><span className="up">● 服务在线</span></>} icon={<ActivityIcon size={22} />} tone="#059669" />
        <MetricCard label="今日算力成本" value="¥42.6" delta={<>预算 ¥200 <span className="up">健康</span></>} icon={<TrendingUpIcon size={22} />} tone="#2563eb" />
        <MetricCard label="卡顿情绪监听探针" value="工作中" delta={<>覆盖 128 名学生</>} icon={<SparklesIcon size={22} />} tone="#4f46e5" />
        <MetricCard label="家长端数据通道" value="已联通" delta={<>同步成功率 99.9%</>} icon={<PhoneIcon size={22} />} tone="#0d9488" />
      </section>

      {/* 设置主体 */}
      <section className="qtx-grid qtx-grid-12" style={{ alignItems: 'flex-start' }}>
        <div className="qtx-col-4 qtx-card" style={{ padding: 8 }}>
          {settingsSections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                padding: '12px 14px', borderRadius: 12, border: 0, cursor: 'pointer', fontFamily: 'inherit',
                background: section === s.id ? '#eff6ff' : 'transparent',
                color: section === s.id ? '#1d4ed8' : '#475569',
                fontWeight: section === s.id ? 700 : 500, fontSize: 13, transition: 'all .15s ease',
              }}
            >
              {s.label}
              {section === s.id ? <CheckCircleIcon size={16} /> : null}
            </button>
          ))}
        </div>

        <div className="qtx-col-8 qtx-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: 18, background: '#f8fafc', borderBottom: '1px solid #eef2f7' }}>
            <strong style={{ fontSize: 15, color: '#1e293b' }}>
              {settingsSections.find((s) => s.id === section)?.label}
            </strong>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
              保存后立即生效，并记录当前登录账号与时间戳。
            </div>
          </div>

          <div style={{ padding: 20, display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 13, border: '1px solid #eef2f7', background: '#fff' }}>
              <div>
                <strong style={{ fontSize: 13, color: '#1e293b' }}>启发式引导优先</strong>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>苏格拉底式提问，不直接给出答案。</div>
              </div>
              <Toggle checked={heuristic} onChange={setHeuristic} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 13, border: '1px solid #eef2f7', background: '#fff' }}>
              <div>
                <strong style={{ fontSize: 13, color: '#1e293b' }}>防刷题锁定</strong>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>检测到同一题型连续作答 3 次后自动锁定。</div>
              </div>
              <Toggle checked={antiCram} onChange={setAntiCram} />
            </div>

            <div style={{ padding: 14, borderRadius: 13, border: '1px solid #eef2f7', background: '#fff' }}>
              <strong style={{ fontSize: 13, color: '#1e293b' }}>连续失败阈值</strong>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>当学生连续失败达到阈值时，触发人工介入提醒。</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <input type="range" min={1} max={5} defaultValue={3} style={{ flex: 1 }} />
                <span className="qtx-badge qtx-badge-blue">3 次</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 13, border: '1px solid #eef2f7', background: '#fff' }}>
              <div>
                <strong style={{ fontSize: 13, color: '#1e293b' }}>情绪监听探针</strong>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>识别“我不行”“都做错了”等低效能表达。</div>
              </div>
              <Toggle checked={emotionProbe} onChange={setEmotionProbe} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 13, border: '1px solid #eef2f7', background: '#fff' }}>
              <div>
                <strong style={{ fontSize: 13, color: '#1e293b' }}>家长端脱敏同步</strong>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>仅展示成长快照与过程证据，不展示原始对话。</div>
              </div>
              <Toggle checked={parentSync} onChange={setParentSync} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, padding: '0 20px 20px' }}>
            <button className="qtx-btn qtx-btn-primary" type="button">保存设置</button>
            <button className="qtx-btn" type="button">恢复默认</button>
          </div>
        </div>
      </section>
    </div>
  );
}
