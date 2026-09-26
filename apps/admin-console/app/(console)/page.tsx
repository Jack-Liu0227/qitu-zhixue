'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminOverviewPageData, AdminInterventionRow } from '@qitu/contracts';
import { Badge } from '@qitu/ui';
import { fetchOverview } from '../../lib/api/overview';
import { AdminStateViews } from '../../lib/components/AdminStateViews';
import { DataSourceBadge } from '../../lib/components/DataSourceBadge';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function InterventionStatusBadge({ status }: { status: AdminInterventionRow['status'] }) {
  switch (status) {
    case 'open':
      return <Badge tone="attention">待处理</Badge>;
    case 'acknowledged':
      return <Badge tone="primary">已接收</Badge>;
    case 'resolved':
      return <Badge tone="completed">已解决</Badge>;
    default:
      return <Badge tone="neutral">{status}</Badge>;
  }
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<AdminOverviewPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchOverview();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('未知错误'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) return <div className="admin-overview-page">{stateView}</div>;

  if (!data) return null;

  return (
    <div className="admin-overview-page">
      <div className="admin-page-header">
        <div className="admin-page-header-title">
          <h1>概览</h1>
          <DataSourceBadge dataSource={data.dataSource} />
        </div>
        <p>平台运行状态总览</p>
      </div>

      <div className="admin-overview-stats">
        <div className="admin-stat-card">
          <p className="admin-stat-label">学生总数</p>
          <p className="admin-stat-value">{data.stats.studentCount}</p>
        </div>
        <div className="admin-stat-card">
          <p className="admin-stat-label">活跃项目</p>
          <p className="admin-stat-value">{data.stats.activeProjectCount}</p>
        </div>
        <div className="admin-stat-card">
          <p className="admin-stat-label">需要关注学生</p>
          <p className="admin-stat-value">{data.stats.stuckStudentCount}</p>
        </div>
        <div className="admin-stat-card">
          <p className="admin-stat-label">班主任数</p>
          <p className="admin-stat-value">{data.stats.teacherCount}</p>
        </div>
        <div className="admin-stat-card">
          <p className="admin-stat-label">待处理介入</p>
          <p className="admin-stat-value">{data.stats.pendingInterventionCount}</p>
        </div>
        <div className="admin-stat-card">
          <p className="admin-stat-label">已发布作品</p>
          <p className="admin-stat-value">{data.stats.publishedArtifactCount}</p>
        </div>
      </div>

      {data.recentInterventions.length > 0 ? (
        <div className="admin-overview-interventions">
          <h2>最近的介入请求</h2>
          <div className="admin-data-table">
            <table>
              <thead>
                <tr>
                  <th>学生</th>
                  <th>项目</th>
                  <th>原因</th>
                  <th>状态</th>
                  <th>指派班主任</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {data.recentInterventions.map((intervention) => (
                  <tr key={intervention.id}>
                    <td>
                      <Link
                        href={`/students/${intervention.studentId}`}
                        className="admin-link"
                      >
                        {intervention.studentDisplayName}
                      </Link>
                    </td>
                    <td>{intervention.projectTitle ?? '—'}</td>
                    <td>{intervention.reason}</td>
                    <td>
                      <InterventionStatusBadge status={intervention.status} />
                    </td>
                    <td>{intervention.assigneeName ?? '—'}</td>
                    <td className="admin-cell-time">{formatDateTime(intervention.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <p className="admin-overview-generated">
        数据生成时间：{formatDateTime(data.generatedAt)}
      </p>
    </div>
  );
}
