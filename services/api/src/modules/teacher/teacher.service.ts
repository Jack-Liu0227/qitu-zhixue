import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { mentorReviews, withTransaction, type Database } from '@qitu/database';
import { DirectoryService } from '../directory/directory.service';
import { LearningInsightsService } from '../learning-insights/learning-insights.service';
import { GrowthService } from '../growth/growth.service';
import { FeedbackService } from '../feedback/feedback.service';
import { TeacherInterventionService } from './teacher-intervention.service';
import { PlatformDataService } from '../platform-data/platform-data.service';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { WorksService } from '../works/works.service';
import { InMemoryWorksStore, type MentorReviewRecord } from '../works/works.store';
import { currentStudentProject } from '../projects/current-project';
import { TeamRuntimeService, type TeacherAgentRunProjection } from '../team-runtime/team-runtime.service';
import type { AuditEntry } from '../../common/audit/audit-entry';
import { AuditWriter } from '../../common/audit/audit.service';
import type {
  CurrentUser,
  TeacherReviewDecision,
  TeacherReviewDecisionRequest,
  TeacherReviewDecisionResponse,
  TeacherStudentRow,
  TeacherStudentDetail,
  TeacherInterventionRow,
  TeacherInterventionDetail,
  TeacherInterventionAction,
  TeacherInterventionActionResponse,
  TeacherStatisticsPageData,
  TeacherIdentity,
  TeacherGuardianRef,
  ProjectStage,
} from '@qitu/contracts';

/* ========================================================================== *
 * 班主任复核审批（T20：`mentor_reviews` 审批真源）
 *
 * `review_completed_and_archived` 门禁的判据是「作品已发布 且 存在
 * `mentor_reviews.status='approved'`」，但此前全仓没有任何代码能把
 * `status` 写成 `approved`（`works.service.ts:353` 只读、`:396` 只创建
 * `requested`），所发分支永远落在待审核。本节是那个写入点。
 *
 * 存储层（`TeacherReviewRepository`）只做两件事：按 id 读回一行、以 CAS
 * 方式落定一个决定；**审计与业务写入在同一个事务里**，避免出现「批复落库但
 * 审计丢失」。逻辑层（`TeacherService.decideReview`）负责权限与终态判定。
 * ========================================================================== */

/** 本模块的稳定错误码（沿用仓内 `domain_resource_REASON` 写法）。 */
export const TEACHER_REVIEW_ERROR_CODES = {
  /** 请求体非法：未知键（含客户端直写归属字段）或取值不合法（400）。 */
  REQUEST_INVALID: 'TEACHER_REVIEW_REQUEST_INVALID',
  /** 复核不存在，或对调用者不可见（404）。 */
  NOT_FOUND: 'TEACHER_REVIEW_NOT_FOUND',
  /** 调用者不是该复核行的 `mentorUserId` 本人（403）。 */
  NOT_OWNER: 'TEACHER_REVIEW_NOT_OWNER',
  /** 决定与已有终态冲突，不可篡改（409）。 */
  DECISION_CONFLICT: 'TEACHER_REVIEW_DECISION_CONFLICT',
  /** 复核存储不可用（503）：live 缺少 DATABASE_URL。 */
  UNAVAILABLE: 'TEACHER_REVIEW_UNAVAILABLE',
} as const;

/**
 * 可提交的决定。类型 `TeacherReviewDecision` 在运行时不存在，所以控制器
 * 必须自己拿这份数组重校（`REVIEW_DECISION_VALUES`）。
 */
export const REVIEW_DECISION_VALUES: readonly TeacherReviewDecision[] = [
  'approved',
  'changes_requested',
  'rejected',
];

/**
 * 终态：一旦落定不可改写。
 *
 * `changes_requested` **不是**终态：学生修改后班主任需要能再批成 `approved`，
 * 否则「要求修改 → 修改 → 通过」这条链会断掉。
 */
const TERMINAL_REVIEW_STATUSES: readonly string[] = ['approved', 'rejected'];

/** 只有这些状态允许首次落定决定（已终态走重放 / 409 分支）。 */
const DECIDABLE_REVIEW_STATUSES: readonly string[] = ['requested', 'in_review', 'changes_requested'];

/** `comment` 上限：与 `MAX_ARTIFACT_SUMMARY_LENGTH` 同量级，不存下原文。 */
export const MAX_TEACHER_REVIEW_COMMENT_LENGTH = 2000;

/** `mentor_reviews` 行的服务视图（仅审批需要的列）。 */
export interface TeacherReviewRecord {
  id: string;
  schoolId: string | null;
  studentUserId: string;
  mentorUserId: string;
  projectId: string | null;
  artifactRef: string | null;
  kind: string;
  status: string;
  decision: string | null;
  comment: string | null;
  idempotencyKey: string;
  requestedAt: Date;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** CAS 落定决定的入参。**没有**任何归属字段：student/mentor/project/kind/artifactRef 一律不写。 */
export interface ApplyReviewDecisionInput {
  reviewId: string;
  /** CAS 前置状态：只有行仍处于该状态时才能写入。 */
  expectedStatus: string;
  status: TeacherReviewDecision;
  decision: TeacherReviewDecision;
  comment: string | null;
  reviewedAt: Date;
  /** 与业务写入同事务提交的审计条目。 */
  audit: AuditEntry;
}

export type ApplyReviewDecisionResult = 'applied' | 'stale';

/**
 * 复核存储端口。
 *
 * 与 `WorksStore` / `FeedbackStore` 同构：抽象类既是 DI 令牌也是类型，
 * Postgres 实现用于 live，内存实现仅用于 `demo` / `test`。
 */
export abstract class TeacherReviewRepository {
  abstract findReviewById(reviewId: string): Promise<TeacherReviewRecord | null>;
  abstract listForStudent(studentId: string, mentorId: string, offset: number, limit: number): Promise<TeacherReviewRecord[]>;
  abstract applyDecision(input: ApplyReviewDecisionInput): Promise<ApplyReviewDecisionResult>;
}

type MentorReviewRow = typeof mentorReviews.$inferSelect;

function mapReviewRow(row: MentorReviewRow): TeacherReviewRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    studentUserId: row.studentUserId,
    mentorUserId: row.mentorUserId,
    projectId: row.projectId,
    artifactRef: row.artifactRef,
    kind: row.kind,
    status: row.status,
    decision: row.decision,
    comment: row.comment,
    idempotencyKey: row.idempotencyKey,
    requestedAt: row.requestedAt,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * live 实现。只动 `status` / `decision` / `comment` / `reviewed_at` / `updated_at`
 * 五列；`kind` 与 `artifact_ref` 原样保留，所以写完的那一行仍然能被
 * `works.store.postgres.ts:255-268` 的 `findApprovedReviewForArtifact`
 * （`artifact_ref = artifactId AND status = 'approved'`）读到。
 */
export class PostgresTeacherReviewRepository extends TeacherReviewRepository {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditWriter,
  ) {
    super();
  }

  async findReviewById(reviewId: string): Promise<TeacherReviewRecord | null> {
    const rows = await this.db
      .select()
      .from(mentorReviews)
      .where(eq(mentorReviews.id, reviewId))
      .limit(1);
    return rows[0] === undefined ? null : mapReviewRow(rows[0]);
  }

  async listForStudent(studentId: string, mentorId: string, offset: number, limit: number): Promise<TeacherReviewRecord[]> {
    const rows = await this.db.select().from(mentorReviews)
      .where(and(eq(mentorReviews.studentUserId, studentId), eq(mentorReviews.mentorUserId, mentorId), eq(mentorReviews.kind, 'artifact')))
      .orderBy(desc(mentorReviews.requestedAt), desc(mentorReviews.id)).offset(offset).limit(limit);
    return rows.map(mapReviewRow);
  }

  async applyDecision(input: ApplyReviewDecisionInput): Promise<ApplyReviewDecisionResult> {
    return withTransaction(this.db, async (tx) => {
      const updated = await tx
        .update(mentorReviews)
        .set({
          status: input.status,
          decision: input.decision,
          comment: input.comment,
          reviewedAt: input.reviewedAt,
          updatedAt: input.reviewedAt,
        })
        .where(and(eq(mentorReviews.id, input.reviewId), eq(mentorReviews.status, input.expectedStatus)))
        .returning({ id: mentorReviews.id });
      if (updated.length === 0) return 'stale';
      // 审计与写入同一事务：不存在「批复落库、审计丢失」的中间态。
      await this.audit.write(input.audit, tx);
      return 'applied';
    });
  }
}

/**
 * 内存实现：仅用于 `demo` / `test`（与 `InMemoryFeedbackStore` 同理），
 * 语义与 Postgres 实现一致：CAS + 同事务审计（单线程下即同一批处理）。
 */
export class InMemoryTeacherReviewRepository extends TeacherReviewRepository {
  private readonly rows = new Map<string, TeacherReviewRecord>();

  constructor(private readonly audit?: AuditWriter, private readonly shared?: InMemoryWorksStore) {
    super();
  }

  /** 测试 / demo 种子。 */
  seed(review: TeacherReviewRecord): void {
    this.rows.set(review.id, { ...review });
  }

  async findReviewById(reviewId: string): Promise<TeacherReviewRecord | null> {
    if (this.shared) {
      const row = await this.shared.findReviewById(reviewId);
      return row ? this.projectShared(row) : null;
    }
    const row = this.rows.get(reviewId);
    return row === undefined ? null : { ...row };
  }

  async listForStudent(studentId: string, mentorId: string, offset: number, limit: number): Promise<TeacherReviewRecord[]> {
    if (this.shared) return (await this.shared.listReviewsForStudent(studentId, mentorId, offset, limit)).map((row) => this.projectShared(row));
    return [...this.rows.values()].filter((row) => row.studentUserId === studentId && row.mentorUserId === mentorId && row.kind === 'artifact')
      .sort((left, right) => right.requestedAt.getTime() - left.requestedAt.getTime() || right.id.localeCompare(left.id))
      .slice(offset, offset + limit).map((row) => ({ ...row }));
  }

  async applyDecision(input: ApplyReviewDecisionInput): Promise<ApplyReviewDecisionResult> {
    if (this.shared) return this.shared.applyReviewDecision(input, async () => { await this.audit?.write(input.audit); });
    const current = this.rows.get(input.reviewId);
    if (current === undefined || current.status !== input.expectedStatus) return 'stale';
    const next: TeacherReviewRecord = {
      ...current,
      status: input.status,
      decision: input.decision,
      comment: input.comment,
      reviewedAt: input.reviewedAt,
      updatedAt: input.reviewedAt,
    };
    this.rows.set(input.reviewId, next);
    if (this.audit !== undefined) await this.audit.write(input.audit);
    return 'applied';
  }

  /** 测试辅助：清空。 */
  reset(): void {
    this.rows.clear();
  }

  private projectShared(row: MentorReviewRecord): TeacherReviewRecord {
    return { ...row, studentUserId: row.studentId, artifactRef: row.artifactId };
  }
}

/**
 * Teacher service: roster, interventions, statistics, 复核审批.
 * All methods enforce object-level authorization — teacher may only access their assigned students.
 */
@Injectable()
export class TeacherService {
  constructor(
    private readonly directory: DirectoryService,
    private readonly platformData: PlatformDataService,
    @Optional() private readonly teamRuntime?: TeamRuntimeService,
    // 存储由 `TeacherModule` 按数据模式提供；缺位时 `decideReview` 诚实 503，
    // 绝不“内存里批成功”。
    @Optional() @Inject(TeacherReviewRepository) private readonly reviews?: TeacherReviewRepository,
    @Optional() private readonly learningStore?: LearningPlanStore,
    @Optional() private readonly works?: WorksService,
    @Optional() private readonly insights?: LearningInsightsService,
    @Optional() private readonly growth?: GrowthService,
    @Optional() private readonly feedback?: FeedbackService,
    @Optional() private readonly interventions?: TeacherInterventionService,
    @Optional() private readonly audit?: AuditWriter,
  ) {}

  async listStudentReviews(actor: CurrentUser, studentId: string, offset = 0, limit = 20) {
    if (actor.role !== 'teacher') throw new ForbiddenException('复核列表仅限当前班主任');
    await this.assertTeacherCanAccessStudent(actor.id, studentId);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new BadRequestException({ code: 'TEACHER_REVIEW_REQUEST_INVALID', message: '分页范围无效' });
    }
    if (!this.reviews || !this.works) throw new ServiceUnavailableException({ code: 'TEACHER_REVIEW_UNAVAILABLE', message: '复核读取服务尚不可用' });
    const rows = await this.reviews.listForStudent(studentId, actor.id, offset, limit + 1);
    const items = [];
    for (const row of rows.slice(0, limit)) {
      if (!row.artifactRef || row.kind !== 'artifact' || row.studentUserId !== studentId || row.mentorUserId !== actor.id) continue;
      try {
        const version = await this.works.getAssignedReviewVersion(actor, row.id, row.artifactRef);
        if (version.projectId !== row.projectId) continue;
        items.push({ reviewId: row.id, ...version, status: row.status, requestedAt: row.requestedAt.toISOString() });
      } catch (error) {
        if (error instanceof ForbiddenException || error instanceof NotFoundException) continue;
        throw error;
      }
    }
    await this.assertTeacherCanAccessStudent(actor.id, studentId);
    return { items, nextOffset: rows.length > limit ? offset + limit : null };
  }

  /**
   * Assert that teacherUserId currently mentors studentUserId (active assignment).
   * Throws 403 if not assigned — no data leak.
   */
  async assertTeacherCanAccessStudent(teacherUserId: string, studentUserId: string): Promise<void> {
    const students = await this.directory.studentsOfMentor(teacherUserId);
    const assigned = students.some((s) => s.userId === studentUserId);
    if (!assigned) {
      throw new ForbiddenException({
        code: 'STUDENT_NOT_ASSIGNED',
        message: '您当前不是该学生的班主任',
      });
    }
  }

  /**
   * Get teacher identity.
   */
  async getTeacherIdentity(teacherUserId: string): Promise<TeacherIdentity> {
    const teacher = await this.directory.findUser(teacherUserId);
    if (!teacher) {
      throw new NotFoundException('教师不存在');
    }
    const students = await this.directory.studentsOfMentor(teacherUserId);
    return {
      teacherId: teacher.userId,
      displayName: teacher.displayName,
      email: teacher.email,
      studentCount: students.length,
    };
  }

  /**
   * Get all students currently assigned to this teacher.
   */
  async getRoster(teacherUserId: string): Promise<TeacherStudentRow[]> {
    const students = await this.directory.studentsOfMentor(teacherUserId);
    await this.audit?.write({ actorId: teacherUserId, actorRole: 'teacher', action: 'teacher.learning.read',
      targetType: 'mentor_roster', targetId: teacherUserId, detail: { studentCount: students.length, projection: 'family-learning.v1' } });

    // 监护人数必须真算。之前这里是写死的 `guardianCount: 0`，于是教师端
    // 「尚无监护人接入」统计永远等于学生总数 —— 和管理后台的关系绑定页
    // 直接矛盾（那边明明显示已绑定）。这里一次取全部 active 关系再本地聚合，
    // 避免每个学生查一次库。
    const activeLinks = await this.directory.listGuardianLinks('active');
    const guardianCounts = new Map<string, number>();
    for (const link of activeLinks) {
      const studentId = link.student.userId;
      guardianCounts.set(studentId, (guardianCounts.get(studentId) ?? 0) + 1);
    }

    if (!this.learningStore) throw new ServiceUnavailableException('项目统计暂不可用');
    const feedback = this.feedback ? await this.feedback.listForTeacher(teacherUserId) : [];
    const interventions = this.interventions ? await this.interventions.list(teacherUserId) : [];
    return Promise.all(students.map(async (s) => {
      const projects = await this.learningStore!.listProjectsByStudent(s.userId);
      const current = currentStudentProject(projects);
      const activity = this.insights ? await this.insights.activity(s.userId) : undefined;
      const attentionCount = feedback.filter(ticket => ticket.studentId === s.userId && ['processing', 'reopened'].includes(ticket.status)).length
        + interventions.filter(row => row.studentId === s.userId && row.status !== 'resolved').length;
      return {
        studentId: s.userId, displayName: s.displayName, email: s.email,
        gradeLabel: null, classLabel: null, avatarInitial: s.displayName.charAt(0),
        activeProjectCount: projects.filter((project) => !['completed', 'published', 'exploration'].includes(project.status)).length,
        projectsCompleted: projects.filter((project) => ['completed', 'published'].includes(project.status)).length,
        currentProjectId: current?.id ?? null, currentProjectTitle: current?.title ?? null,
        currentStage: current?.status ?? null, progressPercent: current?.progressPercent ?? 0,
        lastActivityAt: activity?.lastActivityAt ?? null, stuck: false, attentionCount,
        guardianCount: guardianCounts.get(s.userId) ?? 0, activeDays: activity?.activeDays ?? 0,
        weeklyTasks: activity?.completedSessionsThisWeek ?? 0, activity,
        signalsAvailable: activity !== undefined,
      };
    }));
  }

  /**
   * Get detail for one student. Enforces object-level auth.
   */
  async getStudentDetail(teacherUserId: string, studentUserId: string): Promise<TeacherStudentDetail> {
    await this.assertTeacherCanAccessStudent(teacherUserId, studentUserId);

    const student = await this.directory.findUser(studentUserId);
    if (!student) {
      throw new NotFoundException('学生不存在');
    }

    const guardians = await this.directory.guardiansOfStudent(studentUserId);

    const studentRow = (await this.getRoster(teacherUserId)).find((row) => row.studentId === studentUserId);
    if (!studentRow || !this.learningStore) throw new NotFoundException('学生数据不可用');
    const projects = await this.learningStore.listProjectsByStudent(studentUserId);
    const growth = this.growth ? await this.growth.getParentPage(studentUserId,
      { type: 'all', projectId: null, from: null, to: null, cursor: null, limit: 6 }) : null;

    return {
      student: studentRow,
      projects: projects.map((project) => ({ projectId: project.id, title: project.title, stage: project.status, progressPercent: project.progressPercent, updatedAt: project.createdAt.toISOString() })),
      interventions: (await this.listInterventions(teacherUserId)).filter(row => row.studentId === studentUserId),
      recentGrowth: growth?.timeline.items.map(entry => ({ id: entry.id, occurredAt: entry.occurredAt, title: entry.title, summary: entry.summaryParent })) ?? [],
      guardians: guardians.map((g) => ({
        userId: g.userId,
        displayName: g.displayName,
        relationship: 'guardian',
      })),
      sessionsThisWeek: studentRow.activity?.sessionsThisWeek ?? 0,
      minutesThisWeek: studentRow.activity?.minutesThisWeek ?? 0,
    };
  }

  /** Return the latest server-owned Team Run for a currently assigned student. */
  async getStudentAgentRuns(
    teacherUserId: string,
    studentUserId: string,
  ): Promise<TeacherAgentRunProjection> {
    await this.assertTeacherCanAccessStudent(teacherUserId, studentUserId);
    if (this.teamRuntime !== undefined) {
      return this.teamRuntime.getLatestRunProjection(studentUserId);
    }
    return {
      runId: null,
      status: 'idle',
      nodes: [],
      activity: [],
      generatedAt: null,
    };
  }

  /**
   * List interventions for this teacher's students.
   */
  async listInterventions(teacherUserId: string): Promise<TeacherInterventionRow[]> {
    if (!this.interventions) return [];
    return this.interventions.list(teacherUserId);
  }

  /**
   * Get one intervention detail. Enforces that the student is assigned to this teacher.
   */
  async getInterventionDetail(teacherUserId: string, interventionId: string): Promise<TeacherInterventionDetail> {
    const intervention = (await this.listInterventions(teacherUserId)).find(row => row.id === interventionId);
    if (!intervention) throw new NotFoundException('学习支持请求不存在');
    const student = (await this.getRoster(teacherUserId)).find(row => row.studentId === intervention.studentId);
    if (!student) throw new NotFoundException('学习支持请求不存在');
    return { intervention, student, diagnostic: '学生的项目中存在服务端记录的协助请求。',
      suggestion: '先了解孩子尝试过哪些方法，再一起确定一个可以验证的小步骤。',
      suggestedPrompt: '你已经尝试了哪些方法？哪一步最希望我们一起看看？' };
  }

  /**
   * Record an action on an intervention.
   */
  async recordInterventionAction(
    teacherUserId: string,
    interventionId: string,
    action: TeacherInterventionAction,
    note: string | null = null,
  ): Promise<TeacherInterventionActionResponse> {
    if (!this.interventions) throw new ServiceUnavailableException('学习支持服务暂不可用');
    return this.interventions.act(teacherUserId, interventionId, action, note);
  }

  /**
   * 班主任对一条复核记录落定决定（T20）。
   *
   * 这是 `mentor_reviews.status='approved'` 的全仓**唯一**写入点，而
   * `review_completed_and_archived` 门禁（作品发布分支）正好依赖它，
   * 所以本方法是那整条链的前提。
   *
   * 服务端强制顺序（前端隐藏按钮不算授权，AGENTS.md 硬约束）：
   * 1. 复核不存在 → 404；
   * 2. 调用者不是该复核行的 `mentorUserId` 本人 → 403（不泄露归属者是谁）；
   * 3. 调用者必须仍是该生 `mentor_assignments.status='active'` 的当前班主任
   *    → 否则 403 `STUDENT_NOT_ASSIGNED`（换了班主任后旧班主任不能再批）；
   * 4. 已终态：同决定 → 幂等重放（不写库、不写审计）；不同决定 → 409；
   * 5. 写入走 CAS（`WHERE status = 旧值`）：并发下只有一个能成功，失败者重读后
   *    要么幂等重放、要么 409，**绝不第二次写**；
   * 6. 审计与业务写入在同一事务里（见 `PostgresTeacherReviewRepository`）。
   *
   * 归属字段（`studentUserId` / `mentorUserId` / `projectId` / `kind` /
   * `artifactRef`）一律从复核行读——方法签名里就没有它们，客户端无法直写。
   */
  async requireAssignedReview(actor: CurrentUser, reviewId: string): Promise<TeacherReviewRecord> {
    if (!this.reviews) throw new ServiceUnavailableException({ code: TEACHER_REVIEW_ERROR_CODES.UNAVAILABLE, message: '复核存储不可用' });
    const review = await this.reviews.findReviewById(reviewId);
    if (!review) throw new NotFoundException({ code: TEACHER_REVIEW_ERROR_CODES.NOT_FOUND, message: '复核记录不存在' });
    if (actor.role !== 'teacher' || review.mentorUserId !== actor.id) {
      throw new ForbiddenException({ code: TEACHER_REVIEW_ERROR_CODES.NOT_OWNER, message: '只能查看归属自己的复核记录' });
    }
    await this.assertTeacherCanAccessStudent(actor.id, review.studentUserId);
    return review;
  }

  async decideReview(
    actor: CurrentUser,
    reviewId: string,
    input: TeacherReviewDecisionRequest,
  ): Promise<TeacherReviewDecisionResponse> {
    throw new ForbiddenException({ code: 'TEACHER_LEARNING_READ_ONLY', message: '教师只读学习记录与问题，作品由服务端自动评价。' });
  }

  /**
   * Get statistics for this teacher's roster.
   */
  async getStatistics(teacherUserId: string): Promise<TeacherStatisticsPageData> {
    const teacher = await this.getTeacherIdentity(teacherUserId);
    const students = await this.getRoster(teacherUserId);
    if (!this.learningStore) throw new ServiceUnavailableException('项目统计暂不可用');
    const projects = (await Promise.all(students.map((student) => this.learningStore!.listProjectsByStudent(student.studentId)))).flat();
    const stageDistribution = countStages(projects.filter(project => project.status !== 'exploration').map((project) => project.status));
    const interventions = await this.listInterventions(teacherUserId);

    return {
      teacher,
      totals: {
        studentCount: students.length,
        activeStudentCount: students.filter((student) => student.activeDays > 0).length,
        sessionsThisWeek: students.reduce((sum, student) => sum + (student.activity?.sessionsThisWeek ?? 0), 0),
        minutesThisWeek: students.reduce((sum, student) => sum + (student.activity?.minutesThisWeek ?? 0), 0),
        tasksCompletedThisWeek: students.reduce((sum, student) => sum + student.weeklyTasks, 0),
        openInterventions: interventions.filter(row => row.status !== 'resolved').length,
      },
      weeklyActivity: buildWeeklyActivity(students),
      stageDistribution,
      needsAttention: students.filter((student) => student.stuck || student.attentionCount > 0),
      dataSource: 'live',
      signalsAvailable: students.every(student => student.signalsAvailable === true),
    };
  }
}

/**
 * 复核行 → 响应投影。字段一律来自服务端行本身（回显是为了让前端能自证
 * “没有越权改写归属”），`idempotentReplay` 标记本次是否未写库未写审计。
 */
function toDecisionResponse(review: TeacherReviewRecord, idempotentReplay: boolean): TeacherReviewDecisionResponse {
  return {
    reviewId: review.id,
    studentUserId: review.studentUserId,
    mentorUserId: review.mentorUserId,
    projectId: review.projectId,
    artifactRef: review.artifactRef,
    kind: review.kind,
    status: review.status as TeacherReviewDecision,
    decision: review.decision as TeacherReviewDecision,
    comment: review.comment,
    requestedAt: review.requestedAt.toISOString(),
    reviewedAt: (review.reviewedAt ?? review.updatedAt).toISOString(),
    updatedAt: review.updatedAt.toISOString(),
    idempotentReplay,
  };
}

function isWithinDays(value: string, days: number): boolean {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const age = Date.now() - timestamp;
  return age >= 0 && age <= days * 24 * 60 * 60 * 1000;
}

function countStages(stages: ProjectStage[]): { stage: ProjectStage; count: number }[] {
  const order: ProjectStage[] = [
    'exploration',
    'intent_confirmed',
    'theory_learning',
    'theory_check',
    'practice_ready',
    'practice_building',
    'artifact_review',
    'reflection',
    'published',
    'completed',
  ];
  return order
    .map((stage) => ({ stage, count: stages.filter((candidate) => candidate === stage).length }))
    .filter((item) => item.count > 0);
}

function buildWeeklyActivity(
  students: TeacherStudentRow[],
): { weekLabel: string; activeStudents: number; tasksCompleted: number }[] {
  const dates = [...new Set(students.flatMap(student => student.activity?.daily.map(day => day.date) ?? []))].sort();
  return dates.map(key => {
    return {
      weekLabel: `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`,
      activeStudents: students.filter(student => student.activity?.daily.some(day => day.date === key && day.sessions > 0)).length,
      tasksCompleted: students.reduce((sum, student) => sum + (student.activity?.daily.find(day => day.date === key)?.completedSessions ?? 0), 0),
    };
  });
}
