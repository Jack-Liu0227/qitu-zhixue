'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  ChevronRightIcon,
  SearchIcon,
  SlidersIcon,
  SparklesIcon,
  UsersIcon,
  AlertIcon,
} from '../../../components/icons';
import { MetricCard } from '../../../components/metric-card';
import {
  teacherApi,
  TeacherOfflineError,
  TeacherPermissionError,
  type TeacherRosterPageData,
  type TeacherStudentRow,
} from '../../../lib/teacherApi';
import { useEffect } from 'react';

function ErrorState({ type }: { type: string }) {
  if (type === 'permission') {
    return (
      <div className="qtx-page">
        <div className="qtx-card" style={{ padding: 40, textAlign: 'center' }}>
          <AlertIcon size={48} style={{ color: '#94a3b8', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 18, color: '#1e293b', marginBottom: 8 }}>权限不足</h2>
          <p style={{ color: '#64748b', fontSize: 14 }}>您没有访问学生名册的权限。</p>
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

function StudentDetailPanel({ studentId }: { studentId: string }) {
  const [detail, setDetail] = useState<import('../../../lib/teacherApi').TeacherStudentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    teacherApi
      .studentDetail(studentId)
      .then((response) => {
        if (cancelled) return;
        setDetail(response.data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof TeacherPermissionError) setError('permission');
        else if (err instanceof TeacherOfflineError) setError('offline');
        else setError('generic');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (loading) {
    return (
      <div className="qtx-col-5 qtx-card" style={{ padding: 40, textAlign: 'center' }}>
        <div
          style={{
            width: 40,
            height: 40,
            border: '3px solid #eef2f7',
            borderTopColor: '#2563eb',
            borderRadius: '50%',
            margin: '0 auto 12px',
            animation: 'qitu-spin 1s linear infinite',
          }}
        />
        <p style={{ color: '#94a3b8', fontSize: 13 }}>加载详情...</p>
      </div>
    );
  }

  if (error === 'permission') {
    return (
      <div className="qtx-col-5 qtx-card" style={{ padding: 40, textAlign: 'center' }}>
        <AlertIcon size={40} style={{ color: '#94a3b8', margin: '0 auto 12px' }} />
        <p style={{ color: '#64748b', fontSize: 13 }}>权限不足</p>
      </div>
    );
  }

  if (error === 'offline') {
    return (
      <div className="qtx-col-5 qtx-card" style={{ padding: 40, textAlign: 'center' }}>
        <AlertIcon size={40} style={{ color: '#94a3b8', margin: '0 auto 12px' }} />
        <p style={{ color: '#64748b', fontSize: 13 }}>网络连接失败</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="qtx-col-5 qtx-card" style={{ padding: 40, textAlign: 'center' }}>
        <AlertIcon size={40} style={{ color: '#94a3b8', margin: '0 auto 12px' }} />
        <p style={{ color: '#64748b', fontSize: 13 }}>加载失败</p>
      </div>
    );
  }

  const student = detail.student;
  const stageLabels: Record<string, string> = {
    Inspiration: '灵感探索',
    Research: '深度研究',
    Making: '制作与测试',
    Showcase: '成果展示',
  };

  return (
    <div className="qtx-col-5 qtx-card" style={{ overflow: 'hidden' }}>
      <div
        style={{
          padding: 14,
          background: 'linear-gradient(135deg,#eff6ff,#eef2ff)',
          borderBottom: '1px solid #eef2f7',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            className="qtx-avatar"
            style={{ width: 44, height: 44, borderRadius: 14, fontSize: 17 }}
          >
            {student.avatarInitial}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 15, color: '#1e293b' }}>{student.displayName}</strong>
              {student.gradeLabel && (
                <span className="qtx-badge qtx-badge-blue">{student.gradeLabel}</span>
              )}
              <span
                className={`qtx-badge ${student.stuck ? 'qtx-badge-amber' : 'qtx-badge-emerald'}`}
              >
                <span
                  className="qtx-status-dot"
                  style={{ background: student.stuck ? '#d97706' : '#059669' }}
                />
                {student.stuck ? '需要关注' : '正常'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
          基本信息
        </div>
        <div style={{ display: 'grid', gap: 8, fontSize: 13, color: '#475569' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="qtx-muted">学号</span>
            <strong>{student.studentId}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="qtx-muted">班级</span>
            <strong>{student.classLabel ?? '—'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="qtx-muted">当前项目</span>
            <strong>{student.currentProjectTitle ?? '—'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="qtx-muted">项目阶段</span>
            <strong>
              {student.currentStage ? stageLabels[student.currentStage] ?? student.currentStage : '—'}
            </strong>
          </div>
        </div>

        <div
          style={{
            marginTop: 16,
            fontSize: 12,
            fontWeight: 700,
            color: '#1e293b',
            marginBottom: 8,
          }}
        >
          学习统计
        </div>
        <div style={{ display: 'grid', gap: 8, fontSize: 13, color: '#475569' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="qtx-muted">本周会话</span>
            <strong>{detail.sessionsThisWeek} 次</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="qtx-muted">本周时长</span>
            <strong>{detail.minutesThisWeek} 分钟</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="qtx-muted">活跃天数</span>
            <strong>{student.activeDays} 天</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="qtx-muted">本周任务</span>
            <strong>{student.weeklyTasks} 个</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="qtx-muted">完成项目</span>
            <strong>{student.projectsCompleted} 个</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="qtx-muted">进行中项目</span>
            <strong>{student.activeProjectCount} 个</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="qtx-muted">待处理问题</span>
            <strong>{student.attentionCount} 个</strong>
          </div>
        </div>

        <div
          style={{
            marginTop: 16,
            fontSize: 12,
            fontWeight: 700,
            color: '#1e293b',
            marginBottom: 8,
          }}
        >
          监护人 ({detail.guardians.length})
        </div>
        {detail.guardians.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '8px 0' }}>
            尚无监护人接入
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {detail.guardians.map((g) => (
              <div
                key={g.userId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  color: '#475569',
                }}
              >
                <span>{g.displayName}</span>
                <span className="qtx-muted">
                  {g.relationship === 'mother'
                    ? '母亲'
                    : g.relationship === 'father'
                      ? '父亲'
                      : '监护人'}
                </span>
              </div>
            ))}
          </div>
        )}

        {detail.projects.length > 0 && (
          <>
            <div
              style={{
                marginTop: 16,
                fontSize: 12,
                fontWeight: 700,
                color: '#1e293b',
                marginBottom: 8,
              }}
            >
              项目列表 ({detail.projects.length})
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {detail.projects.slice(0, 3).map((p) => (
                <div
                  key={p.projectId}
                  style={{
                    padding: 10,
                    background: '#f8fafc',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>
                    {p.title}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span className="qtx-muted">{stageLabels[p.stage] ?? p.stage}</span>
                    <span style={{ color: '#2563eb' }}>{p.progressPercent}%</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {detail.interventions.length > 0 && (
          <>
            <div
              style={{
                marginTop: 16,
                fontSize: 12,
                fontWeight: 700,
                color: '#1e293b',
                marginBottom: 8,
              }}
            >
              介入记录 ({detail.interventions.length})
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {detail.interventions.slice(0, 3).map((i) => (
                <div
                  key={i.id}
                  style={{
                    padding: 10,
                    background: '#fef2f2',
                    borderRadius: 8,
                    fontSize: 11,
                    color: '#7f1d1d',
                  }}
                >
                  {i.reason}
                </div>
              ))}
            </div>
          </>
        )}

        {detail.recentGrowth.length > 0 && (
          <>
            <div
              style={{
                marginTop: 16,
                fontSize: 12,
                fontWeight: 700,
                color: '#1e293b',
                marginBottom: 8,
              }}
            >
              近期成长 ({detail.recentGrowth.length})
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {detail.recentGrowth.slice(0, 2).map((g) => (
                <div
                  key={g.id}
                  style={{
                    padding: 10,
                    background: '#f0fdf4',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                >
                  <div style={{ fontWeight: 600, color: '#15803d', marginBottom: 4 }}>
                    {g.title}
                  </div>
                  <div style={{ color: '#166534', lineHeight: 1.5 }}>{g.summary}</div>
                  <div style={{ color: '#86efac', marginTop: 4, fontSize: 10 }}>
                    {new Date(g.occurredAt).toLocaleDateString('zh-CN')}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {student.currentStage && (
          <>
            <div
              style={{
                marginTop: 16,
                fontSize: 12,
                fontWeight: 700,
                color: '#1e293b',
                marginBottom: 8,
              }}
            >
              项目进度
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 8, background: '#eef2f7', borderRadius: 999 }}>
                <div
                  style={{
                    width: `${student.progressPercent}%`,
                    height: 8,
                    background: '#2563eb',
                    borderRadius: 999,
                  }}
                />
              </div>
              <span style={{ fontSize: 12, color: '#64748b', minWidth: 40 }}>
                {student.progressPercent}%
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              仅用于展示，不作为门禁判定依据
            </div>
          </>
        )}

        {/*
          完整档案、家长周报推送与沟通记录目前都没有后端动作，
          用非交互说明代替禁用按钮，避免制造“点了就会发生什么”的错觉。
        */}
        <div className="qtx-note" style={{ marginTop: 16 }}>
          当前支持查看学生名册与学习概览；完整档案、家长周报推送与沟通记录暂未开放。
        </div>
      </div>
    </div>
  );
}

export default function StudentsPage() {
  const searchParams = useSearchParams();
  const requestedStudentId = searchParams.get('studentId');
  const [data, setData] = useState<TeacherRosterPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    teacherApi
      .roster()
      .then((response) => {
        setData(response.data);
        if (response.data.students.length > 0) {
          const requestedStudent = requestedStudentId
            ? response.data.students.find((student) => student.studentId === requestedStudentId)
            : null;
          setSelectedId(requestedStudent?.studentId ?? response.data.students[0]!.studentId);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof TeacherPermissionError) setError('permission');
        else if (err instanceof TeacherOfflineError) setError('offline');
        else setError('generic');
        setLoading(false);
      });
  }, [requestedStudentId]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState type={error} />;
  if (!data) return <ErrorState type="generic" />;

  // 名册接口一次返回全部学生且没有搜索参数，所以搜索在本地过滤（真过滤，非装饰）。
  const trimmedQuery = query.trim().toLowerCase();
  const filteredStudents = trimmedQuery
    ? data.students.filter(
        (s) =>
          s.displayName.toLowerCase().includes(trimmedQuery) ||
          s.studentId.toLowerCase().includes(trimmedQuery),
      )
    : data.students;

  return (
    <div className="qtx-page">
      {/* 页面横幅 */}
      <section className="qtx-banner">
        <div className="qtx-banner-inner">
          <div className="qtx-banner-left">
            <div className="qtx-banner-avatar">
              <div>
                <UsersIcon size={28} />
              </div>
            </div>
            <div>
              <h2>学生管理</h2>
              <p>
                {data.totals.studentCount} 名学生
                {data.totals.stuckCount > 0 ? ` · ${data.totals.stuckCount} 人需要关注` : ''}
                {data.totals.withoutGuardianCount > 0
                  ? ` · ${data.totals.withoutGuardianCount} 人尚无监护人`
                  : ''}
              </p>
            </div>
          </div>
          <div className="qtx-banner-slogan">每个孩子的兴趣主线，都值得被持续看见。</div>
          <div className="qtx-banner-right">
            <div className="qtx-bubble">
              {data.dataSource === 'demo' ? '🧪 演示数据' : '🤖 学生名册已更新～'}
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
          delta={null}
          icon={<UsersIcon size={22} />}
          tone="#2563eb"
        />
        <MetricCard
          label="需要关注"
          value={String(data.totals.stuckCount)}
          delta={null}
          icon={<SparklesIcon size={22} />}
          tone="#d97706"
        />
        <MetricCard
          label="待处理问题"
          value={String(data.totals.attentionCount)}
          delta={null}
          icon={<SlidersIcon size={22} />}
          tone="#4f46e5"
        />
        <MetricCard
          label="尚无监护人"
          value={String(data.totals.withoutGuardianCount)}
          delta={null}
          icon={<AlertIcon size={22} />}
          tone="#0d9488"
        />
      </section>

      {/* 主体：列表 + 详情 */}
      <section className="qtx-grid qtx-grid-12" style={{ alignItems: 'flex-start' }}>
        <div className="qtx-col-7 qtx-card qtx-panel">
          <div className="qtx-panel-header">
            <div className="qtx-panel-title">
              <span className="dot" /> 学生列表
            </div>
            {/*
              邀请学生属于管理后台的账号能力，班主任端没有该写接口；
              不摆放禁用按钮，改成一句非交互说明。
            */}
            <span className="qtx-panel-hint">学生账号由管理后台统一创建</span>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <SearchIcon
                size={15}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#94a3b8',
                }}
              />
              <input
                className="qtx-input"
                style={{ paddingLeft: 36 }}
                placeholder="搜索学生姓名或 ID"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <button
              className="qtx-btn"
              type="button"
              disabled={trimmedQuery.length === 0}
              onClick={() => setQuery('')}
              title={trimmedQuery ? '清除搜索条件' : '当前无可筛选的维度'}
            >
              <SlidersIcon size={15} /> {trimmedQuery ? '清除搜索' : '筛选'}
            </button>
          </div>

          {data.students.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>
              暂无学生数据
            </div>
          ) : filteredStudents.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>
              没有匹配「{query.trim()}」的学生
            </div>
          ) : (
            <>
              <div className="qtx-table-wrap">
                <table className="qtx-table">
                  <thead>
                    <tr>
                      <th>学生</th>
                      <th>当前项目</th>
                      <th>本周任务</th>
                      <th>状态</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((s) => (
                      <tr
                        key={s.studentId}
                        className={s.studentId === selectedId ? 'selected' : ''}
                        onClick={() => setSelectedId(s.studentId)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span
                              className="qtx-avatar"
                              style={{ width: 34, height: 34, borderRadius: 10, fontSize: 13 }}
                            >
                              {s.avatarInitial}
                            </span>
                            <div>
                              <strong style={{ color: '#1e293b' }}>{s.displayName}</strong>
                              <div className="qtx-small qtx-muted">
                                {s.gradeLabel ?? '—'}
                                {s.classLabel ? ` · ${s.classLabel}` : ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>{s.currentProjectTitle ?? '—'}</td>
                        <td>{s.weeklyTasks} 个</td>
                        <td>
                          <span
                            className={`qtx-badge ${s.stuck ? 'qtx-badge-amber' : 'qtx-badge-emerald'}`}
                          >
                            <span
                              className="qtx-status-dot"
                              style={{ background: s.stuck ? '#d97706' : '#059669' }}
                            />
                            {s.stuck ? '需要关注' : '正常'}
                          </span>
                        </td>
                        <td>
                          <ChevronRightIcon size={16} style={{ color: '#cbd5e1' }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="qtx-pagination">
                {/*
                  名册接口不分页（TeacherRosterPageData 一次性返回全部学生），
                  所以不再摆一组点了没反应的翻页箭头，只保留真实的总数。
                */}
                <span>共 {data.totals.studentCount} 名学生，已全部展示</span>
              </div>
            </>
          )}
        </div>

        {selectedId && <StudentDetailPanel studentId={selectedId} />}
      </section>
    </div>
  );
}
