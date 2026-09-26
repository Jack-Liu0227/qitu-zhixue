'use client';

import { useState } from 'react';
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  PhoneIcon,
  SendIcon,
  SparklesIcon,
  TicketIcon,
  TrendingUpIcon,
} from '../../../components/icons';
import { MetricCard } from '../../../components/metric-card';
import { issues } from '../../../lib/mock-data';

const levelTone: Record<string, string> = {
  L1: '#e11d48',
  L2: '#d97706',
  L3: '#2563eb',
};

export default function IssuesPage() {
  const [selectedId, setSelectedId] = useState(issues[0]!.id);
  const selected = issues.find((i) => i.id === selectedId) ?? issues[0]!;
  const [previewed, setPreviewed] = useState(false);
  const [promptText, setPromptText] = useState(selected.prompt);

  const selectIssue = (id: string) => {
    const issue = issues.find((i) => i.id === id);
    setSelectedId(id);
    setPreviewed(false);
    setPromptText(issue?.prompt ?? '');
  };

  return (
    <div className="qtx-page">
      {/* 页面横幅 */}
      <section className="qtx-banner">
        <div className="qtx-banner-inner">
          <div className="qtx-banner-left">
            <div className="qtx-banner-avatar">
              <div>
                <TicketIcon size={28} />
              </div>
            </div>
            <div>
              <h2>问题处理</h2>
              <p>发现 — 处理 — 干预 — 结果，形成完整的告警闭环。</p>
            </div>
          </div>
          <div className="qtx-banner-slogan">每一次介入，都是重新点燃好奇心的机会。</div>
          <div className="qtx-banner-right">
            <div className="qtx-bubble">🤖 2 条 L1 告警等待人工确认，建议优先处理～</div>
            <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'linear-gradient(135deg,#38bdf8,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>🤖</div>
          </div>
        </div>
      </section>

      {/* 指标卡 */}
      <section className="qtx-grid qtx-grid-4">
        <MetricCard label="待介入总数" value="12" delta={<>较昨日 <span className="down">-5</span></>} icon={<AlertIcon size={22} />} tone="#e11d48" />
        <MetricCard label="Agent 逻辑卡死" value="5" delta={<>占比 42%</>} icon={<TicketIcon size={22} />} tone="#d97706" />
        <MetricCard label="学生情绪预警" value="4" delta={<>2 条 L1 优先</>} icon={<TrendingUpIcon size={22} />} tone="#4f46e5" />
        <MetricCard label="家长端诉求" value="3" delta={<>平均响应 2.1h</>} icon={<PhoneIcon size={22} />} tone="#0d9488" />
      </section>

      {/* 主体：告警列表 + 干预工作台 */}
      <section className="qtx-grid qtx-grid-12" style={{ alignItems: 'flex-start' }}>
        <div className="qtx-col-4 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" style={{ background: '#e11d48' }} /> 待处理告警
            </div>
            <span className="qtx-badge qtx-badge-rose">12 条</span>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {issues.map((issue) => (
              <button
                key={issue.id}
                type="button"
                onClick={() => selectIssue(issue.id)}
                style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start', textAlign: 'left', cursor: 'pointer',
                  padding: 14, borderRadius: 14, border: issue.id === selectedId ? '1px solid #bfdbfe' : '1px solid #eef2f7',
                  background: issue.id === selectedId ? '#eff6ff' : '#fff', fontFamily: 'inherit', transition: 'all .15s ease',
                }}
              >
                <span
                  style={{
                    width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    background: `${levelTone[issue.level]}14`, color: levelTone[issue.level],
                  }}
                >
                  <AlertIcon size={18} />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13, color: '#1e293b' }}>{issue.studentName}</strong>
                    <em className="qtx-nav-badge" style={{ fontStyle: 'normal', background: levelTone[issue.level], margin: 0, padding: '2px 7px', fontSize: 10 }}>{issue.level}</em>
                    <span className={`qtx-badge ${issue.category === 'Agent 逻辑卡死' ? 'qtx-badge-amber' : issue.category === '学生情绪预警' ? 'qtx-badge-rose' : 'qtx-badge-blue'}`}>{issue.category}</span>
                  </span>
                  <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{issue.summary}</span>
                  <span style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: '#94a3b8' }}>
                    <span><ClockIcon size={12} /> {issue.time}</span>
                    <span>{issue.channel}</span>
                    <span className="qtx-badge qtx-badge-slate">{issue.status}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="qtx-col-8 qtx-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: 18, background: 'linear-gradient(135deg,#fff7ed,#eff6ff)', borderBottom: '1px solid #eef2f7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b' }}>{selected.studentName} · 干预工作台</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                负责导师：{selected.assignee} · 状态：{selected.status}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="qtx-btn" type="button">标记为误报</button>
              <button className="qtx-btn qtx-btn-ghost-blue" type="button">转交处理</button>
              <button className="qtx-btn qtx-btn-primary" type="button">
                <CheckCircleIcon size={15} /> 完成闭环
              </button>
            </div>
          </div>

          <div style={{ padding: 20, display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="qtx-card-soft" style={{ padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <SparklesIcon size={15} style={{ color: '#2563eb' }} /> AI 诊断
                </div>
                <p style={{ margin: 0, fontSize: 12, color: '#475569', lineHeight: 1.7 }}>{selected.diagnostic}</p>
              </div>
              <div className="qtx-card-soft" style={{ padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TrendingUpIcon size={15} style={{ color: '#0d9488' }} /> 干预建议
                </div>
                <p style={{ margin: 0, fontSize: 12, color: '#475569', lineHeight: 1.7 }}>{selected.suggestion}</p>
              </div>
            </div>

            <div className="qtx-card-soft" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <SendIcon size={15} style={{ color: '#7c3aed' }} /> Inject Prompt 干预指令
                </div>
                <span className="qtx-badge qtx-badge-slate">Idempotency-Key: inj_{selected.id}</span>
              </div>
              <textarea
                value={promptText}
                onChange={(e) => { setPromptText(e.target.value); setPreviewed(false); }}
                rows={3}
                className="qtx-input"
                style={{ resize: 'vertical', background: '#fff', lineHeight: 1.6 }}
              />
              {previewed ? (
                <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: '#f0f9ff', border: '1px solid #dbeafe', fontSize: 12, color: '#1d4ed8', lineHeight: 1.6 }}>
                  <strong>预览确认</strong>：该指令将以「教师已确认」身份注入 AI 导师上下文，并记录审计日志。请再次确认内容无敏感信息。
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button className="qtx-btn" type="button" onClick={() => setPreviewed(true)}>
                  <SparklesIcon size={15} /> 预览指令
                </button>
                <button
                  className="qtx-btn qtx-btn-danger"
                  type="button"
                  disabled={!previewed}
                  style={!previewed ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                >
                  <SendIcon size={15} /> 确认发送
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
