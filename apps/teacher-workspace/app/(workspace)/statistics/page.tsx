'use client';

import { projectStageLabel } from '@qitu/contracts';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AttentionStudents } from '../../../components/attention-students';
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
    <div className="qtx-page" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 页面横幅 - 现代管理台风格 */}
      <section className="qtx-banner">
        <div className="qtx-banner-inner">
          <div className="qtx-banner-left">
            <div className="qtx-banner-avatar">
              <div>
                <ChartIcon size={26} />
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h2>数据统计看板</h2>
                <span style={{ fontSize: '12px', background: '#eff6ff', color: '#2563eb', padding: '2px 10px', borderRadius: '12px', fontWeight: 600, border: '1px solid #bfdbfe' }}>
                  学情洞察与过程性分析
                </span>
              </div>
              <p>查看当前名下学生的项目分布与已接入的学习指标</p>
            </div>
          </div>

          <div className="qtx-banner-right" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span className="qtx-bubble">
              {data.dataSource === 'demo' ? '演示数据模式' : '服务端统计快照'}
            </span>
            <button
              type="button"
              onClick={() => {
                const rows = [['指标', '数值'], ['学生总数', String(data.totals.studentCount)],
                  ['本周学习次数', data.signalsAvailable === false ? '暂未接入' : String(data.totals.sessionsThisWeek)],
                  ['本周学习时长估算（分钟）', data.signalsAvailable === false ? '暂未接入' : String(data.totals.minutesThisWeek)],
                  ...data.stageDistribution.map((item) => [projectStageLabel(item.stage), String(item.count)])];
                const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map((row) => row.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
                const link = document.createElement('a'); link.href = url; link.download = '班级项目统计.csv'; link.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#1e293b',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              <span>📥</span> 导出报表
            </button>
          </div>
        </div>
      </section>

      {data.signalsAvailable === false && <p role="status">项目统计来自当前名下学生；学习时长、活跃度与关注提醒统计尚未接入，显示为“—”。</p>}
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
          value={data.signalsAvailable === false ? '—' : String(data.totals.sessionsThisWeek)}
          delta={null}
          icon={<SparklesIcon size={22} />}
          tone="#4f46e5"
        />
        <MetricCard
          label="本周学习时长（估算）"
          value={data.signalsAvailable === false ? '—' : `${data.totals.minutesThisWeek}分钟`}
          delta={null}
          icon={<TrendingUpIcon size={22} />}
          tone="#0d9488"
        />
        <MetricCard
          label="本周完成课时"
          value={data.signalsAvailable === false ? '—' : String(data.totals.tasksCompletedThisWeek)}
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
                          {projectStageLabel(item.stage)}
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
              <span className="dot" style={{ background: '#2563eb' }} /> 每周探究活跃趋势
            </div>
            <span style={{ fontSize: '11px', color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px' }}>
              近 7 日活跃人数监控
            </span>
          </div>
          {data.weeklyActivity.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>
              {data.signalsAvailable === false ? '活跃度统计暂未接入' : '暂无活跃数据'}
            </div>
          ) : (
            <>
              <svg viewBox="0 0 560 220" style={{ width: '100%', height: 'auto', display: 'block' }}>
                <defs>
                  <linearGradient id="statArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {[0, 1, 2, 3].map((i) => (
                  <line
                    key={i}
                    x1="20"
                    x2="540"
                    y1={20 + i * 50}
                    y2={20 + i * 50}
                    stroke="#f1f5f9"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                ))}
                {data.weeklyActivity.length > 1 && (
                  <>
                    <path
                      d={`M${data.weeklyActivity
                        .map((w, i) => {
                          const x = 30 + (i * 500) / Math.max(data.weeklyActivity.length - 1, 1);
                          const max = Math.max(...data.weeklyActivity.map((a) => a.activeStudents), 1);
                          const y = 170 - (w.activeStudents / max) * 135;
                          return `${i === 0 ? '' : ' L'}${x},${y}`;
                        })
                        .join('')} L530,175 L30,175 Z`}
                      fill="url(#statArea)"
                    />
                    <path
                      d={`M${data.weeklyActivity
                        .map((w, i) => {
                          const x = 30 + (i * 500) / Math.max(data.weeklyActivity.length - 1, 1);
                          const max = Math.max(...data.weeklyActivity.map((a) => a.activeStudents), 1);
                          const y = 170 - (w.activeStudents / max) * 135;
                          return `${i === 0 ? '' : ' L'}${x},${y}`;
                        })
                        .join('')}`}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {data.weeklyActivity.map((w, i) => {
                      const x = 30 + (i * 500) / Math.max(data.weeklyActivity.length - 1, 1);
                      const max = Math.max(...data.weeklyActivity.map((a) => a.activeStudents), 1);
                      const y = 170 - (w.activeStudents / max) * 135;
                      return (
                        <g key={i}>
                          <circle cx={x} cy={y} r="5" fill="#ffffff" stroke="#2563eb" strokeWidth="2.5" />
                          {w.activeStudents > 0 && (
                            <text x={x} y={y - 10} fill="#2563eb" fontSize="10" fontWeight="700" textAnchor="middle">
                              {w.activeStudents}人
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </>
                )}
                {data.weeklyActivity.map((w, i) => {
                  const x = 30 + (i * 500) / Math.max(data.weeklyActivity.length - 1, 1);
                  return (
                    <text key={i} x={x} y="202" fill="#64748b" fontSize="11" fontWeight="500" textAnchor="middle">
                      {w.weekLabel}
                    </text>
                  );
                })}
              </svg>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 10,
                  fontSize: 12,
                  color: '#64748b',
                  paddingTop: 8,
                  borderTop: '1px solid #f8fafc',
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
                  当前班级活跃探究学生
                </span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  每天 24:00 自动结算当日探究人次
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
          <AttentionStudents students={data.needsAttention} available={data.signalsAvailable !== false} />
        </div>
      </section>
    </div>
  );
}
