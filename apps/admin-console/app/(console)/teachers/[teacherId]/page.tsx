'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { AdminTeacherDetail, AdminInterventionRow } from '@qitu/contracts';
import { Badge, SectionCard, InfoRow, ErrorState } from '@qitu/ui';
import { fetchTeacherDetail } from '../../../../lib/api/teachers';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

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

export default async function AdminTeacherDetailPage({ params }: { params: Promise<{ teacherId: string }> }) {
  const { teacherId } = await params;
  const searchParams = useSearchParams();
  const backUrl = searchParams?.get('back') ?? '/teachers';
  const [data, setData] = useState<AdminTeacherDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const result = await fetchTeacherDetail(teacherId);
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
  }, [teacherId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (notFound) {
    return (
      <div className="admin-teacher-detail-page">
        <Link href={backUrl} className="admin-back-link">
          ← 返回列表
        </Link>
        <ErrorState
          title="班主任不存在"
          description={`未找到 ID 为 ${teacherId} 的班主任`}
        />
      </div>
    );
  }

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) {
    return (
      <div className="admin-teacher-detail-page">
        <Link href={backUrl} className="admin-back-link">
          ← 返回列表
        </Link>
        {stateView}
      </div>
    );
  }

  if (!data) return null;

  const teacher = data.teacher;

  return (
    <div className="admin-teacher-detail-page">
      <Link href={backUrl} className="admin-back-link">
        ← 返回列表
      </Link>

      <div className="admin-detail-header">
        <div>
          <h1>{teacher.displayName}</h1>
          <p className="admin-detail-meta">
            {teacher.email} · {teacher.classLabels.join(', ') || '—'}
          </p>
        </div>
      </div>

      <div className="admin-detail-grid">
        <SectionCard title="基本信息">
          <InfoRow label="教师ID" value={teacher.teacherId} />
          <InfoRow label="负责学生数" value={`${teacher.studentCount} 人`} />
          <InfoRow label="负责班级" value={teacher.classLabels.join(', ') || '—'} />
          <InfoRow label="最近活动" value={formatDateTime(teacher.lastActivityAt)} />
        </SectionCard>

        <SectionCard title="工作统计">
          <InfoRow label="待处理介入" value={`${teacher.pendingInterventionCount} 个`} />
          <InfoRow label="本周已处理" value={`${teacher.resolvedThisWeek} 个`} />
          <InfoRow label="需要关注的学生" value={`${teacher.stuckStudentCount} 人`} />
        </SectionCard>
      </div>

      {data.students.length > 0 ? (
        <SectionCard title="负责的学生">
          <div className="admin-data-table">
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>班级</th>
                  <th>进行中项目</th>
                  <th>当前项目</th>
                  <th>进度</th>
                  <th>最近活动</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {data.students.map((student) => (
                  <tr key={student.studentId}>
                    <td>
                      {/* 个别学生详情需显式授权（ADR 0008），后端当前 fail closed；
                          这里不再渲染入口。 */}
                      {student.displayName}
                    </td>
                    <td>{student.classLabel ?? '—'}</td>
                    <td className="admin-cell-center">{student.activeProjectCount}</td>
                    <td>{student.currentProjectTitle ?? '—'}</td>
                    <td className="admin-cell-center">{student.progressPercent}%</td>
                    <td className="admin-cell-time">{formatDateTime(student.lastActivityAt)}</td>
                    <td>
                      {student.stuck ? (
                        <Badge tone="attention">需要关注</Badge>
                      ) : student.attentionCount > 0 ? (
                        <Badge tone="primary">{student.attentionCount} 个待处理</Badge>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      {data.interventions.length > 0 ? (
        <SectionCard title="介入请求">
          <div className="admin-data-table">
            <table>
              <thead>
                <tr>
                  <th>学生</th>
                  <th>项目</th>
                  <th>原因</th>
                  <th>状态</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {data.interventions.map((intervention) => (
                  <tr key={intervention.id}>
                    <td>
                      {/* 同上：个别学生详情需显式授权，暂不提供入口。 */}
                      {intervention.studentDisplayName}
                    </td>
                    <td>{intervention.projectTitle ?? '—'}</td>
                    <td>{intervention.reason}</td>
                    <td>
                      <InterventionStatusBadge status={intervention.status} />
                    </td>
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
