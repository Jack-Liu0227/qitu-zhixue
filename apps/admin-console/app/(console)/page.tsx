'use client';
import { ResizablePanels } from '@qitu/ui';

import { RobotMascot } from '@qitu/ui';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminOverviewPageData } from '@qitu/contracts';
import { fetchOverview } from '../../lib/api/overview';
import { AdminStateViews } from '../../lib/components/AdminStateViews';
import { AdminMetricIcon, type AdminMetricIconName } from '../../lib/components/AdminMetricIcon';
import { Card } from '../../lib/components/AdminCard';
import { DataSourceBadge } from '../../lib/components/DataSourceBadge';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

const overviewMetrics: Array<{ label: string; icon: AdminMetricIconName; tone: string; key: keyof AdminOverviewPageData['stats'] }> = [
  { label: '学生总数', icon: 'student', tone: 'blue', key: 'studentCount' },
  { label: '活跃项目', icon: 'project', tone: 'teal', key: 'activeProjectCount' },
  { label: '需要关注学生', icon: 'alert', tone: 'orange', key: 'stuckStudentCount' },
  { label: '班主任数', icon: 'teacher', tone: 'violet', key: 'teacherCount' },
  { label: '待处理介入', icon: 'pending', tone: 'rose', key: 'pendingInterventionCount' },
  { label: '已发布作品', icon: 'work', tone: 'green', key: 'publishedArtifactCount' },
];

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
      <div className="admin-page-header admin-page-header-refresh">
        <div className="admin-page-header-title">
          <RobotMascot size={42} decorative />
          <div>
            <span className="admin-section-eyebrow">PLATFORM OVERVIEW</span>
            <h2>治理概览</h2>
          </div>
          <DataSourceBadge dataSource={data.dataSource} />
        </div>
        <p>平台运行状态总览</p>
      </div>

      <div className="admin-overview-stats">
        {overviewMetrics.map((metric) => (
          <div className={`admin-stat-card admin-stat-card-${metric.tone}`} key={metric.key}>
            <div className="admin-stat-card-topline">
              <span className="admin-stat-icon"><AdminMetricIcon name={metric.icon} /></span>
              <span className="admin-stat-kicker">平台指标</span>
            </div>
            <p className="admin-stat-label">{metric.label}</p>
            <p className="admin-stat-value">{data.stats[metric.key]}</p>
          </div>
        ))}
      </div>

      {
        /* 治理入口：不再把「个别学生的日常处理」（介入请求、学生详情）放在管理员默认落地页。
           ADR 0008 / 产品文档 7.0 要求管理员默认只进入聚合与治理视图。 */
      }
      <section className="admin-overview-interventions admin-governance-refresh" aria-labelledby="admin-governance-title">
        <div className="admin-governance-heading">
          <div>
            <span className="admin-section-eyebrow">GOVERNANCE HUB</span>
            <h2 id="admin-governance-title">治理入口</h2>
          </div>
          <span className="admin-governance-status"><i />聚合视图</span>
        </div>
        <ResizablePanels storageKey="admin-governance-overview" initialSizes={[55, 45]} minWidths={[320, 300]} className="admin-governance-grid" labels={['治理入口', '运行状态']}>
          <Card variant="soft" className="admin-governance-info">
            <div className="admin-governance-watermark"><AdminMetricIcon name="coverage" /></div>
            <div className="admin-governance-info-title"><span className="admin-governance-icon"><AdminMetricIcon name="activity" /></span><div><strong>数据治理及权限说明</strong><small>合规与隐私隔离机制</small></div></div>
            <p>平台治理默认呈现聚合数据。个别学生的日常处理由班主任工作台完成；管理员查看个别学生数据需要显式授权，相关流程当前保持关闭。</p>
            <div className="admin-governance-tags"><span><AdminMetricIcon name="unbound" />最小可见范围</span><span><AdminMetricIcon name="coverage" />审计日志追踪中</span></div>
          </Card>
          <div className="admin-governance-links">
            <Link href="/students/statistics" className="admin-governance-link"><span className="admin-governance-link-icon blue"><AdminMetricIcon name="activity" /></span><span className="admin-governance-link-copy"><strong>学生数据统计</strong><small>查看学习成效与活跃态势</small></span><b>→</b></Link>
            <Link href="/relationships" className="admin-governance-link"><span className="admin-governance-link-icon violet"><AdminMetricIcon name="guardian" /></span><span className="admin-governance-link-copy"><strong>家庭与关系绑定</strong><small>管理家校互通与监护关系</small></span><b>→</b></Link>
            <Link href="/settings" className="admin-governance-link"><span className="admin-governance-link-icon teal"><AdminMetricIcon name="coverage" /></span><span className="admin-governance-link-copy"><strong>模型与 AI 设置</strong><small>调控模型能力与安全防护</small></span><b>→</b></Link>
          </div>
        </ResizablePanels>
      </section>

      <p className="admin-overview-generated">
        数据生成时间：{formatDateTime(data.generatedAt)}
      </p>
    </div>
  );
}
