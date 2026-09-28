'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminOverviewPageData } from '@qitu/contracts';
import { fetchOverview } from '../../lib/api/overview';
import { AdminStateViews } from '../../lib/components/AdminStateViews';
import { DataSourceBadge } from '../../lib/components/DataSourceBadge';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
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

      {
        /* 治理入口：不再把「个别学生的日常处理」（介入请求、学生详情）放在管理员默认落地页。
           ADR 0008 / 产品文档 7.0 要求管理员默认只进入聚合与治理视图。 */
      }
      <div className="admin-overview-interventions">
        <h2>治理入口</h2>
        <p>
          平台治理默认只呈现聚合数据；个别学生的日常处理由班主任在班主任工作台完成。
          管理员查看个别学生数据需要显式授权（对象级范围 / 原因 / 二次确认 / 审计 / 限时），
          该流程尚未开放：后端已按失败关闭处理，直接请求个别学生详情会返回 403。
        </p>
        <ul>
          <li>
            <Link href="/students/statistics" className="admin-link">
              学生数据统计
            </Link>
          </li>
          <li>
            <Link href="/relationships" className="admin-link">
              家庭与关系绑定
            </Link>
          </li>
          <li>
            <Link href="/settings" className="admin-link">
              模型与 AI 设置
            </Link>
          </li>
        </ul>
      </div>

      <p className="admin-overview-generated">
        数据生成时间：{formatDateTime(data.generatedAt)}
      </p>
    </div>
  );
}
