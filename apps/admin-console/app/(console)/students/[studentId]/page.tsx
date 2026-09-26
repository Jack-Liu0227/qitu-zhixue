'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { AdminStudentDetail, AdminGrowthDigest, AdminInterventionRow, AdminStudentProject } from '@qitu/contracts';
import { Badge, SectionCard, InfoRow, ErrorState } from '@qitu/ui';
import { fetchStudentDetail } from '../../../../lib/api/students';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function ProjectStageLabel({ stage }: { stage: AdminStudentProject['stage'] }) {
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

export default async function AdminStudentDetailPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const searchParams = useSearchParams();
  const backUrl = searchParams?.get('back') ?? '/students';
  const [data, setData] = useState<AdminStudentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const result = await fetchStudentDetail(studentId);
      setData(result);
    } catch (err) {
      if (err instanceof Error && (err as { status?: number }).status === 404) {
        setNotFound(true);
      } else {
        setError(err instanceof Error ? err : new Error('未知错误'));
      }
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (notFound) {
    return (
      <div className="admin-student-detail-page">
        <Link href={backUrl} className="admin-back-link">
          ← 返回列表
        </Link>
        <ErrorState
          title="学生不存在"
          description={`未找到 ID 为 ${studentId} 的学生`}
        />
      </div>
    );
  }

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) {
    return (
      <div className="admin-student-detail-page">
        <Link href={backUrl} className="admin-back-link">
          ← 返回列表
        </Link>
        {stateView}
      </div>
    );
  }

  if (!data) return null;

  const student = data.student;

  return (
    <div className="admin-student-detail-page">
      <Link href={backUrl} className="admin-back-link">
        ← 返回列表
      </Link>

      <div className="admin-detail-header">
        <div>
          <h1>{student.displayName}</h1>
          <p className="admin-detail-meta">
            {student.email} · {student.classLabel ?? '—'}
          </p>
        </div>
        {student.stuck ? <Badge tone="attention">需要关注</Badge> : null}
      </div>

      <div className="admin-detail-grid">
        <SectionCard title="基本信息">
          <InfoRow label="学生ID" value={student.studentId} />
          <InfoRow label="年级" value={student.gradeLabel ?? '—'} />
          <InfoRow label="班级" value={student.classLabel ?? '—'} />
          <InfoRow label="班主任" value={student.mentorName ?? '—'} />
          <InfoRow label="进行中项目" value={`${student.activeProjectCount} 个`} />
          <InfoRow label="已完成项目" value={`${student.projectsCompleted} 个`} />
        </SectionCard>

        <SectionCard title="本周活跃度">
          <InfoRow label="会话次数" value={`${data.sessionsThisWeek} 次`} />
          <InfoRow label="学习时长" value={`${data.minutesThisWeek} 分钟`} />
          <InfoRow label="最近活动" value={formatDateTime(student.lastActivityAt)} />
        </SectionCard>
      </div>

      {data.projects.length > 0 ? (
        <SectionCard title="项目列表">
          <div className="admin-data-table">
            <table>
              <thead>
                <tr>
                  <th>项目</th>
                  <th>阶段</th>
                  <th>进度</th>
                  <th>最近更新</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((project) => (
                  <tr key={project.projectId}>
                    <td>{project.title}</td>
                    <td>
                      <ProjectStageLabel stage={project.stage} />
                    </td>
                    <td>{project.progressPercent}%</td>
                    <td className="admin-cell-time">{formatDateTime(project.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      {data.recentGrowth.length > 0 ? (
        <SectionCard title="最近的成长记录">
          <div className="admin-growth-list">
            {data.recentGrowth.map((growth) => (
              <div key={growth.id} className="admin-growth-item">
                <p className="admin-growth-time">{formatDateTime(growth.occurredAt)}</p>
                <h4 className="admin-growth-title">{growth.title}</h4>
                <p className="admin-growth-summary">{growth.summary}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {data.interventions.length > 0 ? (
        <SectionCard title="介入请求">
          <div className="admin-data-table">
            <table>
              <thead>
                <tr>
                  <th>项目</th>
                  <th>原因</th>
                  <th>状态</th>
                  <th>指派班主任</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {data.interventions.map((intervention) => (
                  <tr key={intervention.id}>
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
        </SectionCard>
      ) : null}
    </div>
  );
}
