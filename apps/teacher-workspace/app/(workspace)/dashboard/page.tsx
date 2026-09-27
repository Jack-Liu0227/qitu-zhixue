'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ActivityIcon,
  AlertIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  HeartIcon,
  SparklesIcon,
  UsersIcon,
} from '../../../components/icons';
import { MetricCard } from '../../../components/metric-card';
import {
  teacherApi,
  TeacherOfflineError,
  TeacherPermissionError,
  type TeacherRosterPageData,
  type TeacherInterventionListPageData,
} from '../../../lib/teacherApi';

function ErrorState({ type }: { type: string }) {
  if (type === 'permission') {
    return (
      <div className="qtx-page">
        <div className="qtx-card" style={{ padding: 40, textAlign: 'center' }}>
          <AlertIcon size={48} style={{ color: '#94a3b8', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 18, color: '#1e293b', marginBottom: 8 }}>权限不足</h2>
          <p style={{ color: '#64748b', fontSize: 14 }}>您没有访问班主任工作台的权限。</p>
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

function DashboardContent({
  roster,
  interventions,
}: {
  roster: TeacherRosterPageData;
  interventions: TeacherInterventionListPageData;
}) {
  const recentStudents = roster.students.slice(0, 4);
  const recentIssues = interventions.items.slice(0, 3);
  const stageColors: Record<string, string> = {
    Inspiration: '#2563eb',
    Research: '#4f46e5',
    Making: '#0d9488',
    Showcase: '#d97706',
  };
  const stageLabels: Record<string, string> = {
    Inspiration: '灵感探索',
    Research: '深度研究',
    Making: '制作测试',
    Showcase: '成果展示',
  };

  return (
    <div className="qtx-page">
      {/* 欢迎横幅 */}
      <section className="qtx-banner">
        <div className="qtx-banner-inner">
          <div className="qtx-banner-left">
            <div className="qtx-banner-avatar">
              <div>
                <SparklesIcon size={28} />
              </div>
            </div>
            <div>
              <h2>早上好，{roster.teacher.displayName}！</h2>
              <p>
                今天有 {interventions.totals.open} 个待处理问题
                {roster.totals.stuckCount > 0 ? `，其中 ${roster.totals.stuckCount} 个需要重点关注` : ''}。
              </p>
            </div>
          </div>
          <div className="qtx-banner-slogan">
            保持好奇心的探索，
            <br />
            比给出标准答案更重要。
          </div>
          <div className="qtx-banner-right">
            <div className="qtx-bubble">
              {roster.dataSource === 'demo' ? '🧪 演示数据' : '🤖 已为你整理今日待办～'}
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
                boxShadow: '0 8px 20px rgba(99,102,241,.28)',
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
          label="学生总数"
          value={String(roster.totals.studentCount)}
          delta={null}
          icon={<UsersIcon size={22} />}
          tone="#2563eb"
        />
        <MetricCard
          label="进行中的项目"
          value={String(roster.students.filter((s) => s.currentProjectId).length)}
          delta={null}
          icon={<ActivityIcon size={22} />}
          tone="#4f46e5"
        />
        <MetricCard
          label="待处理问题"
          value={String(interventions.totals.open)}
          delta={null}
          icon={<AlertIcon size={22} />}
          tone="#d97706"
        />
        <MetricCard
          label="需要关注"
          value={String(roster.totals.stuckCount)}
          delta={null}
          icon={<CheckCircleIcon size={22} />}
          tone="#059669"
        />
      </section>

      {/* 中部：图表 + 待办 */}
      <section className="qtx-grid qtx-grid-12">
        <div className="qtx-col-8 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" /> 阶段分布
            </div>
            {/*
              导出周报没有后端接口，不摆放一个点了没反应的按钮；
              改成不具交互性的说明文字。
            */}
            <span className="qtx-panel-hint">周报导出暂未开放</span>
          </div>
          <div style={{ display: 'grid', gap: 14, padding: '8px 0' }}>
            {Object.entries(stageLabels).map(([stage, label]) => {
              const count = roster.students.filter((s) => s.currentStage === stage).length;
              const total = roster.students.filter((s) => s.currentStage).length;
              const percent = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: stageColors[stage],
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 13,
                        marginBottom: 6,
                      }}
                    >
                      <strong style={{ color: '#1e293b' }}>{label}</strong>
                      <span style={{ color: '#64748b' }}>{count} 人</span>
                    </div>
                    <div style={{ height: 8, background: '#eef2f7', borderRadius: 999 }}>
                      <div
                        style={{
                          width: `${percent}%`,
                          height: 8,
                          borderRadius: 999,
                          background: stageColors[stage],
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="qtx-col-4 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" style={{ background: '#d97706' }} /> 待处理问题
            </div>
            <Link className="qtx-link" href="/teacher/issues">
              查看全部 <ArrowRightIcon size={14} />
            </Link>
          </div>
          {recentIssues.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>
              暂无待处理问题
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {recentIssues.map((issue) => (
                <div
                  key={issue.id}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: 10,
                    borderRadius: 12,
                    background: '#f8fafc',
                    border: '1px solid #eef2f7',
                  }}
                >
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#fffbeb',
                      color: '#b45309',
                    }}
                  >
                    <AlertIcon size={17} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13, color: '#1e293b' }}>
                        {issue.studentDisplayName}
                      </strong>
                      <span className="qtx-badge qtx-badge-amber">{issue.status}</span>
                    </div>
                    <p style={{ margin: '5px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                      {issue.reason}
                    </p>
                    <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8', display: 'flex', gap: 10 }}>
                      <span>
                        <ClockIcon size={12} />{' '}
                        {new Date(issue.createdAt).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 底部：最近活跃学生 + 快捷操作 */}
      <section className="qtx-grid qtx-grid-12">
        <div className="qtx-col-7 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" style={{ background: '#4f46e5' }} /> 最近活跃学生
            </div>
            <Link className="qtx-link" href="/teacher/students">
              学生管理 <ArrowRightIcon size={14} />
            </Link>
          </div>
          {recentStudents.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>
              暂无学生数据
            </div>
          ) : (
            <div className="qtx-table-wrap">
              <table className="qtx-table">
                <thead>
                  <tr>
                    <th>学生</th>
                    <th>当前项目</th>
                    <th>活跃天数</th>
                    <th>本周任务</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {recentStudents.map((s) => (
                    <tr key={s.studentId}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span
                            className="qtx-avatar"
                            style={{ width: 32, height: 32, borderRadius: 10, fontSize: 13 }}
                          >
                            {s.avatarInitial}
                          </span>
                          <div>
                            <strong style={{ color: '#1e293b' }}>{s.displayName}</strong>
                            <div className="qtx-small qtx-muted">{s.gradeLabel ?? '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td>{s.currentProjectTitle ?? '—'}</td>
                      <td>{s.activeDays} 天</td>
                      <td>{s.weeklyTasks} 个</td>
                      <td>
                        <span
                          className={`qtx-badge ${s.stuck ? 'qtx-badge-amber' : 'qtx-badge-emerald'}`}
                        >
                          <span
                            className="qtx-status-dot"
                            style={{ background: s.stuck ? '#d97706' : '#059669' }}
                          />
                          {s.stuck ? '需要关注' : '正常'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="qtx-col-5 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" style={{ background: '#059669' }} /> 快捷操作
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {([
              ['📋', '查看问题', '处理介入请求', '/issues'],
              ['👨‍🎓', '学生名册', '查看学生详情', '/students'],
              ['📊', '数据统计', '班级学习概览', '/statistics'],
              ['⚙️', '系统设置', '策略配置', '/settings'],
            ] as const).map(([emoji, title, desc, href]) => (
              <Link
                key={title}
                href={href}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  alignItems: 'flex-start',
                  padding: 14,
                  borderRadius: 14,
                  border: '1px solid #eef2f7',
                  background: '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  transition: 'all .15s ease',
                  textDecoration: 'none',
                }}
              >
                <span style={{ fontSize: 22 }}>{emoji}</span>
                <strong style={{ fontSize: 13, color: '#1e293b' }}>{title}</strong>
                <span style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>{desc}</span>
              </Link>
            ))}
          </div>
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 12,
              background: '#f0f9ff',
              border: '1px solid #dbeafe',
              fontSize: 12,
              color: '#1d4ed8',
              lineHeight: 1.6,
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
            }}
          >
            <HeartIcon size={15} style={{ marginTop: 2, flexShrink: 0 }} />
            {roster.totals.withoutGuardianCount > 0
              ? `${roster.totals.withoutGuardianCount} 名学生尚无监护人接入，建议推动家长绑定。`
              : '所有学生均已绑定监护人。'}
          </div>
        </div>
      </section>
    </div>
  );
}

export default function DashboardPage() {
  const [roster, setRoster] = useState<TeacherRosterPageData | null>(null);
  const [interventions, setInterventions] = useState<TeacherInterventionListPageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([teacherApi.roster(), teacherApi.interventions()])
      .then(([rosterResponse, interventionsResponse]) => {
        if (cancelled) return;
        setRoster(rosterResponse.data);
        setInterventions(interventionsResponse.data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof TeacherPermissionError) setError('permission');
        else if (err instanceof TeacherOfflineError) setError('offline');
        else setError('generic');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorState type={error} />;
  if (!roster || !interventions) return <LoadingState />;
  return <DashboardContent roster={roster} interventions={interventions} />;
}
