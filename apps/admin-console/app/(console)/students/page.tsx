'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import type { AdminStudentFilter, AdminStudentListPageData, AdminStudentRow } from '@qitu/contracts';
import { Badge, Button, EmptyState } from '@qitu/ui';
import { fetchStudentList } from '../../../lib/api/students';
import { AdminStateViews } from '../../../lib/components/AdminStateViews';
import { DataSourceBadge } from '../../../lib/components/DataSourceBadge';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function ProjectStageLabel({ stage }: { stage: AdminStudentRow['currentStage'] }) {
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

export default function AdminStudentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<AdminStudentListPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const currentFilter = (searchParams?.get('filter') as AdminStudentFilter) ?? 'all';
  const currentClass = searchParams?.get('class') ?? '';
  const currentMentor = searchParams?.get('mentor') ?? '';
  const currentSearch = searchParams?.get('search') ?? '';
  const currentCursor = searchParams?.get('cursor') ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchStudentList({
        filter: currentFilter,
        classLabel: currentClass || null,
        mentorId: currentMentor || null,
        search: currentSearch || null,
        cursor: currentCursor || null,
        limit: 20,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('未知错误'));
    } finally {
      setLoading(false);
    }
  }, [currentFilter, currentClass, currentMentor, currentSearch, currentCursor]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams();
    const merged = {
      filter: currentFilter,
      class: currentClass,
      mentor: currentMentor,
      search: currentSearch,
      ...updates,
    };

    if (merged.filter && merged.filter !== 'all') params.set('filter', merged.filter);
    if (merged.class) params.set('class', merged.class);
    if (merged.mentor) params.set('mentor', merged.mentor);
    if (merged.search) params.set('search', merged.search);

    const query = params.toString();
    router.push(query ? `/students?${query}` : '/students');
  }

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) return <div className="admin-students-page">{stateView}</div>;

  if (!data) return null;

  return (
    <div className="admin-students-page">
      <div className="admin-page-header">
        <div className="admin-page-header-title">
          <h1>学生端数据</h1>
          <DataSourceBadge dataSource={data.dataSource} />
        </div>
        <p>查看所有学生的学习状态与项目进展</p>
        <p className="admin-page-header-action">
          <Link href="/students/statistics" className="admin-link">
            查看学生数据统计 →
          </Link>
        </p>
      </div>

      <div className="admin-filter-strip">
        <button
          className={currentFilter === 'all' ? 'admin-filter-btn active' : 'admin-filter-btn'}
          onClick={() => updateQuery({ filter: 'all', cursor: null })}
        >
          全部 <span className="admin-filter-count">{data.totals.all}</span>
        </button>
        <button
          className={currentFilter === 'active' ? 'admin-filter-btn active' : 'admin-filter-btn'}
          onClick={() => updateQuery({ filter: 'active', cursor: null })}
        >
          进行中 <span className="admin-filter-count">{data.totals.active}</span>
        </button>
        <button
          className={currentFilter === 'stuck' ? 'admin-filter-btn active' : 'admin-filter-btn'}
          onClick={() => updateQuery({ filter: 'stuck', cursor: null })}
        >
          需要关注 <span className="admin-filter-count">{data.totals.stuck}</span>
        </button>
        <button
          className={currentFilter === 'no_project' ? 'admin-filter-btn active' : 'admin-filter-btn'}
          onClick={() => updateQuery({ filter: 'no_project', cursor: null })}
        >
          暂无项目 <span className="admin-filter-count">{data.totals.noProject}</span>
        </button>
      </div>

      <div className="admin-filter-controls">
        <select
          value={currentClass}
          onChange={(e) => updateQuery({ class: e.target.value || null, cursor: null })}
        >
          <option value="">全部班级</option>
          {data.classOptions.map((cls) => (
            <option key={cls} value={cls}>
              {cls}
            </option>
          ))}
        </select>

        <select
          value={currentMentor}
          onChange={(e) => updateQuery({ mentor: e.target.value || null, cursor: null })}
        >
          <option value="">全部班主任</option>
          {data.mentors.map((mentor) => (
            <option key={mentor.mentorId} value={mentor.mentorId}>
              {mentor.displayName}
            </option>
          ))}
        </select>

        <input
          type="search"
          placeholder="搜索姓名或邮箱"
          value={currentSearch}
          onChange={(e) => updateQuery({ search: e.target.value || null, cursor: null })}
        />
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          title="没有找到学生"
          description="当前筛选条件下没有学生数据"
        />
      ) : (
        <>
          <div className="admin-data-table">
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>班级</th>
                  <th>班主任</th>
                  <th>进行中项目</th>
                  <th>当前项目</th>
                  <th>阶段</th>
                  <th>进度</th>
                  <th>最近活动</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((student) => (
                  <tr key={student.studentId}>
                    <td>
                      <Link
                        href={`/students/${student.studentId}?back=${encodeURIComponent(
                          window.location.pathname + window.location.search,
                        )}`}
                        className="admin-link"
                      >
                        {student.displayName}
                      </Link>
                    </td>
                    <td>{student.classLabel ?? '—'}</td>
                    <td>{student.mentorName ?? '—'}</td>
                    <td className="admin-cell-center">{student.activeProjectCount}</td>
                    <td>{student.currentProjectTitle ?? '—'}</td>
                    <td>
                      <ProjectStageLabel stage={student.currentStage} />
                    </td>
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

          {data.hasNext ? (
            <div className="admin-pagination">
              <Button
                onClick={() => updateQuery({ cursor: data.nextCursor })}
              >
                加载更多
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
