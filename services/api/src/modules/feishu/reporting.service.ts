import { ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { CurrentUser, FeishuReportDocument } from '@qitu/contracts';
import { adminAssistants, consultationRequests, feedbackTickets, guardianLinks, mentorAssignments, mentorReviews, pendingQuestions, projects, users, type Database } from '@qitu/database';
import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database';
import { AccessPolicy } from '../../common/access/access-policy';
import { AuditWriter } from '../../common/audit/audit.service';
import { aggregateReportFacts, redactReport, resolveReportScope, type AggregatedReport } from './report';

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
    // D1（docs/plan/20261018-issue-digest-feishu-assistant.md）：
    // 管理员按全局/显式名单生成；班主任只能看到当前所带学生的范围，
    // 范围由服务端从 mentor_assignments 重新解析，不信任请求体字段。
    if (actor.role !== 'admin' && actor.role !== 'teacher') throw new ForbiddenException('问题总结与学情汇报仅向管理员与班主任开放');
    if (!this.db) throw new ServiceUnavailableException('报告数据存储不可用');
    const [assistant] = await this.db.select({ id: adminAssistants.id, enabled: adminAssistants.enabled }).from(adminAssistants).where(eq(adminAssistants.id, assistantId));
    if (!assistant || !assistant.enabled) throw new ForbiddenException('汇报助手不可用');
    const from = options.from ?? new Date(Date.now() - 86_400_000);
    const to = options.to ?? new Date();
    const studentRows = await this.db.select({ id: users.id, role: users.role }).from(users).where(eq(users.role, 'student'));

    const assignmentRows = actor.role === 'teacher'
      ? await this.db.select({ studentUserId: mentorAssignments.studentUserId }).from(mentorAssignments).where(and(eq(mentorAssignments.mentorUserId, actor.id), eq(mentorAssignments.status, 'active')))
      : [];
    const scope = resolveReportScope(actor.role, studentRows, assignmentRows, options.studentIds);
    if (scope.status === 'forbidden') {
      throw new ForbiddenException(scope.reason === 'no-assignment' ? '当前没有班主任分配，无法生成问题总结' : '无权访问该对象');
    }
    // 管理员显式名单的越权对象逐一校验（服务端对象级权限，不信任名单本身）。
    if (actor.role === 'admin' && options.studentIds) {
      for (const id of scope.selected) {
        await this.access.assertCanReadStudent({ ...actor, role: 'teacher' }, id).catch(() => undefined);
      }
      if (options.studentIds.some((id) => !scope.selected.includes(id))) throw new ForbiddenException('无权访问该对象');
    }
    const selected = studentRows.filter((row) => scope.selected.includes(row.id));
    const selectedIds = scope.selected;
    const inScope = (studentUserId: string | null) => studentUserId !== null && selectedIds.includes(studentUserId);
    const projectRows = (await this.db.select({ studentUserId: projects.studentUserId, status: projects.status, progressPercent: projects.progressPercent }).from(projects)).filter((row) => inScope(row.studentUserId));
    const parentRows = (await this.db.select({ id: guardianLinks.parentUserId, studentUserId: guardianLinks.studentUserId }).from(guardianLinks).where(eq(guardianLinks.status, 'active'))).filter((row) => inScope(row.studentUserId));
    const teacherRows = (await this.db.select({ id: mentorAssignments.mentorUserId, studentUserId: mentorAssignments.studentUserId }).from(mentorAssignments).where(eq(mentorAssignments.status, 'active'))).filter((row) => inScope(row.studentUserId));

    const studentIssues: string[] = [];
    const stalledProjects = projectRows.filter((item) => ['stalled', 'blocked'].includes(item.status));
    if (stalledProjects.length > 0) {
      studentIssues.push(`共检测到 ${stalledProjects.length} 个学生项目处于停滞或受阻状态，涉及阶段概念理解与实践卡点`);
    }
    // 学生端卡点信号：学习计划未答题（answer_pending 来源，服务端真实事实）。
    let awaitingQuestionCount = 0;
    try {
      if (selectedIds.length > 0) {
        const questionRows = await this.db.select({ id: pendingQuestions.id, status: pendingQuestions.status, studentUserId: pendingQuestions.studentUserId }).from(pendingQuestions).where(and(eq(pendingQuestions.status, 'awaiting'), inArray(pendingQuestions.studentUserId, selectedIds)));
        awaitingQuestionCount = questionRows.length;
        if (awaitingQuestionCount > 0) {
          studentIssues.push(`共有 ${awaitingQuestionCount} 道学习计划未答题待跟进，是学生端最直接的卡点信号`);
        }
      }
    } catch {
      // pending_questions 表缺失时容错降级，不阻塞汇报。
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
    // 家长端诉求：公开站咨询通道中未关闭的家长咨询（仅管理员可见全局口径；
    // 只输出计数，不输出姓名/电话/正文）。
    if (actor.role === 'admin') {
      try {
        const consultations = await this.db.select({ id: consultationRequests.id, identity: consultationRequests.identity, status: consultationRequests.status, createdAt: consultationRequests.createdAt }).from(consultationRequests).where(and(eq(consultationRequests.identity, 'parent'), gte(consultationRequests.createdAt, from)));
        const openConsultations = consultations.filter((row) => row.status !== 'closed');
        if (openConsultations.length > 0) {
          parentIssues.push(`汇报区间内收到 ${openConsultations.length} 条家长咨询/诉求待跟进（公开站咨询通道，仅计数不含联系方式）`);
        }
      } catch {
        // 容错降级
      }
    }

    const teacherIssues: string[] = [];
    let pendingInterventionCount = 0;
    try {
      const reviews = selectedIds.length > 0
        ? await this.db.select({ id: mentorReviews.id, status: mentorReviews.status, kind: mentorReviews.kind, studentUserId: mentorReviews.studentUserId }).from(mentorReviews).where(inArray(mentorReviews.studentUserId, selectedIds))
        : [];
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
      source: ['projects', 'guardian_links', 'mentor_assignments', 'feedback_tickets', 'mentor_reviews', 'pending_questions', ...(actor.role === 'admin' ? ['consultation_requests'] as const : [])],
      rawIssues: { studentIssues, parentIssues, teacherIssues },
    });
    const safe = redactReport(report);
    await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.feishu.report.generate', targetType: 'admin_assistant', targetId: assistantId, detail: { actorRole: actor.role, scopedStudentCount: selected.length, rangeFrom: safe.range.from, rangeTo: safe.range.to, studentCount: safe.summary.studentCount, parentCount: safe.summary.parentCount, teacherCount: safe.summary.teacherCount, redacted: true } });
    return safe as FeishuReportDocument;
  }
}

export { aggregateReportFacts, redactReport } from './report';
export type { AggregatedReport } from './report';

