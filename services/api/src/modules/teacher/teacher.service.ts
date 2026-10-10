import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { mentorReviews, withTransaction, type Database } from '@qitu/database';
import { DirectoryService } from '../directory/directory.service';
import { PlatformDataService } from '../platform-data/platform-data.service';
import { TeamRuntimeService, type TeacherAgentRunProjection } from '../team-runtime/team-runtime.service';
import type { AuditEntry } from '../../common/audit/audit-entry';
import type { AuditWriter } from '../../common/audit/audit.service';
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

  constructor(private readonly audit?: AuditWriter) {
    super();
  }

  /** 测试 / demo 种子。 */
  seed(review: TeacherReviewRecord): void {
    this.rows.set(review.id, { ...review });
  }

  async findReviewById(reviewId: string): Promise<TeacherReviewRecord | null> {
    const row = this.rows.get(reviewId);
    return row === undefined ? null : { ...row };
  }

  async applyDecision(input: ApplyReviewDecisionInput): Promise<ApplyReviewDecisionResult> {
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
  ) {}

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

    return students.map((s) => {
      const demo = this.platformData.getStudent(s.userId);
      const projects = this.platformData.getProjectsByStudent(s.userId);
      const activeProjects = projects.filter(
        (project) => project.stage !== 'completed' && project.stage !== 'published',
      );
      const current = activeProjects[0] ?? projects[0] ?? null;
      const activeDays = demo?.lastActivityAt
        ? isWithinDays(demo.lastActivityAt, 7)
          ? 1
          : 0
        : 0;
      return {
        studentId: s.userId,
        displayName: s.displayName,
        email: s.email,
        gradeLabel: demo?.gradeLabel ?? null,
        classLabel: demo?.classLabel ?? null,
        avatarInitial: s.displayName.charAt(0),
        activeProjectCount: demo?.activeProjectCount ?? activeProjects.length,
        projectsCompleted:
          demo?.projectsCompleted ?? projects.filter((project) => project.stage === 'completed' || project.stage === 'published').length,
        currentProjectId: current?.projectId ?? demo?.currentProjectId ?? null,
        currentProjectTitle: current?.title ?? demo?.currentProjectTitle ?? null,
        currentStage: current?.stage ?? demo?.currentStage ?? null,
        progressPercent: current?.progressPercent ?? demo?.progressPercent ?? 0,
        lastActivityAt: demo?.lastActivityAt ?? null,
        stuck: demo?.stuck ?? false,
        attentionCount: demo?.attentionCount ?? 0,
        guardianCount: guardianCounts.get(s.userId) ?? 0,
        activeDays,
        weeklyTasks: 0,
      };
    });
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

    const studentRow: TeacherStudentRow = {
      studentId: student.userId,
      displayName: student.displayName,
      email: student.email,
      gradeLabel: null,
      classLabel: null,
      avatarInitial: student.displayName.charAt(0),
      activeProjectCount: 0,
      projectsCompleted: 0,
      currentProjectId: null,
      currentProjectTitle: null,
      currentStage: null,
      progressPercent: 0,
      lastActivityAt: null,
      stuck: false,
      attentionCount: 0,
      guardianCount: guardians.length,
      activeDays: 0,
      weeklyTasks: 0,
    };

    return {
      student: studentRow,
      projects: [],
      interventions: [],
      recentGrowth: [],
      guardians: guardians.map((g) => ({
        userId: g.userId,
        displayName: g.displayName,
        relationship: 'guardian' as any,
      })),
      sessionsThisWeek: 0,
      minutesThisWeek: 0,
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
    const students = await this.directory.studentsOfMentor(teacherUserId);

    // Demo: no interventions yet
    return [];
  }

  /**
   * Get one intervention detail. Enforces that the student is assigned to this teacher.
   */
  async getInterventionDetail(teacherUserId: string, interventionId: string): Promise<TeacherInterventionDetail> {
    // Demo: no interventions exist
    throw new NotFoundException('干预记录不存在');
  }

  /**
   * Record an action on an intervention.
   */
  async recordInterventionAction(
    teacherUserId: string,
    interventionId: string,
    action: TeacherInterventionAction,
  ): Promise<TeacherInterventionActionResponse> {
    // Demo: no interventions exist
    throw new NotFoundException('干预记录不存在');
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
  async decideReview(
    actor: CurrentUser,
    reviewId: string,
    input: TeacherReviewDecisionRequest,
  ): Promise<TeacherReviewDecisionResponse> {
    const store = this.reviews;
    if (store === undefined) {
      throw new ServiceUnavailableException({
        code: TEACHER_REVIEW_ERROR_CODES.UNAVAILABLE,
        message: '复核存储不可用',
      });
    }

    const review = await store.findReviewById(reviewId);
    if (review === null) {
      throw new NotFoundException({
        code: TEACHER_REVIEW_ERROR_CODES.NOT_FOUND,
        message: '复核记录不存在',
      });
    }

    // 2. 必须是该复核的归属班主任本人。
    if (review.mentorUserId !== actor.id) {
      throw new ForbiddenException({
        code: TEACHER_REVIEW_ERROR_CODES.NOT_OWNER,
        message: '只能审批归属子自己的复核记录',
      });
    }

    // 3. 必须仍是该生的当前班主任（对象级权限，走关系真源）。
    await this.assertTeacherCanAccessStudent(actor.id, review.studentUserId);

    // 4. 终态不可篡改。
    if (TERMINAL_REVIEW_STATUSES.includes(review.status)) {
      if (review.status === input.decision) return toDecisionResponse(review, true);
      throw new ConflictException({
        code: TEACHER_REVIEW_ERROR_CODES.DECISION_CONFLICT,
        message: `复核已落定为「${review.status}」，不能改写为「${input.decision}」（需要新结论请另建复核）`,
      });
    }
    if (!DECIDABLE_REVIEW_STATUSES.includes(review.status)) {
      throw new ConflictException({
        code: TEACHER_REVIEW_ERROR_CODES.DECISION_CONFLICT,
        message: `当前复核状态（${review.status}）不允许落定决定`,
      });
    }

    const reviewedAt = new Date();
    // 空字符串归一为 null：不要把「没写反馈」存成空串，也不要存前后空白。
    const comment = input.comment === undefined || input.comment === null
      ? null
      : input.comment.trim() || null;

    const result = await store.applyDecision({
      reviewId,
      expectedStatus: review.status,
      status: input.decision,
      decision: input.decision,
      comment,
      reviewedAt,
      audit: {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'mentor_review.decision',
        targetType: 'mentor_review',
        targetId: reviewId,
        detail: {
          reviewId,
          studentUserId: review.studentUserId,
          kind: review.kind,
          decision: input.decision,
          previousStatus: review.status,
          // 未成年人数据最小化：不落任何学生原文，只记班主任自写反馈的长度。
          commentLength: comment === null ? 0 : comment.length,
        },
      },
    });

    if (result === 'stale') {
      // 并发：另一个请求已先落定。重读后按已有结果判定。
      const current = await store.findReviewById(reviewId);
      if (current === null) {
        throw new NotFoundException({
          code: TEACHER_REVIEW_ERROR_CODES.NOT_FOUND,
          message: '复核记录不存在',
        });
      }
      if (current.status === input.decision) return toDecisionResponse(current, true);
      throw new ConflictException({
        code: TEACHER_REVIEW_ERROR_CODES.DECISION_CONFLICT,
        message: `复核已被落定为「${current.status}」，本次决定（${input.decision}）被拒绝`,
      });
    }

    const updated = await store.findReviewById(reviewId);
    if (updated === null) {
      throw new ServiceUnavailableException({
        code: TEACHER_REVIEW_ERROR_CODES.UNAVAILABLE,
        message: '复核写入后读回失败',
      });
    }
    return toDecisionResponse(updated, false);
  }

  /**
   * Get statistics for this teacher's roster.
   */
  async getStatistics(teacherUserId: string): Promise<TeacherStatisticsPageData> {
    const teacher = await this.getTeacherIdentity(teacherUserId);
    const students = await this.getRoster(teacherUserId);
    const assignedIds = new Set(students.map((student) => student.studentId));
    const projects = [...assignedIds].flatMap((studentId) =>
      this.platformData.getProjectsByStudent(studentId),
    );
    const stageDistribution = countStages(projects.map((project) => project.stage));
    const interventions = this.platformData
      .getInterventionsByTeacher(teacherUserId)
      .filter((intervention) => intervention.status !== 'resolved');
    const weeklyActivity = buildWeeklyActivity(students);

    return {
      teacher,
      totals: {
        studentCount: students.length,
        activeStudentCount: students.filter((student) => student.activeDays > 0).length,
        sessionsThisWeek: 0,
        minutesThisWeek: 0,
        tasksCompletedThisWeek: students.reduce((sum, student) => sum + student.weeklyTasks, 0),
        openInterventions: interventions.length,
      },
      weeklyActivity,
      stageDistribution,
      needsAttention: students.filter((student) => student.stuck || student.attentionCount > 0),
      dataSource: 'demo',
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
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return {
      weekLabel: `${date.getMonth() + 1}/${date.getDate()}`,
      activeStudents: students.filter((student) => student.lastActivityAt?.slice(0, 10) === key).length,
      tasksCompleted: 0,
    };
  });
}
