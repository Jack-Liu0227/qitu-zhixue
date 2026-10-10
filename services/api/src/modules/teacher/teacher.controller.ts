import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import type {
  TeacherRosterPageData,
  TeacherStudentDetail,
  TeacherInterventionListPageData,
  TeacherInterventionDetail,
  TeacherInterventionActionRequest,
  TeacherInterventionActionResponse,
  TeacherReviewDecision,
  TeacherReviewDecisionRequest,
  TeacherReviewDecisionResponse,
  TeacherStatisticsPageData,
  TeacherFeedbackListPageData,
  TeacherFeedbackDetail,
  ReplyTeacherFeedbackRequest,
} from '@qitu/contracts';
import {
  TeacherService,
  TEACHER_REVIEW_ERROR_CODES,
  REVIEW_DECISION_VALUES,
  MAX_TEACHER_REVIEW_COMMENT_LENGTH,
} from './teacher.service';
import { requireRole, pickFields } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { FeedbackService } from '../feedback/feedback.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import type { TeacherAgentRunProjection } from '../team-runtime/team-runtime.service';

/**
 * Teacher controller: roster, student detail, interventions, statistics, feedback.
 *
 * 所有端点都要求 `role === 'teacher'`，因此管理员（`admin`）调用这些日常操作
 * 接口会被后端直接 403（ADR 0008：个别学生的日常处理归班主任，管理员不代做）。
 * 角色闸门之外还有对象级授权：只能访问自己名下的学生，见
 * `TeacherService.assertTeacherCanAccessStudent`。
 */
/**
 * 解析并严格校验复核决定请求体（`assertKnownKeys` 风格）。
 *
 * 白名单以外的一切键都拒：这既挡住客户端直写归属字段（`studentUserId` /
 * `mentorUserId` / `projectId` / `kind` / `artifactRef`），也挡住把幂等键
 * 放进 body 的写法（键只走 HTTP 头）。未知键不能“静警”，否则下一轮
 * 接入的客户端会误以为自写身份字段生效了。
 */
export function parseReviewDecisionInput(body: unknown): TeacherReviewDecisionRequest {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException({
      code: TEACHER_REVIEW_ERROR_CODES.REQUEST_INVALID,
      message: '请求体必须是对象',
    });
  }
  const value = body as Record<string, unknown>;
  const allowed = ['decision', 'comment'];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new BadRequestException({
        code: TEACHER_REVIEW_ERROR_CODES.REQUEST_INVALID,
        message: `请求体包含不可写字段 "${key}"`,
      });
    }
  }

  const decision = value.decision;
  if (typeof decision !== 'string'
    || !REVIEW_DECISION_VALUES.includes(decision as TeacherReviewDecision)) {
    throw new BadRequestException({
      code: TEACHER_REVIEW_ERROR_CODES.REQUEST_INVALID,
      message: 'decision 必须为 approved | changes_requested | rejected',
    });
  }

  let comment: string | null | undefined;
  if (value.comment !== undefined && value.comment !== null) {
    if (typeof value.comment !== 'string') {
      throw new BadRequestException({
        code: TEACHER_REVIEW_ERROR_CODES.REQUEST_INVALID,
        message: 'comment 必须是字符串或 null',
      });
    }
    if (value.comment.length > MAX_TEACHER_REVIEW_COMMENT_LENGTH) {
      throw new BadRequestException({
        code: TEACHER_REVIEW_ERROR_CODES.REQUEST_INVALID,
        message: `comment 不能超过 ${MAX_TEACHER_REVIEW_COMMENT_LENGTH} 个字符`,
      });
    }
    comment = value.comment;
  }

  return { decision: decision as TeacherReviewDecisionRequest['decision'], comment };
}

@Controller('teacher')
export class TeacherController {
  constructor(
    private readonly teacherService: TeacherService,
    private readonly authService: AuthService,
    private readonly feedbackService: FeedbackService,
    private readonly idempotency: IdempotencyStore,
  ) {}

  @Get('roster')
  async getRoster(
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<{ data: TeacherRosterPageData }> {
    const user = requireRole(this.authService, cookieHeader, 'teacher', '该操作仅向班主任开放');

    const teacher = await this.teacherService.getTeacherIdentity(user.id);
    const students = await this.teacherService.getRoster(user.id);

    const stuckCount = students.filter((s) => s.stuck).length;
    const attentionCount = students.filter((s) => s.attentionCount > 0).length;
    const withoutGuardianCount = students.filter((s) => s.guardianCount === 0).length;

    return {
      data: {
        teacher,
        students,
        totals: {
          studentCount: students.length,
          stuckCount,
          attentionCount,
          withoutGuardianCount,
        },
        dataSource: 'demo',
      },
    };
  }

  @Get('students/:studentId')
  async getStudentDetail(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('studentId') studentId: string,
  ): Promise<{ data: TeacherStudentDetail }> {
    const user = requireRole(this.authService, cookieHeader, 'teacher', '该操作仅向班主任开放');

    const detail = await this.teacherService.getStudentDetail(user.id, studentId);

    return { data: detail };
  }

  @Get('students/:studentId/agent-runs')
  async getStudentAgentRuns(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('studentId') studentId: string,
  ): Promise<{ data: TeacherAgentRunProjection }> {
    const user = requireRole(this.authService, cookieHeader, 'teacher', '教师权限不足');
    const data = await this.teacherService.getStudentAgentRuns(user.id, studentId);
    return { data };
  }

  @Get('interventions')
  async listInterventions(
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<{ data: TeacherInterventionListPageData }> {
    const user = requireRole(this.authService, cookieHeader, 'teacher', '该操作仅向班主任开放');

    const items = await this.teacherService.listInterventions(user.id);

    return {
      data: {
        items,
        totals: {
          open: 0,
          acknowledged: 0,
          resolved: 0,
        },
        dataSource: 'demo',
      },
    };
  }

  @Get('interventions/:id')
  async getInterventionDetail(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: TeacherInterventionDetail }> {
    const user = requireRole(this.authService, cookieHeader, 'teacher', '该操作仅向班主任开放');

    const detail = await this.teacherService.getInterventionDetail(user.id, id);

    return { data: detail };
  }

  @Post('interventions/:id/actions')
  async recordInterventionAction(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ data: TeacherInterventionActionResponse }> {
    const user = requireRole(this.authService, cookieHeader, 'teacher', '该操作仅向班主任开放');

    const input = pickFields<TeacherInterventionActionRequest>(body, ['action', 'note']);

    if (!input.action) {
      throw new BadRequestException('action is required');
    }

    // 契约里的 TeacherInterventionAction 是 TS 类型，运行时不存在。
    // 不校验就把它透传给服务层，将来服务层一旦不再无条件抛错，
    // 任意字符串都会变成一条“已处理”记录。
    if (input.action !== 'acknowledge' && input.action !== 'resolve') {
      throw new BadRequestException('action 必须为 acknowledge 或 resolve');
    }

    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0 || idempotencyKey.length > 160) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少或无效的 Idempotency-Key 请求头' });
    }
    const scope = `teacher.intervention.action:${id}`;
    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        hashIdempotentInput(scope, { interventionId: id }, input),
        async () => ({ status: 200, body: await this.teacherService.recordInterventionAction(user.id, id, input.action!) }),
      );
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /**
   * 班主任落定复核决定。
   *
   * 口径与本文件其他写接口一致：
   * - 角色闸门 `requireRole('teacher')`，对象级权限在服务层再查（AGENTS.md：
   *   前端权限只负责显示）；
   * - 幂等键**只从 `Idempotency-Key` 请求头取**，body 里出现 `idempotencyKey`
   *   会被当成未知键拒掉（400，且 0 写入）；
   * - 请求体只允许 `decision` / `comment`；`studentUserId` / `mentorUserId` /
   *   `projectId` / `kind` / `artifactRef` 等归属字段由服务端从复核行读，
   *   客户端一律不可写。
   */
  @Post('reviews/:reviewId/decision')
  @HttpCode(200)
  async decideReview(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('reviewId') reviewId: string,
    @Body() body: unknown,
  ): Promise<{ data: TeacherReviewDecisionResponse }> {
    const user = requireRole(this.authService, cookieHeader, 'teacher', '该操作仅向班主任开放');

    // 取键在解析之前：缺键 → 400，不进入任何业务写入。
    const key = idempotencyKey?.trim();
    if (key === undefined || key.length === 0 || key.length > 160) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '缺少或无效的 Idempotency-Key 请求头',
      });
    }

    const input = parseReviewDecisionInput(body);
    const scope = `teacher.review.decision:${reviewId}`;
    try {
      const result = await this.idempotency.execute(
        scope,
        key,
        hashIdempotentInput(scope, { actorId: user.id, reviewId }, input),
        async () => ({
          status: 200,
          body: await this.teacherService.decideReview(user, reviewId, input),
        }),
      );
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  @Get('statistics')
  async getStatistics(
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<{ data: TeacherStatisticsPageData }> {
    const user = requireRole(this.authService, cookieHeader, 'teacher', '该操作仅向班主任开放');

    const stats = await this.teacherService.getStatistics(user.id);

    return { data: stats };
  }

  /** 家长反馈工单列表，只含当前班主任名下的学生。 */
  @Get('feedback')
  async listFeedback(
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<{ data: TeacherFeedbackListPageData }> {
    const user = requireRole(this.authService, cookieHeader, 'teacher', '该操作仅向班主任开放');

    const items = await this.feedbackService.listForTeacher(user.id);

    return {
      data: {
        items,
        totals: {
          processing: items.filter((i) => i.status === 'processing' || i.status === 'reopened')
            .length,
          replied: items.filter((i) => i.status === 'replied').length,
          resolved: items.filter((i) => i.status === 'resolved').length,
        },
        dataSource: 'demo',
      },
    };
  }

  /** 单条反馈工单详情；非本班学生返回 403 `STUDENT_NOT_ASSIGNED`。 */
  @Get('feedback/:ticketId')
  async getFeedback(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('ticketId') ticketId: string,
  ): Promise<{ data: TeacherFeedbackDetail }> {
    const user = requireRole(this.authService, cookieHeader, 'teacher', '该操作仅向班主任开放');

    const ticket = await this.feedbackService.getForTeacher(user.id, ticketId);

    return { data: { ticket } };
  }

  /** 班主任公开回复；已解决的工单需家长先重新打开。 */
  @Post('feedback/:ticketId/replies')
  @HttpCode(200)
  async replyFeedback(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('ticketId') ticketId: string,
    @Body() body: unknown,
  ): Promise<{ data: TeacherFeedbackDetail }> {
    const user = requireRole(this.authService, cookieHeader, 'teacher', '该操作仅向班主任开放');

    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<ReplyTeacherFeedbackRequest>(body, ['content', 'attachmentRefs']);
    const ticket = await this.feedbackService.replyToFeedback(
      user.id,
      ticketId,
      input,
      idempotencyKey,
    );

    return { data: { ticket } };
  }
}
