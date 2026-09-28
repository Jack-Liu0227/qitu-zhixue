'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ActivityIcon,
  ArrowRightIcon,
  ChartIcon,
  HeartIcon,
  SparklesIcon,
  TrendingUpIcon,
  AlertIcon,
} from '../../../components/icons';
import { MetricCard } from '../../../components/metric-card';
import {
  teacherApi,
  TeacherOfflineError,
  TeacherPermissionError,
  type TeacherStatisticsPageData,
} from '../../../lib/teacherApi';

function ErrorState({ type }: { type: string }) {
  if (type === 'permission') {
    return (
      <div className="qtx-page">
        <div className="qtx-card" style={{ padding: 40, textAlign: 'center' }}>
          <AlertIcon size={48} style={{ color: '#94a3b8', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 18, color: '#1e293b', marginBottom: 8 }}>权限不足</h2>
          <p style={{ color: '#64748b', fontSize: 14 }}>您没有访问数据统计的权限。</p>
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

const stageColors: Record<string, string> = {
  exploration: '#2563eb',
  intent_confirmed: '#3b82f6',
  theory_learning: '#4f46e5',
  theory_check: '#6366f1',
  practice_ready: '#0d9488',
  practice_building: '#14b8a6',
  artifact_review: '#d97706',
  reflection: '#f59e0b',
  published: '#e11d48',
  completed: '#16a34a',
};

const stageLabels: Record<string, string> = {
  exploration: '灵感探索',
  intent_confirmed: '确认意图',
  theory_learning: '理论学习',
  theory_check: '理论检验',
  practice_ready: '实践就绪',
  practice_building: '动手制作',
  artifact_review: '作品评审',
  reflection: '反思记录',
  published: '已发布',
  completed: '已完成',
};

export default function StatisticsPage() {
  const [data, setData] = useState<TeacherStatisticsPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    teacherApi
      .statistics()
      .then((response) => {
        setData(response.data);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof TeacherPermissionError) setError('permission');
        else if (err instanceof TeacherOfflineError) setError('offline');
        else setError('generic');
        setLoading(false);
      });
  }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState type={error} />;
  if (!data) return <ErrorState type="generic" />;

  return (
    <div className="qtx-page">
      {/* 页面横幅 */}
      <section className="qtx-banner">
        <div className="qtx-banner-inner">
          <div className="qtx-banner-left">
            <div className="qtx-banner-avatar">
              <div>
                <ChartIcon size={28} />
              </div>
            </div>
            <div>
              <h2>数据统计</h2>
              <p>基于学习事件的实时班级洞察。</p>
            </div>
          </div>
          <div className="qtx-banner-slogan">数据不是标签，而是发现每个孩子闪光点的线索。</div>
          <div className="qtx-banner-right">
            <div className="qtx-bubble">
              {data.dataSource === 'demo' ? '🧪 演示数据' : '🤖 本周数据已更新～'}
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
          label="学生总数"
          value={String(data.totals.studentCount)}
          delta={
            data.totals.activeStudentCount > 0 ? (
              <>
                本周活跃 <span className="up">{data.totals.activeStudentCount}</span>
              </>
            ) : null
          }
          icon={<ActivityIcon size={22} />}
          tone="#2563eb"
        />
        <MetricCard
          label="本周学习次数"
          value={String(data.totals.sessionsThisWeek)}
          delta={null}
          icon={<SparklesIcon size={22} />}
          tone="#4f46e5"
        />
        <MetricCard
          label="本周学习时长"
          value={`${data.totals.minutesThisWeek}分钟`}
          delta={null}
          icon={<TrendingUpIcon size={22} />}
          tone="#0d9488"
        />
        <MetricCard
          label="本周完成任务"
          value={String(data.totals.tasksCompletedThisWeek)}
          delta={null}
          icon={<HeartIcon size={22} />}
          tone="#e11d48"
        />
      </section>

      {/* 中部图表 */}
      <section className="qtx-grid qtx-grid-12">
        <div className="qtx-col-5 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" style={{ background: '#4f46e5' }} /> 阶段分布
            </div>
          </div>
          {data.stageDistribution.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>
              暂无项目数据
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {data.stageDistribution.map((item) => {
                const total = data.stageDistribution.reduce((sum, s) => sum + s.count, 0);
                const percent = total > 0 ? Math.round((item.count / total) * 100) : 0;
                return (
                  <div key={item.stage} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        background: stageColors[item.stage],
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 12,
                          marginBottom: 6,
                        }}
                      >
                        <span style={{ color: '#64748b' }}>
                          {stageLabels[item.stage] ?? item.stage}
                        </span>
                        <strong style={{ color: '#334155' }}>{item.count}</strong>
                      </div>
                      <div style={{ height: 6, background: '#eef2f7', borderRadius: 999 }}>
                        <div
                          style={{
                            width: `${percent}%`,
                            height: 6,
                            background: stageColors[item.stage],
                            borderRadius: 999,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="qtx-col-7 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" /> 每周活跃趋势
            </div>
          </div>
          {data.weeklyActivity.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>
              暂无活跃数据
            </div>
          ) : (
            <>
              <svg viewBox="0 0 560 220" style={{ width: '100%', height: 'auto', display: 'block' }}>
                <defs>
                  <linearGradient id="statArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0, 1, 2, 3].map((i) => (
                  <line
                    key={i}
                    x1="0"
                    x2="560"
                    y1={20 + i * 50}
                    y2={20 + i * 50}
                    stroke="#eef2f7"
                    strokeWidth="1"
                  />
                ))}
                {data.weeklyActivity.length > 1 && (
                  <>
                    <path
                      d={`M${data.weeklyActivity
                        .map((w, i) => {
                          const x = 20 + (i * 520) / Math.max(data.weeklyActivity.length - 1, 1);
                          const max = Math.max(...data.weeklyActivity.map((a) => a.activeStudents));
                          const y = max > 0 ? 170 - (w.activeStudents / max) * 140 : 170;
                          return `${i === 0 ? '' : ' L'}${x},${y}`;
                        })
                        .join('')} L540,180 L20,180 Z`}
                      fill="url(#statArea)"
                    />
                    <path
                      d={`M${data.weeklyActivity
                        .map((w, i) => {
                          const x = 20 + (i * 520) / Math.max(data.weeklyActivity.length - 1, 1);
                          const max = Math.max(...data.weeklyActivity.map((a) => a.activeStudents));
                          const y = max > 0 ? 170 - (w.activeStudents / max) * 140 : 170;
                          return `${i === 0 ? '' : ' L'}${x},${y}`;
                        })
                        .join('')}`}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </>
                )}
                {data.weeklyActivity.map((w, i) => {
                  const x = 20 + (i * 520) / Math.max(data.weeklyActivity.length - 1, 1);
                  return (
                    <text key={i} x={x} y="205" fill="#94a3b8" fontSize="11" textAnchor="middle">
                      {w.weekLabel}
                    </text>
                  );
                })}
              </svg>
              <div
                style={{
                  display: 'flex',
                  gap: 18,
                  marginTop: 10,
                  fontSize: 12,
                  color: '#64748b',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 12,
                      height: 3,
                      background: '#2563eb',
                      borderRadius: 2,
                      display: 'inline-block',
                    }}
                  />
                  活跃学生
                </span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* 底部：需要关注名单 */}
      <section className="qtx-grid qtx-grid-12">
        <div className="qtx-col-12 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" style={{ background: '#d97706' }} /> 需要关注的学生
            </div>
            <Link className="qtx-link" href="/students">
              查看学生 <ArrowRightIcon size={14} />
            </Link>
          </div>
          {data.needsAttention.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>
              暂无需要关注的学生
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
                    <th>待处理问题</th>
                    <th>监护人</th>
                  </tr>
                </thead>
                <tbody>
                  {data.needsAttention.map((s) => (
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
                        <span className={`qtx-badge ${s.attentionCount > 0 ? 'qtx-badge-rose' : 'qtx-badge-slate'}`}>
                          {s.attentionCount} 个
                        </span>
                      </td>
                      <td>
                        <span className={`qtx-badge ${s.guardianCount === 0 ? 'qtx-badge-amber' : 'qtx-badge-emerald'}`}>
                          {s.guardianCount} 人
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
