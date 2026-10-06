'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  GuardianLinkListPageData,
  MentorAssignmentListPageData,
  GuardianLinkRow,
  MentorAssignmentRow,
  GuardianRelationship,
  DirectoryPersonRef,
} from '@qitu/contracts';
import { Badge, Button, EmptyState } from '@qitu/ui';
import {
  fetchGuardianLinks,
  createGuardianLink,
  endGuardianLink,
  fetchMentorAssignments,
  createMentorAssignment,
  endMentorAssignment,
  transferMentor,
} from '../../../lib/api/relationships';
import { AdminStateViews } from '../../../lib/components/AdminStateViews';
import { Card } from '../../../lib/components/AdminCard';
import { DataSourceBadge } from '../../../lib/components/DataSourceBadge';
import type { ErrorEnvelope } from '../../../lib/api/types';

type TabId = 'guardians' | 'mentors';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ title, message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="admin-dialog-backdrop" onClick={onCancel}>
      <div className="admin-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="admin-dialog-actions">
          <Button onClick={onCancel} variant="secondary">
            取消
          </Button>
          <Button onClick={onConfirm} variant="primary">
            确认
          </Button>
        </div>
      </div>
    </div>
  );
}

interface GuardianFormData {
  parentUserId: string;
  studentUserId: string;
  relationship: GuardianRelationship;
}

interface MentorFormData {
  studentUserId: string;
  mentorUserId: string;
}

function GuardianPanel({
  data,
  onReload,
}: {
  data: GuardianLinkListPageData;
  onReload: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<GuardianFormData>({
    parentUserId: '',
    studentUserId: '',
    relationship: 'mother',
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!formData.parentUserId || !formData.studentUserId) {
      setErrorMessage('请选择家长和学生');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      await createGuardianLink(formData, generateIdempotencyKey());
      setShowForm(false);
      setFormData({ parentUserId: '', studentUserId: '', relationship: 'mother' });
      onReload();
    } catch (error) {
      const err = error as { response?: { data?: ErrorEnvelope } };
      const code = err.response?.data?.error?.code;

      if (code === 'GUARDIAN_LINK_ALREADY_ACTIVE') {
        setErrorMessage('该家长与学生已有有效的监护关系');
      } else if (code === 'DIRECTORY_USER_NOT_FOUND') {
        setErrorMessage('选择的用户不存在');
      } else if (code === 'RELATIONSHIP_ROLE_INVALID') {
        setErrorMessage('角色不匹配：请确认选择了家长和学生账号');
      } else if (code === 'SELF_RELATIONSHIP_INVALID') {
        setErrorMessage('无法将同一用户设置为监护关系');
      } else {
        setErrorMessage(error instanceof Error ? error.message : '创建失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnd = async (linkId: string) => {
    setSubmitting(true);
    setErrorMessage(null);

    try {
      await endGuardianLink(linkId, { reason: '管理后台手动结束' }, generateIdempotencyKey());
      setConfirmEnd(null);
      onReload();
    } catch (error) {
      const err = error as { response?: { data?: ErrorEnvelope } };
      const code = err.response?.data?.error?.code;

      if (code === 'GUARDIAN_LINK_ENDED') {
        setErrorMessage('该监护关系已结束');
      } else {
        setErrorMessage(error instanceof Error ? error.message : '结束失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const activeLinks = data.items.filter((link) => link.status === 'active');
  const endedLinks = data.items.filter((link) => link.status === 'ended');

  return (
    <div className="admin-relationship-panel">
      <div className="admin-panel-header">
        <div>
          <h3>家长 ↔ 学生监护关系</h3>
          <p className="admin-panel-description">
            管理监护人绑定，确保家长能查看对应孩子的学习进展
          </p>
        </div>
        <Button onClick={() => setShowForm(true)} disabled={submitting}>
          添加监护关系
        </Button>
      </div>

      <div className="admin-panel-stats">
        <div className="admin-stat-item">
          <span className="admin-stat-label">有效关系</span>
          <span className="admin-stat-value">{data.totals.activeCount}</span>
        </div>
        <div className="admin-stat-item">
          <span className="admin-stat-label">学生覆盖率</span>
          <span className="admin-stat-value">{data.totals.coveredStudentPercent}%</span>
        </div>
      </div>

      {errorMessage && (
        <div className="admin-error-banner" role="alert">
          {errorMessage}
          <button onClick={() => setErrorMessage(null)}>×</button>
        </div>
      )}

      {showForm && (
        <div className="admin-form-card">
          <h4>添加监护关系</h4>
          <div className="admin-form-row">
            <label>
              家长
              <select
                value={formData.parentUserId}
                onChange={(e) => setFormData({ ...formData, parentUserId: e.target.value })}
                disabled={submitting}
              >
                <option value="">请选择家长</option>
                {data.availableParents.map((parent) => (
                  <option key={parent.userId} value={parent.userId}>
                    {parent.displayName} ({parent.email})
                  </option>
                ))}
              </select>
            </label>
            <label>
              学生
              <select
                value={formData.studentUserId}
                onChange={(e) => setFormData({ ...formData, studentUserId: e.target.value })}
                disabled={submitting}
              >
                <option value="">请选择学生</option>
                {data.availableStudents.map((student) => (
                  <option key={student.userId} value={student.userId}>
                    {student.displayName} ({student.email})
                  </option>
                ))}
              </select>
            </label>
            <label>
              关系
              <select
                value={formData.relationship}
                onChange={(e) =>
                  setFormData({ ...formData, relationship: e.target.value as GuardianRelationship })
                }
                disabled={submitting}
              >
                <option value="mother">母亲</option>
                <option value="father">父亲</option>
                <option value="guardian">监护人</option>
              </select>
            </label>
          </div>
          <div className="admin-form-actions">
            <Button onClick={() => setShowForm(false)} variant="secondary" disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? '提交中...' : '确认添加'}
            </Button>
          </div>
        </div>
      )}

      {activeLinks.length === 0 && endedLinks.length === 0 ? (
        <EmptyState title="暂无监护关系" description="点击上方按钮添加家长与学生的绑定" />
      ) : (
        <>
          <div className="admin-data-section">
            <h4>有效关系</h4>
            {activeLinks.length === 0 ? (
              <p className="admin-empty-hint">暂无有效关系</p>
            ) : (
              <div className="admin-data-table">
                <table>
                  <thead>
                    <tr>
                      <th>家长</th>
                      <th>学生</th>
                      <th>关系</th>
                      <th>创建时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeLinks.map((link) => (
                      <tr key={link.linkId}>
                        <td>
                          {link.parent.displayName}
                          <span className="admin-cell-sub">{link.parent.email}</span>
                        </td>
                        <td>
                          {link.student.displayName}
                          <span className="admin-cell-sub">{link.student.email}</span>
                        </td>
                        <td>
                          {link.relationship === 'mother'
                            ? '母亲'
                            : link.relationship === 'father'
                              ? '父亲'
                              : '监护人'}
                        </td>
                        <td>{formatDateTime(link.createdAt)}</td>
                        <td>
                          <button
                            className="admin-action-btn"
                            onClick={() => setConfirmEnd(link.linkId)}
                            disabled={submitting}
                          >
                            结束关系
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {endedLinks.length > 0 && (
            <div className="admin-data-section">
              <h4>历史记录</h4>
              <div className="admin-data-table">
                <table>
                  <thead>
                    <tr>
                      <th>家长</th>
                      <th>学生</th>
                      <th>关系</th>
                      <th>创建时间</th>
                      <th>结束时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endedLinks.map((link) => (
                      <tr key={link.linkId} className="admin-row-ended">
                        <td>
                          {link.parent.displayName}
                          <span className="admin-cell-sub">{link.parent.email}</span>
                        </td>
                        <td>
                          {link.student.displayName}
                          <span className="admin-cell-sub">{link.student.email}</span>
                        </td>
                        <td>
                          {link.relationship === 'mother'
                            ? '母亲'
                            : link.relationship === 'father'
                              ? '父亲'
                              : '监护人'}
                        </td>
                        <td>{formatDateTime(link.createdAt)}</td>
                        <td>{formatDateTime(link.endedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {confirmEnd && (
        <ConfirmDialog
          title="确认结束监护关系"
          message="结束后家长将无法查看该学生的最新学习数据。历史记录仍然保留。"
          onConfirm={() => handleEnd(confirmEnd)}
          onCancel={() => setConfirmEnd(null)}
        />
      )}
    </div>
  );
}

function MentorPanel({
  data,
  onReload,
}: {
  data: MentorAssignmentListPageData;
  onReload: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<MentorFormData>({
    studentUserId: '',
    mentorUserId: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null);
  const [transferMode, setTransferMode] = useState<{ studentUserId: string } | null>(null);

  const handleCreate = async () => {
    if (!formData.studentUserId || !formData.mentorUserId) {
      setErrorMessage('请选择学生和班主任');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      await createMentorAssignment(formData, generateIdempotencyKey());
      setShowForm(false);
      setFormData({ studentUserId: '', mentorUserId: '' });
      onReload();
    } catch (error) {
      const err = error as { response?: { data?: ErrorEnvelope } };
      const code = err.response?.data?.error?.code;

      if (code === 'MENTOR_ALREADY_ASSIGNED') {
        const student = data.unassignedStudents.find((s) => s.userId === formData.studentUserId);
        const studentName = student?.displayName ?? '该学生';
        setErrorMessage(
          `${studentName}已有班主任。如需更换，请使用"换班主任"功能。`,
        );
      } else if (code === 'DIRECTORY_USER_NOT_FOUND') {
        setErrorMessage('选择的用户不存在');
      } else if (code === 'RELATIONSHIP_ROLE_INVALID') {
        setErrorMessage('角色不匹配：请确认选择了班主任和学生账号');
      } else if (code === 'SELF_RELATIONSHIP_INVALID') {
        setErrorMessage('无法将同一用户设置为班主任关系');
      } else {
        setErrorMessage(error instanceof Error ? error.message : '分配失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnd = async (assignmentId: string) => {
    setSubmitting(true);
    setErrorMessage(null);

    try {
      await endMentorAssignment(
        assignmentId,
        { reason: '管理后台手动结束' },
        generateIdempotencyKey(),
      );
      setConfirmEnd(null);
      onReload();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '结束失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransfer = async () => {
    if (!transferMode || !formData.mentorUserId) {
      setErrorMessage('请选择新班主任');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      await transferMentor(
        {
          studentUserId: transferMode.studentUserId,
          mentorUserId: formData.mentorUserId,
          reason: '管理后台换班主任',
        },
        generateIdempotencyKey(),
      );
      setTransferMode(null);
      setFormData({ studentUserId: '', mentorUserId: '' });
      onReload();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '换班主任失败');
    } finally {
      setSubmitting(false);
    }
  };

  const activeAssignments = data.items.filter((a) => a.status === 'active');
  const endedAssignments = data.items.filter((a) => a.status === 'ended');

  return (
    <div className="admin-relationship-panel">
      <div className="admin-panel-header">
        <div>
          <h3>班主任分配</h3>
          <p className="admin-panel-description">
            为学生分配班主任，确保每个学生都有专人跟进学习进展
          </p>
        </div>
        <Button onClick={() => setShowForm(true)} disabled={submitting}>
          分配班主任
        </Button>
      </div>

      <div className="admin-panel-stats">
        <div className="admin-stat-item">
          <span className="admin-stat-label">有效分配</span>
          <span className="admin-stat-value">{data.totals.activeCount}</span>
        </div>
        <div className="admin-stat-item">
          <span className="admin-stat-label">学生覆盖率</span>
          <span className="admin-stat-value">{data.totals.coveredStudentPercent}%</span>
        </div>
        <div className="admin-stat-item">
          <span className="admin-stat-label">待分配</span>
          <span className="admin-stat-value admin-stat-alert">
            {data.unassignedStudents.length}
          </span>
        </div>
      </div>

      {errorMessage && (
        <div className="admin-error-banner" role="alert">
          {errorMessage}
          <button onClick={() => setErrorMessage(null)}>×</button>
        </div>
      )}

      {data.unassignedStudents.length > 0 && (
        <div className="admin-alert-card">
          <h4>待分配班主任的学生</h4>
          <p>以下学生尚未分配班主任，请尽快完成分配：</p>
          <ul className="admin-unassigned-list">
            {data.unassignedStudents.map((student) => (
              <li key={student.userId}>
                <span>
                  {student.displayName} <span className="admin-cell-sub">({student.email})</span>
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    setFormData({ studentUserId: student.userId, mentorUserId: '' });
                    setShowForm(true);
                  }}
                  disabled={submitting}
                >
                  立即分配
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showForm && !transferMode && (
        <div className="admin-form-card">
          <h4>分配班主任</h4>
          <div className="admin-form-row">
            <label>
              学生
              <select
                value={formData.studentUserId}
                onChange={(e) => setFormData({ ...formData, studentUserId: e.target.value })}
                disabled={submitting}
              >
                <option value="">请选择学生</option>
                {data.unassignedStudents.map((student) => (
                  <option key={student.userId} value={student.userId}>
                    {student.displayName} ({student.email})
                  </option>
                ))}
              </select>
            </label>
            <label>
              班主任
              <select
                value={formData.mentorUserId}
                onChange={(e) => setFormData({ ...formData, mentorUserId: e.target.value })}
                disabled={submitting}
              >
                <option value="">请选择班主任</option>
                {data.availableMentors.map((mentor) => (
                  <option key={mentor.userId} value={mentor.userId}>
                    {mentor.displayName} ({mentor.email})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="admin-form-actions">
            <Button onClick={() => setShowForm(false)} variant="secondary" disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? '提交中...' : '确认分配'}
            </Button>
          </div>
        </div>
      )}

      {transferMode && (
        <div className="admin-form-card">
          <h4>换班主任</h4>
          <p className="admin-form-hint">
            正在为{' '}
            <strong>
              {
                activeAssignments.find((a) => a.student.userId === transferMode.studentUserId)
                  ?.student.displayName
              }
            </strong>{' '}
            更换班主任
          </p>
          <div className="admin-form-row">
            <label>
              新班主任
              <select
                value={formData.mentorUserId}
                onChange={(e) => setFormData({ ...formData, mentorUserId: e.target.value })}
                disabled={submitting}
              >
                <option value="">请选择新班主任</option>
                {data.availableMentors.map((mentor) => (
                  <option key={mentor.userId} value={mentor.userId}>
                    {mentor.displayName} ({mentor.email})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="admin-form-actions">
            <Button
              onClick={() => {
                setTransferMode(null);
                setFormData({ studentUserId: '', mentorUserId: '' });
              }}
              variant="secondary"
              disabled={submitting}
            >
              取消
            </Button>
            <Button onClick={handleTransfer} disabled={submitting}>
              {submitting ? '提交中...' : '确认换班主任'}
            </Button>
          </div>
        </div>
      )}

      {activeAssignments.length === 0 && endedAssignments.length === 0 ? (
        <EmptyState title="暂无班主任分配" description="点击上方按钮为学生分配班主任" />
      ) : (
        <>
          <div className="admin-data-section">
            <h4>有效分配</h4>
            {activeAssignments.length === 0 ? (
              <p className="admin-empty-hint">暂无有效分配</p>
            ) : (
              <div className="admin-data-table">
                <table>
                  <thead>
                    <tr>
                      <th>学生</th>
                      <th>班主任</th>
                      <th>分配时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeAssignments.map((assignment) => (
                      <tr key={assignment.assignmentId}>
                        <td>
                          {assignment.student.displayName}
                          <span className="admin-cell-sub">{assignment.student.email}</span>
                        </td>
                        <td>
                          {assignment.mentor.displayName}
                          <span className="admin-cell-sub">{assignment.mentor.email}</span>
                        </td>
                        <td>{formatDateTime(assignment.assignedAt)}</td>
                        <td>
                          <button
                            className="admin-action-btn"
                            onClick={() => {
                              setTransferMode({ studentUserId: assignment.student.userId });
                              setFormData({ studentUserId: '', mentorUserId: '' });
                            }}
                            disabled={submitting}
                          >
                            换班主任
                          </button>
                          <button
                            className="admin-action-btn"
                            onClick={() => setConfirmEnd(assignment.assignmentId)}
                            disabled={submitting}
                          >
                            结束分配
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {endedAssignments.length > 0 && (
            <div className="admin-data-section">
              <h4>历史记录</h4>
              <div className="admin-data-table">
                <table>
                  <thead>
                    <tr>
                      <th>学生</th>
                      <th>班主任</th>
                      <th>分配时间</th>
                      <th>结束时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endedAssignments.map((assignment) => (
                      <tr key={assignment.assignmentId} className="admin-row-ended">
                        <td>
                          {assignment.student.displayName}
                          <span className="admin-cell-sub">{assignment.student.email}</span>
                        </td>
                        <td>
                          {assignment.mentor.displayName}
                          <span className="admin-cell-sub">{assignment.mentor.email}</span>
                        </td>
                        <td>{formatDateTime(assignment.assignedAt)}</td>
                        <td>{formatDateTime(assignment.endedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {confirmEnd && (
        <ConfirmDialog
          title="确认结束班主任分配"
          message="结束后该学生将没有班主任。历史记录仍然保留。"
          onConfirm={() => handleEnd(confirmEnd)}
          onCancel={() => setConfirmEnd(null)}
        />
      )}
    </div>
  );
}

export default function AdminRelationshipsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('guardians');
  const [guardianData, setGuardianData] = useState<GuardianLinkListPageData | null>(null);
  const [mentorData, setMentorData] = useState<MentorAssignmentListPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [guardians, mentors] = await Promise.all([
        fetchGuardianLinks(),
        fetchMentorAssignments(),
      ]);
      setGuardianData(guardians);
      setMentorData(mentors);
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
  if (stateView) return <div className="admin-relationships-page">{stateView}</div>;

  if (!guardianData || !mentorData) return null;

  return (
    <div className="admin-relationships-page">
      <section className="admin-hero-banner admin-relationships-hero">
        <div className="admin-hero-copy">
          <div className="admin-hero-badges"><span className="admin-live-badge"><i />AI 智慧守护已在线</span><span className="admin-hero-note">家校协同治理节点运行中</span></div>
          <h1>家校协同守护，共筑成长桥梁</h1>
          <p>统一管理监护关系与班主任分配，帮助每位学生获得清晰、可靠且最小化的支持链路。</p>
        </div>
        <div className="admin-hero-mascot"><span className="admin-hero-bubble">关系治理实时同步</span><img src="/admin/frontend_pictures/3d14d7e2-1727-48f6-b3a4-42e4fe49ce77.png" alt="AI 教育机器人助手" /></div>
      </section>

      <div className="admin-page-header">
        <div className="admin-page-header-title">
          <h1>关系绑定</h1>
          <DataSourceBadge dataSource={guardianData.dataSource} />
        </div>
        <p>管理家长↔学生监护关系和班主任分配</p>
      </div>

      <Card variant="soft" className="admin-tabs-card">
        <div className="admin-tabs">
        <button
          className={activeTab === 'guardians' ? 'admin-tab active' : 'admin-tab'}
          onClick={() => setActiveTab('guardians')}
        >
          家长 ↔ 学生
        </button>
        <button
          className={activeTab === 'mentors' ? 'admin-tab active' : 'admin-tab'}
          onClick={() => setActiveTab('mentors')}
        >
          班主任分配
        </button>
        </div>
      </Card>

      {activeTab === 'guardians' ? (
        <GuardianPanel data={guardianData} onReload={load} />
      ) : (
        <MentorPanel data={mentorData} onReload={load} />
      )}
    </div>
  );
}
