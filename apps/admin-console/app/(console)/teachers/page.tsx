'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import type { AdminTeacherListPageData } from '@qitu/contracts';
import { Badge, Button, EmptyState } from '@qitu/ui';
import { fetchTeacherList } from '../../../lib/api/teachers';
import { AdminStateViews } from '../../../lib/components/AdminStateViews';
import { DataSourceBadge } from '../../../lib/components/DataSourceBadge';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AdminTeachersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<AdminTeacherListPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const currentFilter = searchParams?.get('filter') ?? 'all';
  const currentSearch = searchParams?.get('search') ?? '';
  const currentCursor = searchParams?.get('cursor') ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTeacherList({
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
  }, [currentSearch, currentCursor]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateQuery(updates: Record<string, string | null>) {
    const params = new URLSearchParams();
    const merged = {
      filter: currentFilter,
      search: currentSearch,
      ...updates,
    };

    if (merged.filter && merged.filter !== 'all') params.set('filter', merged.filter);
    if (merged.search) params.set('search', merged.search);

    const query = params.toString();
    router.push(query ? `/teachers?${query}` : '/teachers');
  }

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) return <div className="admin-teachers-page">{stateView}</div>;

  if (!data) return null;

  // Apply client-side filter for the summary strip
  const displayItems = currentFilter === 'pending'
    ? data.items.filter(t => t.pendingInterventionCount > 0)
    : currentFilter === 'idle'
    ? data.items.filter(t => !t.lastActivityAt || Date.now() - new Date(t.lastActivityAt).getTime() > 7 * 24 * 60 * 60 * 1000)
    : data.items;

  return (
    <div className="admin-teachers-page">
      <div className="admin-page-header">
        <div className="admin-page-header-title">
          <h1>教师端数据</h1>
          <DataSourceBadge dataSource={data.dataSource} />
        </div>
        <p>查看所有班主任的工作状态与学生管理情况</p>
      </div>

      <div className="admin-filter-strip">
        <button
          className={currentFilter === 'all' ? 'admin-filter-btn active' : 'admin-filter-btn'}
          onClick={() => updateQuery({ filter: 'all', cursor: null })}
        >
          全部 <span className="admin-filter-count">{data.totals.all}</span>
        </button>
        <button
          className={currentFilter === 'pending' ? 'admin-filter-btn active' : 'admin-filter-btn'}
          onClick={() => updateQuery({ filter: 'pending', cursor: null })}
        >
          有待处理介入 <span className="admin-filter-count">{data.totals.withPendingIntervention}</span>
        </button>
        <button
          className={currentFilter === 'idle' ? 'admin-filter-btn active' : 'admin-filter-btn'}
          onClick={() => updateQuery({ filter: 'idle', cursor: null })}
        >
          长期未活跃 <span className="admin-filter-count">{data.totals.idle}</span>
        </button>
      </div>

      <div className="admin-filter-controls">
        <input
          type="search"
          placeholder="搜索姓名或邮箱"
          value={currentSearch}
          onChange={(e) => updateQuery({ search: e.target.value || null, cursor: null })}
        />
      </div>

      {displayItems.length === 0 ? (
        <EmptyState
          title="没有找到班主任"
          description="当前筛选条件下没有班主任数据"
        />
      ) : (
        <>
          <div className="admin-data-table">
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>邮箱</th>
                  <th>负责学生数</th>
                  <th>班级</th>
                  <th>待处理介入</th>
                  <th>本周已处理</th>
                  <th>需要关注的学生</th>
                  <th>最近活动</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.map((teacher) => (
                  <tr key={teacher.teacherId}>
                    <td>
                      <Link
                        href={`/teachers/${teacher.teacherId}?back=${encodeURIComponent(
                          window.location.pathname + window.location.search,
                        )}`}
                        className="admin-link"
                      >
                        {teacher.displayName}
                      </Link>
                    </td>
                    <td>{teacher.email}</td>
                    <td className="admin-cell-center">{teacher.studentCount}</td>
                    <td>{teacher.classLabels.join(', ') || '—'}</td>
                    <td className="admin-cell-center">
                      {teacher.pendingInterventionCount > 0 ? (
                        <Badge tone="attention">{teacher.pendingInterventionCount}</Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="admin-cell-center">{teacher.resolvedThisWeek}</td>
                    <td className="admin-cell-center">
                      {teacher.stuckStudentCount > 0 ? (
                        <Badge tone="attention">{teacher.stuckStudentCount}</Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="admin-cell-time">{formatDateTime(teacher.lastActivityAt)}</td>
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
