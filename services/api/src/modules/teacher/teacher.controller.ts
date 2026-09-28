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
  TeacherStatisticsPageData,
  TeacherSettingsPageData,
  TeacherFeedbackListPageData,
  TeacherFeedbackDetail,
  ReplyTeacherFeedbackRequest,
} from '@qitu/contracts';
import { TeacherService } from './teacher.service';
import { requireRole, pickFields } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { FeedbackService } from '../feedback/feedback.service';

/**
 * Teacher controller: roster, student detail, interventions, statistics, feedback.
 * All endpoints enforce object-level authorization via TeacherService / FeedbackService.
 */
@Controller('teacher')
export class TeacherController {
  constructor(
    private readonly teacherService: TeacherService,
    private readonly authService: AuthService,
    private readonly feedbackService: FeedbackService,
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

    const result = await this.teacherService.recordInterventionAction(user.id, id, input.action);

    return {
      data: result,
    };
  }

  @Get('statistics')
  async getStatistics(
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<{ data: TeacherStatisticsPageData }> {
    const user = requireRole(this.authService, cookieHeader, 'teacher', '该操作仅向班主任开放');

    const stats = await this.teacherService.getStatistics(user.id);

    return { data: stats };
  }

  @Get('settings')
  async getSettings(
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<{ data: TeacherSettingsPageData }> {
    const user = requireRole(this.authService, cookieHeader, 'teacher', '该操作仅向班主任开放');

    const settings = await this.teacherService.getSettings(user.id);

    return { data: settings };
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
