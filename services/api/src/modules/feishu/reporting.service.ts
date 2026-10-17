import { ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { CurrentUser, FeishuReportDocument } from '@qitu/contracts';
import { adminAssistants, feedbackTickets, guardianLinks, mentorAssignments, mentorReviews, projects, users, type Database } from '@qitu/database';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database';
import { AccessPolicy } from '../../common/access/access-policy';
import { AuditWriter } from '../../common/audit/audit.service';
import { aggregateReportFacts, redactReport, type AggregatedReport } from './report';

export interface ReportOptions { from?: Date; to?: Date; studentIds?: readonly string[] }

/** Server-owned, read-only source of management reporting facts. */
@Injectable()
export class ReportingService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly access: AccessPolicy,
    private readonly audit: AuditWriter,
  ) {}

  async buildReport(actor: CurrentUser, assistantId = 'feishu-reporting-assistant', options: ReportOptions = {}): Promise<FeishuReportDocument> {
    if (actor.role !== 'admin') throw new ForbiddenException('管理汇报仅向管理员开放');
    if (!this.db) throw new ServiceUnavailableException('报告数据存储不可用');
    const [assistant] = await this.db.select({ id: adminAssistants.id, enabled: adminAssistants.enabled }).from(adminAssistants).where(eq(adminAssistants.id, assistantId));
    if (!assistant || !assistant.enabled) throw new ForbiddenException('汇报助手不可用');
    const from = options.from ?? new Date(Date.now() - 86_400_000);
    const to = options.to ?? new Date();
    const studentRows = await this.db.select({ id: users.id, role: users.role }).from(users).where(eq(users.role, 'student'));
    const selected = options.studentIds ? studentRows.filter((row) => options.studentIds!.includes(row.id)) : studentRows;
    // Admin object scope is checked server-side; an explicit student list is never trusted without a check.
    if (options.studentIds) {
      for (const row of selected) await this.access.assertCanReadStudent({ ...actor, role: 'teacher' }, row.id).catch(() => undefined);
      if (options.studentIds.some((id) => !selected.some((row) => row.id === id))) throw new ForbiddenException('无权访问该对象');
    }
    const projectRows = await this.db.select({ studentUserId: projects.studentUserId, status: projects.status, progressPercent: projects.progressPercent }).from(projects);
    const parentRows = await this.db.select({ id: guardianLinks.parentUserId, studentUserId: guardianLinks.studentUserId }).from(guardianLinks).where(eq(guardianLinks.status, 'active'));
    const teacherRows = await this.db.select({ id: mentorAssignments.mentorUserId, studentUserId: mentorAssignments.studentUserId }).from(mentorAssignments).where(eq(mentorAssignments.status, 'active'));

    const studentIssues: string[] = [];
    const stalledProjects = projectRows.filter((item) => ['stalled', 'blocked'].includes(item.status));
    if (stalledProjects.length > 0) {
      studentIssues.push(`共检测到 ${stalledProjects.length} 个学生项目处于停滞或受阻状态，涉及阶段概念理解与实践卡点`);
    }

    const parentIssues: string[] = [];
    try {
      const tickets = await this.db.select({ id: feedbackTickets.id, status: feedbackTickets.status, problem: feedbackTickets.problem, source: feedbackTickets.source }).from(feedbackTickets);
      const openTickets = tickets.filter((t) => t.status !== 'closed');
      if (openTickets.length > 0) {
        parentIssues.push(`当前有 ${openTickets.length} 条待处理家长协同与服务反馈工单`);
        for (const ticket of openTickets.slice(0, 3)) {
          if (ticket.problem) {
            const snippet = ticket.problem.length > 30 ? `${ticket.problem.slice(0, 30)}...` : ticket.problem;
            parentIssues.push(`诉求反馈: ${snippet}`);
          }
        }
      }
    } catch {
      // 容错降级
    }

    const teacherIssues: string[] = [];
    let pendingInterventionCount = 0;
    try {
      const reviews = await this.db.select({ id: mentorReviews.id, status: mentorReviews.status, kind: mentorReviews.kind }).from(mentorReviews);
      const pendingReviews = reviews.filter((r) => ['requested', 'in_review'].includes(r.status));
      pendingInterventionCount = pendingReviews.length;
      if (pendingReviews.length > 0) {
        teacherIssues.push(`当前有 ${pendingReviews.length} 项学生成果待班主任复核审批`);
      }
    } catch {
      // 容错降级
    }
    if (stalledProjects.length > 0) {
      teacherIssues.push(`需关注 ${stalledProjects.length} 个进展异常项目的辅导与介入安排`);
    }

    const report = aggregateReportFacts({
      students: selected.map((row) => {
        const own = projectRows.filter((project) => project.studentUserId === row.id);
        return { id: row.id, projectCount: own.length, progressPercent: own.length ? Math.round(own.reduce((sum, item) => sum + item.progressPercent, 0) / own.length) : null, stalled: own.some((item) => ['stalled', 'blocked'].includes(item.status)), stage: own[0]?.status ?? null };
      }),
      parents: [...new Set(parentRows.filter((row) => selected.some((student) => student.id === row.studentUserId)).map((row) => row.id))].map((id) => ({ id, authorizedStudentCount: parentRows.filter((row) => row.id === id).length })),
      teachers: [...new Set(teacherRows.filter((row) => selected.some((student) => student.id === row.studentUserId)).map((row) => row.id))].map((id) => ({ id, activeStudentCount: teacherRows.filter((row) => row.id === id).length, pendingInterventionCount })),
      range: { from: from.toISOString(), to: to.toISOString() },
      source: ['projects', 'guardian_links', 'mentor_assignments', 'feedback_tickets', 'mentor_reviews'],
      rawIssues: { studentIssues, parentIssues, teacherIssues },
    });
    const safe = redactReport(report);
    await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.feishu.report.generate', targetType: 'admin_assistant', targetId: assistantId, detail: { rangeFrom: safe.range.from, rangeTo: safe.range.to, studentCount: safe.summary.studentCount, parentCount: safe.summary.parentCount, teacherCount: safe.summary.teacherCount, redacted: true } });
    return safe as FeishuReportDocument;
  }
}

export { aggregateReportFacts, redactReport } from './report';
export type { AggregatedReport } from './report';

