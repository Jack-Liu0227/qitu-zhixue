'use client';

import { useState, useEffect, useRef } from 'react';
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

/**
 * 问题类型。契约里的 `TeacherInterventionRow` **没有**类型 / 来源字段，
 * 也没有可筛选的 query 参数（列表接口一次性返回全部），所以这里只能依据
 * `reason` 文本做本地归类。措辞与产品文档「问题类型」保持一致，
 * 并在界面上明确标注「按原因文本归类」，避免把启发式判断伪装成服务端事实。
 */
type IssueCategory = 'parent_feedback' | 'learning_block' | 'system' | 'other';

const CATEGORY_LABELS: Record<IssueCategory, string> = {
  parent_feedback: '家长反馈',
  learning_block: '学习卡点',
  system: '系统异常',
  other: '其他',
};

const CATEGORY_TONES: Record<IssueCategory, string> = {
  parent_feedback: '#7c3aed',
  learning_block: '#2563eb',
  system: '#d97706',
  other: '#64748b',
};

function classifyIssue(reason: string): IssueCategory {
  const text = reason ?? '';
  if (/家长|监护人|父母/.test(text)) return 'parent_feedback';
  if (/系统异常|服务异常|接口异常|故障|报错/.test(text)) return 'system';
  if (/卡住|卡点|任务失败|连续失败|挫败|情绪|无法推进|推进困难/.test(text)) {
    return 'learning_block';
  }
  return 'other';
}

function CategoryBadge({ category }: { category: IssueCategory }) {
  const tone = CATEGORY_TONES[category];
  return (
    <span
      className="qtx-badge"
      style={{ background: `${tone}14`, color: tone, borderColor: `${tone}33` }}
    >
      {CATEGORY_LABELS[category]}
    </span>
  );
}

/** 状态 / 负责人 / 时间线：把一次介入的关键节点显式列出来，避免信息散落。 */
function InterventionTimeline({
  intervention,
  lastActionAt,
}: {
  intervention: TeacherInterventionRow;
  lastActionAt: string | null;
}) {
  const formatTime = (value: string | null) =>
    value
      ? new Date(value).toLocaleString('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';

  const nodes: { label: string; detail: string; time: string; tone: string }[] = [
    {
      label: '告警创建',
      detail: '系统记录该学生的介入请求',
      time: formatTime(intervention.createdAt),
      tone: '#2563eb',
    },
    {
      label: '负责人指派',
      detail: intervention.assigneeName ? `${intervention.assigneeName} 已接手` : '尚未指派负责人',
      time: '—',
      tone: intervention.assigneeName ? '#4f46e5' : '#94a3b8',
    },
    {
      label: '状态更新',
      detail: `当前状态：${statusLabels[intervention.status] ?? intervention.status}`,
      time: formatTime(lastActionAt),
      tone: statusTone[intervention.status] ?? '#64748b',
    },
  ];

  return (
    <div className="qtx-card-soft" style={{ padding: 16 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: '#1e293b',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <ClockIcon size={15} style={{ color: '#2563eb' }} /> 处理时间线
      </div>
      <div style={{ display: 'grid', gap: 0 }}>
        {nodes.map((node, index) => (
          <div key={node.label} style={{ display: 'flex', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: node.tone,
                  flexShrink: 0,
                  marginTop: 4,
                }}
              />
              {index < nodes.length - 1 ? (
                <span style={{ flex: 1, width: 2, background: '#eef2f7', minHeight: 26 }} />
              ) : null}
            </div>
            <div style={{ paddingBottom: index < nodes.length - 1 ? 14 : 0, flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#1e293b',
                }}
              >
                <span>{node.label}</span>
                <span style={{ fontWeight: 500, color: '#94a3b8' }}>{node.time}</span>
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 3, lineHeight: 1.6 }}>
                {node.detail}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="qtx-note" style={{ marginTop: 4 }}>
        时间线来自服务端返回的创建时间与本次操作回执；历史处理记录接口尚未开放，未展示的节点标为「—」。
      </div>
    </div>
  );
}

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
  const [guidanceText, setGuidanceText] = useState('');
  const [sending, setSending] = useState(false);
  const pendingKey = useRef<{ signature: string; key: string } | null>(null);
  const keyFor = (action: 'acknowledge' | 'resolve') => {
    const signature = JSON.stringify([intervention.id, action, guidanceText || null]);
    if (pendingKey.current?.signature !== signature) pendingKey.current = { signature, key: crypto.randomUUID() };
    return pendingKey.current.key;
  };
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);
  /** 成功提示要说清做的是哪个动作，否则完成闭环后显示「建议已保存」会误导。 */
  const [succeededAction, setSucceededAction] = useState<'acknowledge' | 'resolve'>('acknowledge');
  /** 本次会话内动作回执的时间，供时间线展示真实状态更新时间。 */
  const [lastActionAt, setLastActionAt] = useState<string | null>(null);

  useEffect(() => {
    setDetailLoading(true);
    setSending(false);
    setSendError(null);
    setSendSuccess(false);
    setLastActionAt(null);
    teacherApi
      .interventionDetail(intervention.id)
      .then((response) => {
        setDiagnostic(response.data.diagnostic);
        setSuggestion(response.data.suggestion);
        // 服务端建议话术仅作为可参考的草稿，默认**不触发**任何模型调用。
        setGuidanceText(response.data.suggestedPrompt);
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
        setGuidanceText('');
        setDetailLoading(false);
      });
  }, [intervention.id]);

  /**
   * 保存「人工指导建议」。它只把文字写入介入记录（acknowledge 动作的 note），
   * **默认不会触发 AI 模型、不会注入提示词**；是否在学生会话中生效由服务端策略决定。
   */
  const handleSaveGuidance = async () => {
    setSending(true);
    setSendError(null);
    setSendSuccess(false);
    const idempotencyKey = keyFor('acknowledge');
    try {
      const response = await teacherApi.interventionAction(
        intervention.id,
        { action: 'acknowledge', note: guidanceText || null },
        idempotencyKey,
      );
      setSendSuccess(true);
      pendingKey.current = null;
      setSucceededAction('acknowledge');
      setLastActionAt(response.data.changedAt);
      setSending(false);
      onMutated?.();
    } catch (error) {
      setSending(false);
      if (error instanceof TeacherPermissionError) {
        setSendError('权限不足，无法保存指导建议');
      } else if (error instanceof TeacherOfflineError) {
        setSendError('网络连接失败，请检查网络后重试');
      } else {
        setSendError('保存失败，请稍后重试');
      }
    }
  };

  /**
   * 「完成闭环」对应契约里的 `resolve`。它同样不注入提示词。
   * 幂等键由「介入对象 + 动作」确定，重复点击或失败重试只会产生一次副作用。
   */
  const handleResolve = async () => {
    setSending(true);
    setSendError(null);
    setSendSuccess(false);
    try {
      const response = await teacherApi.interventionAction(
        intervention.id,
        { action: 'resolve', note: guidanceText || null },
        keyFor('resolve'),
      );
      setSendSuccess(true);
      pendingKey.current = null;
      setSucceededAction('resolve');
      setLastActionAt(response.data.changedAt);
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

  const category = classifyIssue(intervention.reason);

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
          <div
            style={{
              fontSize: 12,
              color: '#64748b',
              marginTop: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span>负责人：{intervention.assigneeName ?? '未分配'}</span>
            <span>·</span>
            <span>
              状态：
              <span style={{ color: statusTone[intervention.status], fontWeight: 700 }}>
                {statusLabels[intervention.status] ?? intervention.status}
              </span>
            </span>
            <CategoryBadge category={category} />
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
                <SparklesIcon size={15} style={{ color: '#2563eb' }} /> 系统诊断
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

          {/* 状态 / 负责人 / 时间线 */}
          <InterventionTimeline intervention={intervention} lastActionAt={lastActionAt} />

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
              <SendIcon size={15} style={{ color: '#7c3aed' }} /> 人工指导建议
            </div>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#64748b', lineHeight: 1.7 }}>
              写下你打算采取的下一步人工指导（例如和谁沟通、补充什么材料）。
              默认只作为教师跟进记录保存，
              <strong>不会自动注入提示词，也不会触发模型调用</strong>。
            </p>
            <textarea
              value={guidanceText}
              onChange={(e) => setGuidanceText(e.target.value)}
              rows={3}
              className="qtx-input"
              placeholder="例如：先安抚情绪，再和学生一起把任务拆成两步。"
              style={{ resize: 'vertical', background: '#fff', lineHeight: 1.6 }}
            />
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
                <strong>{succeededAction === 'resolve' ? '已完成闭环' : '指导建议已保存'}</strong>
                ：{succeededAction === 'resolve'
                  ? '该告警已标记为已解决，并进入干预历史。'
                  : '已作为教师跟进记录保存，不会自动触发模型。'}
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
                className="qtx-btn qtx-btn-ghost-blue"
                type="button"
                disabled={sending || sendSuccess}
                style={sending || sendSuccess ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                onClick={handleSaveGuidance}
              >
                {sending ? (
                  <>
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        border: '2px solid #1d4ed8',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'qitu-spin 0.6s linear infinite',
                      }}
                    />
                    保存中...
                  </>
                ) : (
                  <>
                    <SendIcon size={15} /> 保存指导建议
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
  const [statusFilter, setStatusFilter] = useState<'all' | TeacherInterventionRow['status']>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | IssueCategory>('all');

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

  // 列表接口一次性返回全部介入请求且没有查询参数，所以状态 / 问题类型都在本地真过滤。
  const filteredItems = data.items.filter((issue) => {
    if (statusFilter !== 'all' && issue.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && classifyIssue(issue.reason) !== categoryFilter) return false;
    return true;
  });

  // 当前选中项若被筛掉，回退到筛选结果的第一条，避免工作台显示一条列表里看不到的记录。
  const selected = filteredItems.find((i) => i.id === selectedId) ?? filteredItems[0] ?? null;
  const parentFeedbackCount = data.items.filter(
    (i) => classifyIssue(i.reason) === 'parent_feedback',
  ).length;
  const filterActive = statusFilter !== 'all' || categoryFilter !== 'all';

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
          label="家长反馈"
          value={String(parentFeedbackCount)}
          delta={null}
          icon={<TrendingUpIcon size={22} />}
          tone="#7c3aed"
        />
      </section>

      {/* 主体：告警列表 + 干预工作台 */}
      <section className="qtx-grid qtx-grid-12" style={{ alignItems: 'flex-start' }}>
        <div className="qtx-col-4 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" style={{ background: '#e11d48' }} /> 介入请求
            </div>
            <span className="qtx-badge qtx-badge-rose">
              {filterActive ? `${filteredItems.length} / ${data.items.length}` : data.items.length} 条
            </span>
          </div>

          {/* 筛选：状态 + 问题类型（含家长反馈） */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <select
              className="qtx-select"
              style={{ flex: 1, minWidth: 110 }}
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'all' | TeacherInterventionRow['status'])
              }
              aria-label="按状态筛选"
            >
              <option value="all">全部状态</option>
              <option value="open">待介入</option>
              <option value="acknowledged">处理中</option>
              <option value="resolved">已解决</option>
            </select>
            <select
              className="qtx-select"
              style={{ flex: 1, minWidth: 110 }}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as 'all' | IssueCategory)}
              aria-label="按问题类型筛选"
            >
              <option value="all">全部类型</option>
              <option value="parent_feedback">家长反馈</option>
              <option value="learning_block">学习卡点</option>
              <option value="system">系统异常</option>
              <option value="other">其他</option>
            </select>
            {filterActive ? (
              <button
                className="qtx-btn"
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setCategoryFilter('all');
                }}
              >
                清除筛选
              </button>
            ) : null}
          </div>
          <div className="qtx-panel-hint" style={{ marginBottom: 12 }}>
            问题类型按告警原因文本归类；家长反馈用于快速定位来自监护人的诉求。
          </div>

          {data.items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>
              暂无介入请求
            </div>
          ) : filteredItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>
              没有符合当前筛选条件的介入请求
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {filteredItems.map((issue) => {
                const category = classifyIssue(issue.reason);
                return (
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
                      border: issue.id === selected?.id ? '1px solid #bfdbfe' : '1px solid #eef2f7',
                      background: issue.id === selected?.id ? '#eff6ff' : '#fff',
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
                      <span
                        style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                      >
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
                        <CategoryBadge category={category} />
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
                          flexWrap: 'wrap',
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
                        <span>负责人：{issue.assigneeName ?? '未分配'}</span>
                        {issue.projectTitle && <span>{issue.projectTitle}</span>}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selected ? (
          <InterventionWorkbench intervention={selected} onMutated={refreshList} />
        ) : (
          <div className="qtx-col-8 qtx-card" style={{ padding: 40, textAlign: 'center' }}>
            <TicketIcon size={40} style={{ color: '#cbd5e1', margin: '0 auto 12px' }} />
            <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
              选择左侧的一条介入请求查看处理详情。
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
