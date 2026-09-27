'use client';

import { useState, useEffect } from 'react';
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  SendIcon,
  SparklesIcon,
  TicketIcon,
  TrendingUpIcon,
} from '../../../components/icons';
import { MetricCard } from '../../../components/metric-card';
import {
  teacherApi,
  TeacherOfflineError,
  TeacherPermissionError,
  type TeacherInterventionListPageData,
  type TeacherInterventionRow,
} from '../../../lib/teacherApi';

function ErrorState({ type }: { type: string }) {
  if (type === 'permission') {
    return (
      <div className="qtx-page">
        <div className="qtx-card" style={{ padding: 40, textAlign: 'center' }}>
          <AlertIcon size={48} style={{ color: '#94a3b8', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 18, color: '#1e293b', marginBottom: 8 }}>权限不足</h2>
          <p style={{ color: '#64748b', fontSize: 14 }}>您没有访问介入请求的权限。</p>
        </div>
      </div>
    );
  }
  if (type === 'offline') {
    return (
      <div className="qtx-page">
        <div className="qtx-card" style={{ padding: 40, textAlign: 'center' }}>
          <AlertIcon size={48} style={{ color: '#94a3b8', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 18, color: '#1e293b', marginBottom: 8 }}>网络连接失败</h2>
          <p style={{ color: '#64748b', fontSize: 14 }}>请检查网络连接后重试。</p>
        </div>
      </div>
    );
  }
  return (
    <div className="qtx-page">
      <div className="qtx-card" style={{ padding: 40, textAlign: 'center' }}>
        <AlertIcon size={48} style={{ color: '#94a3b8', margin: '0 auto 16px' }} />
        <h2 style={{ fontSize: 18, color: '#1e293b', marginBottom: 8 }}>加载失败</h2>
        <p style={{ color: '#64748b', fontSize: 14 }}>数据加载时遇到问题，请稍后重试。</p>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="qtx-page">
      <div className="qtx-card" style={{ padding: 40, textAlign: 'center' }}>
        <div
          style={{
            width: 48,
            height: 48,
            border: '4px solid #eef2f7',
            borderTopColor: '#2563eb',
            borderRadius: '50%',
            margin: '0 auto 16px',
            animation: 'qitu-spin 1s linear infinite',
          }}
        />
        <p style={{ color: '#64748b', fontSize: 14 }}>加载中...</p>
      </div>
    </div>
  );
}

const statusTone: Record<string, string> = {
  open: '#e11d48',
  acknowledged: '#d97706',
  resolved: '#059669',
};

const statusLabels: Record<string, string> = {
  open: '待介入',
  acknowledged: '处理中',
  resolved: '已解决',
};

function InterventionWorkbench({
  intervention,
  onMutated,
}: {
  intervention: TeacherInterventionRow;
  /** 动作成功后通知列表刷新，否则状态与顶部统计会停在旧值。 */
  onMutated?: () => void;
}) {
  const [detailLoading, setDetailLoading] = useState(true);
  const [diagnostic, setDiagnostic] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [suggestedPrompt, setSuggestedPrompt] = useState('');
  const [promptText, setPromptText] = useState('');
  const [previewed, setPreviewed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);
  /** 成功提示要说清做的是哪个动作，否则完成闭环后显示「指令已记录」会误导。 */
  const [succeededAction, setSucceededAction] = useState<'acknowledge' | 'resolve'>('acknowledge');

  useEffect(() => {
    setDetailLoading(true);
    setPreviewed(false);
    setSending(false);
    setSendError(null);
    setSendSuccess(false);
    teacherApi
      .interventionDetail(intervention.id)
      .then((response) => {
        setDiagnostic(response.data.diagnostic);
        setSuggestion(response.data.suggestion);
        setSuggestedPrompt(response.data.suggestedPrompt);
        setPromptText(response.data.suggestedPrompt);
        setDetailLoading(false);
      })
      .catch((error) => {
        const message =
          error instanceof TeacherPermissionError
            ? '权限不足，无法加载该介入请求的诊断详情'
            : error instanceof TeacherOfflineError
              ? '网络连接失败，请检查网络后重试'
              : '诊断详情加载失败，请稍后重试';
        setDiagnostic(message);
        setSuggestion(message);
        setSuggestedPrompt('');
        setPromptText('');
        setDetailLoading(false);
      });
  }, [intervention.id]);

  const handleSend = async () => {
    setSending(true);
    setSendError(null);
    setSendSuccess(false);
    const idempotencyKey = `inj_${intervention.id}_acknowledge`;
    try {
      await teacherApi.interventionAction(
        intervention.id,
        { action: 'acknowledge', note: promptText || null },
        idempotencyKey,
      );
      setSendSuccess(true);
      setSucceededAction('acknowledge');
      setSending(false);
      onMutated?.();
    } catch (error) {
      setSending(false);
      if (error instanceof TeacherPermissionError) {
        setSendError('权限不足，无法发送干预指令');
      } else if (error instanceof TeacherOfflineError) {
        setSendError('网络连接失败，请检查网络后重试');
      } else {
        setSendError('发送失败，请稍后重试');
      }
    }
  };

  /**
   * 「完成闭环」对应契约里的 `resolve`。它不做提示词注入，所以不要求先预览。
   * 幂等键和 acknowledge 用同一套规则：由「干预对象 + 动作」确定，
   * 因此重复点击或失败重试都只会产生一次副作用。
   */
  const handleResolve = async () => {
    setSending(true);
    setSendError(null);
    setSendSuccess(false);
    try {
      await teacherApi.interventionAction(
        intervention.id,
        { action: 'resolve', note: promptText || null },
        `inj_${intervention.id}_resolve`,
      );
      setSendSuccess(true);
      setSucceededAction('resolve');
      setSending(false);
      onMutated?.();
    } catch (error) {
      setSending(false);
      if (error instanceof TeacherPermissionError) {
        setSendError('权限不足，无法完成闭环');
      } else if (error instanceof TeacherOfflineError) {
        setSendError('网络连接失败，请检查网络后重试');
      } else {
        setSendError('操作失败，请稍后重试');
      }
    }
  };

  return (
    <div className="qtx-col-8 qtx-card" style={{ overflow: 'hidden' }}>
      <div
        style={{
          padding: 18,
          background: 'linear-gradient(135deg,#fff7ed,#eff6ff)',
          borderBottom: '1px solid #eef2f7',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b' }}>
            {intervention.studentDisplayName} · 干预工作台
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            负责导师：{intervention.assigneeName ?? '未分配'} · 状态：
            {statusLabels[intervention.status] ?? intervention.status}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/*
            契约里的动作只有 acknowledge / resolve。误报标注与转交没有对应的
            后端动作，用非交互说明代替禁用按钮。
          */}
          <span className="qtx-panel-hint">误报标注与转交暂未开放</span>
          <button
            className="qtx-btn qtx-btn-primary"
            type="button"
            disabled={sending || sendSuccess}
            style={sending || sendSuccess ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            onClick={handleResolve}
          >
            <CheckCircleIcon size={15} /> 完成闭环
          </button>
        </div>
      </div>

      {detailLoading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div
            style={{
              width: 40,
              height: 40,
              border: '3px solid #eef2f7',
              borderTopColor: '#2563eb',
              borderRadius: '50%',
              margin: '0 auto 12px',
              animation: 'qitu-spin 1s linear infinite',
            }}
          />
          <p style={{ color: '#94a3b8', fontSize: 13 }}>加载详情...</p>
        </div>
      ) : (
        <div style={{ padding: 20, display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="qtx-card-soft" style={{ padding: 16 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#1e293b',
                  marginBottom: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <SparklesIcon size={15} style={{ color: '#2563eb' }} /> AI 诊断
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#475569', lineHeight: 1.7 }}>
                {diagnostic}
              </p>
            </div>
            <div className="qtx-card-soft" style={{ padding: 16 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#1e293b',
                  marginBottom: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <TrendingUpIcon size={15} style={{ color: '#0d9488' }} /> 干预建议
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#475569', lineHeight: 1.7 }}>
                {suggestion}
              </p>
            </div>
          </div>

          <div className="qtx-card-soft" style={{ padding: 16 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#1e293b',
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <SendIcon size={15} style={{ color: '#7c3aed' }} /> Inject Prompt 干预指令
            </div>
            <textarea
              value={promptText}
              onChange={(e) => {
                setPromptText(e.target.value);
                setPreviewed(false);
              }}
              rows={3}
              className="qtx-input"
              style={{ resize: 'vertical', background: '#fff', lineHeight: 1.6 }}
            />
            {previewed && !sendSuccess ? (
              <div
                style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 12,
                  background: '#f0f9ff',
                  border: '1px solid #dbeafe',
                  fontSize: 12,
                  color: '#1d4ed8',
                  lineHeight: 1.6,
                }}
              >
                <strong>预览确认</strong>
                ：该指令将以「教师已确认」身份注入 AI 导师上下文，并记录审计日志。请再次确认内容无敏感信息。
              </div>
            ) : null}
            {sendSuccess ? (
              <div
                style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 12,
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  fontSize: 12,
                  color: '#15803d',
                  lineHeight: 1.6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <CheckCircleIcon size={16} />
                <strong>{succeededAction === 'resolve' ? '已完成闭环' : '发送成功'}</strong>
                ：{succeededAction === 'resolve'
                  ? '该告警已标记为已解决，并进入干预历史。'
                  : '干预指令已记录并将在学生下次会话时生效。'}
              </div>
            ) : null}
            {sendError ? (
              <div
                style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 12,
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  fontSize: 12,
                  color: '#dc2626',
                  lineHeight: 1.6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertIcon size={16} />
                {sendError}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button
                className="qtx-btn"
                type="button"
                onClick={() => setPreviewed(true)}
                disabled={sending || sendSuccess}
                style={sending || sendSuccess ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              >
                <SparklesIcon size={15} /> 预览指令
              </button>
              <button
                className="qtx-btn qtx-btn-danger"
                type="button"
                disabled={!previewed || sending || sendSuccess}
                style={!previewed || sending || sendSuccess ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                onClick={handleSend}
              >
                {sending ? (
                  <>
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        border: '2px solid #fff',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'qitu-spin 0.6s linear infinite',
                      }}
                    />
                    发送中...
                  </>
                ) : (
                  <>
                    <SendIcon size={15} /> 确认发送
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function IssuesPage() {
  const [data, setData] = useState<TeacherInterventionListPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    teacherApi
      .interventions()
      .then((response) => {
        setData(response.data);
        if (response.data.items.length > 0) {
          setSelectedId(response.data.items[0]!.id);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof TeacherPermissionError) setError('permission');
        else if (err instanceof TeacherOfflineError) setError('offline');
        else setError('generic');
        setLoading(false);
      });
  }, []);

  // 干预动作成功后刷新列表。刷新失败不覆盖页面：动作已经在服务端生效，
  // 因为一次读请求失败就把整页变成错误态是本末倒置。
  const refreshList = () => {
    teacherApi
      .interventions()
      .then((response) => setData(response.data))
      .catch(() => undefined);
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState type={error} />;
  if (!data) return <ErrorState type="generic" />;

  const selected = data.items.find((i) => i.id === selectedId);

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
            <div className="qtx-bubble">
              {data.dataSource === 'demo'
                ? '🧪 演示数据'
                : `🤖 ${data.totals.open} 条待处理告警等待确认～`}
            </div>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: '50%',
                background: 'linear-gradient(135deg,#38bdf8,#6366f1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 26,
              }}
            >
              🤖
            </div>
          </div>
        </div>
      </section>

      {/* 指标卡 */}
      <section className="qtx-grid qtx-grid-4">
        <MetricCard
          label="待介入总数"
          value={String(data.totals.open)}
          delta={null}
          icon={<AlertIcon size={22} />}
          tone="#e11d48"
        />
        <MetricCard
          label="处理中"
          value={String(data.totals.acknowledged)}
          delta={null}
          icon={<TicketIcon size={22} />}
          tone="#d97706"
        />
        <MetricCard
          label="已解决"
          value={String(data.totals.resolved)}
          delta={null}
          icon={<CheckCircleIcon size={22} />}
          tone="#059669"
        />
        <MetricCard
          label="总计"
          value={String(data.items.length)}
          delta={null}
          icon={<TrendingUpIcon size={22} />}
          tone="#4f46e5"
        />
      </section>

      {/* 主体：告警列表 + 干预工作台 */}
      <section className="qtx-grid qtx-grid-12" style={{ alignItems: 'flex-start' }}>
        <div className="qtx-col-4 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" style={{ background: '#e11d48' }} /> 介入请求
            </div>
            <span className="qtx-badge qtx-badge-rose">{data.items.length} 条</span>
          </div>
          {data.items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>
              暂无介入请求
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {data.items.map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => setSelectedId(issue.id)}
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: 14,
                    borderRadius: 14,
                    border:
                      issue.id === selectedId ? '1px solid #bfdbfe' : '1px solid #eef2f7',
                    background: issue.id === selectedId ? '#eff6ff' : '#fff',
                    fontFamily: 'inherit',
                    transition: 'all .15s ease',
                  }}
                >
                  <span
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 11,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: `${statusTone[issue.status]}14`,
                      color: statusTone[issue.status],
                    }}
                  >
                    <AlertIcon size={18} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13, color: '#1e293b' }}>
                        {issue.studentDisplayName}
                      </strong>
                      <span
                        className={`qtx-badge ${
                          issue.status === 'open'
                            ? 'qtx-badge-rose'
                            : issue.status === 'acknowledged'
                              ? 'qtx-badge-amber'
                              : 'qtx-badge-emerald'
                        }`}
                      >
                        {statusLabels[issue.status] ?? issue.status}
                      </span>
                    </span>
                    <span
                      style={{
                        display: 'block',
                        marginTop: 6,
                        fontSize: 12,
                        color: '#64748b',
                        lineHeight: 1.5,
                      }}
                    >
                      {issue.reason}
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        gap: 12,
                        marginTop: 8,
                        fontSize: 11,
                        color: '#94a3b8',
                      }}
                    >
                      <span>
                        <ClockIcon size={12} />{' '}
                        {new Date(issue.createdAt).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {issue.projectTitle && <span>{issue.projectTitle}</span>}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <InterventionWorkbench intervention={selected} onMutated={refreshList} />
        )}
      </section>
    </div>
  );
}
