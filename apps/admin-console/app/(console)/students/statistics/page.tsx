'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  AdminStudentStatsPageData,
  AdminStudentStatsRange,
  AdminStudentStatsRow,
  ProjectStage,
} from '@qitu/contracts';
import { Badge, Button, EmptyState } from '@qitu/ui';
import { fetchStudentStatistics } from '../../../../lib/api/statistics';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { AdminMetricIcon } from '../../../../lib/components/AdminMetricIcon';
import { Card } from '../../../../lib/components/AdminCard';
import { DataSourceBadge } from '../../../../lib/components/DataSourceBadge';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ProjectStageLabel({ stage }: { stage: ProjectStage | null }) {
  if (!stage) return <>—</>;
  const labels: Record<string, string> = {
    IntentConfirmed: '意图确认',
    TheoryLearning: '理论学习',
    TheoryMastered: '理论掌握',
    Practice: '实践中',
    WorkCreated: '作品创作',
    ReviewPending: '待评审',
    Completed: '已完成',
    Published: '已发布',
  };
  return <>{labels[stage] ?? stage}</>;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`;
}

export default function AdminStudentStatisticsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<AdminStudentStatsPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const currentRange = (searchParams?.get('range') as AdminStudentStatsRange) ?? '7d';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchStudentStatistics(currentRange);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('未知错误'));
    } finally {
      setLoading(false);
    }
  }, [currentRange]);

  useEffect(() => {
    void load();
  }, [load]);

  function changeRange(range: AdminStudentStatsRange) {
    router.push(`/students/statistics?range=${range}`);
  }

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) return <div className="admin-statistics-page">{stateView}</div>;

  if (!data) return null;

  const unboundRows = data.rows.filter((row) => !row.hasMentor || !row.hasGuardian);

  return (
    <div className="admin-statistics-page">
      <Card variant="soft" className="admin-hero-banner admin-stats-hero">
        <div className="admin-hero-copy">
          <div className="admin-hero-badges"><span className="admin-live-badge"><i />AI 智学领航管家</span><span className="admin-hero-note">数据治理节点实时巡检守护中</span></div>
          <h1>你好，管理员！<em>学情数据</em> 正在持续汇聚</h1>
          <p>从学习活跃度、项目阶段到家校绑定，用一张清晰的数据全景图支持日常治理。</p>
          <div className="admin-hero-signals"><span><AdminMetricIcon name="activity" />学习态势实时同步</span><span><AdminMetricIcon name="coverage" />数据权限隔离运行</span></div>
        </div>
        <div className="admin-hero-mascot"><span className="admin-hero-bubble">每一次专注学习，都是智慧萌芽</span><img src="/admin/frontend_pictures/3d14d7e2-1727-48f6-b3a4-42e4fe49ce77.png" alt="AI 教育机器人助手" /></div>
      </Card>

      <div className="admin-page-header admin-statistics-heading">
        <div className="admin-page-header-title">
          <div><span className="admin-section-eyebrow">LEARNING INSIGHTS</span><h1>学生数据统计</h1></div>
          <DataSourceBadge dataSource={data.dataSource} />
        </div>
        <p>查看学生学习活跃度、阶段分布和绑定覆盖情况</p>
      </div>

      <div className="admin-range-selector">
        <span className="admin-range-label"><AdminMetricIcon name="time" />统计周期</span>
        <button
          className={currentRange === '7d' ? 'admin-range-btn active' : 'admin-range-btn'}
          onClick={() => changeRange('7d')}
        >
          近7天
        </button>
        <button
          className={currentRange === '30d' ? 'admin-range-btn active' : 'admin-range-btn'}
          onClick={() => changeRange('30d')}
        >
          近30天
        </button>
        <button
          className={currentRange === 'all' ? 'admin-range-btn active' : 'admin-range-btn'}
          onClick={() => changeRange('all')}
        >
          全部时间
        </button>
      </div>

      <div className="admin-stats-grid admin-stats-grid-primary">
        <div className="admin-stat-card admin-stat-card-blue"><div className="admin-stat-card-topline"><span className="admin-stat-icon"><AdminMetricIcon name="student" /></span><span className="admin-stat-kicker">人群规模</span></div><span className="admin-stat-label">学生总数</span><span className="admin-stat-value">{data.totals.studentCount}</span></div>
        <div className="admin-stat-card admin-stat-card-teal"><div className="admin-stat-card-topline"><span className="admin-stat-icon"><AdminMetricIcon name="activity" /></span><span className="admin-stat-kicker">学习参与</span></div><span className="admin-stat-label">活跃学生</span><span className="admin-stat-value">{data.totals.activeStudentCount}</span><span className="admin-stat-sub">{data.totals.studentCount > 0 ? Math.round((data.totals.activeStudentCount / data.totals.studentCount) * 100) : 0}% 活跃率</span></div>
        <div className="admin-stat-card admin-stat-card-violet"><div className="admin-stat-card-topline"><span className="admin-stat-icon"><AdminMetricIcon name="session" /></span><span className="admin-stat-kicker">过程记录</span></div><span className="admin-stat-label">学习会话</span><span className="admin-stat-value">{data.totals.sessions}</span></div>
        <div className="admin-stat-card admin-stat-card-orange"><div className="admin-stat-card-topline"><span className="admin-stat-icon"><AdminMetricIcon name="time" /></span><span className="admin-stat-kicker">投入时间</span></div><span className="admin-stat-label">学习时长</span><span className="admin-stat-value">{formatMinutes(data.totals.minutes)}</span></div>
        <div className="admin-stat-card admin-stat-card-green"><div className="admin-stat-card-topline"><span className="admin-stat-icon"><AdminMetricIcon name="task" /></span><span className="admin-stat-kicker">学习产出</span></div><span className="admin-stat-label">完成任务数</span><span className="admin-stat-value">{data.totals.tasksCompleted}</span></div>
      </div>

      <div className="admin-stats-grid admin-stats-grid-coverage">
        <div className="admin-stat-card admin-stat-highlight admin-stat-card-blue"><div className="admin-stat-card-topline"><span className="admin-stat-icon"><AdminMetricIcon name="coverage" /></span><span className="admin-stat-kicker">关系治理</span></div><span className="admin-stat-label">班主任覆盖率</span><span className="admin-stat-value">{data.totals.mentorCoveredPercent}%</span><span className="admin-stat-sub">{data.totals.studentCount - Math.round((data.totals.mentorCoveredPercent / 100) * data.totals.studentCount)} 名学生待分配</span></div>
        <div className="admin-stat-card admin-stat-highlight admin-stat-card-teal"><div className="admin-stat-card-topline"><span className="admin-stat-icon"><AdminMetricIcon name="guardian" /></span><span className="admin-stat-kicker">家庭治理</span></div><span className="admin-stat-label">家长覆盖率</span><span className="admin-stat-value">{data.totals.guardianCoveredPercent}%</span><span className="admin-stat-sub">{data.totals.studentCount - Math.round((data.totals.guardianCoveredPercent / 100) * data.totals.studentCount)} 名学生待绑定</span></div>
        <div className="admin-stat-card admin-stat-alert admin-stat-card-rose"><div className="admin-stat-card-topline"><span className="admin-stat-icon"><AdminMetricIcon name="unbound" /></span><span className="admin-stat-kicker">待处理事项</span></div><span className="admin-stat-label">完全未绑定</span><span className="admin-stat-value">{data.totals.unboundStudentCount}</span><span className="admin-stat-sub">既无班主任也无家长</span></div>
      </div>

      {unboundRows.length > 0 && (
        <div className="admin-alert-card">
          <h3>待完成绑定的学生</h3>
          <p>以下学生缺少班主任或家长绑定，请前往关系绑定页面处理：</p>
          <div className="admin-data-table admin-table-compact">
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>班级</th>
                  <th>绑定状态</th>
                  <th>活跃度</th>
                </tr>
              </thead>
              <tbody>
                {unboundRows.map((row) => (
                  <tr key={row.studentId}>
                    <td>{row.displayName}</td>
                    <td>{row.classLabel ?? '—'}</td>
                    <td>
                      {!row.hasMentor && <Badge tone="attention">无班主任</Badge>}
                      {!row.hasGuardian && <Badge tone="attention">无家长</Badge>}
                    </td>
                    <td>
                      {row.activeDays > 0 ? `${row.activeDays}天` : '未活跃'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.stageDistribution.length > 0 && (
        <div className="admin-chart-section">
          <h3>项目阶段分布</h3>
          <div className="admin-stage-bars">
            {data.stageDistribution.map((bucket) => {
              const maxCount = Math.max(...data.stageDistribution.map((b) => b.count));
              const widthPercent = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0;
              return (
                <div key={bucket.stage} className="admin-stage-bar-row">
                  <span className="admin-stage-label">
                    <ProjectStageLabel stage={bucket.stage} />
                  </span>
                  <div className="admin-stage-bar-track">
                    <div
                      className="admin-stage-bar-fill"
                      style={{ width: `${widthPercent}%` }}
                    />
                  </div>
                  <span className="admin-stage-count">{bucket.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.activity.length > 0 && (
        <div className="admin-chart-section">
          <h3>活跃度趋势</h3>
          <div className="admin-activity-chart">
            {data.activity.map((bucket) => {
              const maxStudents = Math.max(...data.activity.map((b) => b.activeStudents));
              const heightPercent = maxStudents > 0 ? (bucket.activeStudents / maxStudents) * 100 : 0;
              return (
                <div key={bucket.date} className="admin-activity-bar">
                  <div className="admin-activity-bar-track">
                    <div
                      className="admin-activity-bar-fill"
                      style={{ height: `${heightPercent}%` }}
                      title={`${bucket.activeStudents} 名学生活跃`}
                    />
                  </div>
                  <span className="admin-activity-date">{bucket.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="admin-data-section">
        <h3>学生明细</h3>
        {data.rows.length === 0 ? (
          <EmptyState title="暂无数据" description="当前时间范围内没有学生数据" />
        ) : (
          <div className="admin-data-table">
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>班级</th>
                  <th>活跃天数</th>
                  <th>本周会话</th>
                  <th>本周时长</th>
                  <th>完成任务</th>
                  <th>当前项目</th>
                  <th>阶段</th>
                  <th>最近活动</th>
                  <th>绑定状态</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.studentId} className={!row.hasMentor || !row.hasGuardian ? 'admin-row-alert' : ''}>
                    <td>{row.displayName}</td>
                    <td>{row.classLabel ?? '—'}</td>
                    <td className="admin-cell-center">{row.activeDays}</td>
                    <td className="admin-cell-center">{row.sessionsThisWeek}</td>
                    <td className="admin-cell-center">{formatMinutes(row.minutesThisWeek)}</td>
                    <td className="admin-cell-center">{row.tasksCompleted}</td>
                    <td>{row.currentProjectTitle ?? '—'}</td>
                    <td>
                      <ProjectStageLabel stage={row.currentStage} />
                    </td>
                    <td className="admin-cell-time">{formatDateTime(row.lastActivityAt)}</td>
                    <td>
                      {row.hasMentor && row.hasGuardian ? (
                        <Badge tone="completed">完整</Badge>
                      ) : (
                        <>
                          {!row.hasMentor && <Badge tone="attention">无班主任</Badge>}
                          {!row.hasGuardian && <Badge tone="attention">无家长</Badge>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="admin-metadata">
        <p className="admin-generated-at">
          数据生成时间：{formatDateTime(data.generatedAt)}
        </p>
      </div>
    </div>
  );
}
