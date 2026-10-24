import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Query,
  Post,
} from '@nestjs/common';
import type {
  ParentHomePageData,
  ParentKpi,
  ParentMessagesPageData,
  ParentProgressPageData,
  SendEncouragementRequest,
  SendEncouragementResponse,
  ParentMessageAckRequest,
  ParentMessageAckResponse,
  SubmitParentFeedbackRequest,
  SubmitParentFeedbackResponse,
  ParentCurrentProject,
  ParentAttentionItem,
  ParentSuggestedQuestion,
  ParentWeeklySummary,
  ParentRecentArtifact,
  ParentWorkItem,
  ParentWorkGrowth,
  ParentVersionStep,
  ParentMessage,
  ParentMessageFocus,
  ParentMessagesSummary,
  ParentServiceTicket,
  ParentFeedbackListResponse,
  ParentFeedbackDetailResponse,
  ParentFeedbackMutationResponse,
  SupplementParentFeedbackRequest,
  ConfirmParentFeedbackRequest,
  ParentGrowthExportRequest,
  ParentGrowthExportResponse,
  ParentGrowthExportDownloadResponse,
} from '@qitu/contracts';
import { pickFields, requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { DirectoryService } from '../directory/directory.service';
import { GrowthService } from '../growth/growth.service';
import { PlatformDataService } from '../platform-data/platform-data.service';
import { FeedbackService } from '../feedback/feedback.service';
import { ParentGrowthExportService } from './growth-export.service';
import { ParentAcceptedProfileService } from './accepted-profile.service';
import { Optional, ServiceUnavailableException } from '@nestjs/common';
import { LearningPlanStore } from '../learning-plan/learning-plan.store';
import { currentStudentProject } from '../projects/current-project';
import { WorksService } from '../works/works.service';
import { projectStageLabel } from '@qitu/contracts';
import { ParentLearningReadService } from './parent-learning-read.service';
import { ParentCommunicationService } from './parent-communication.service';

/**
 * 家长陪伴中心接口。
 *
 * 三条硬约束（freeze-parent-admin.md §1–§2）：
 *  1. **对象级权限在服务端再校验一次**：家长只能读自己绑定的孩子，
 *     前端隐藏不算数。每个 `:childId` 路由必须先调 `canParentReadChild`。
 *  2. **没有分数、排名、百分位、等级**。所有指标都是过程性的。
 *  3. **没有原始 AI 对话、没有内部风险标签**。给家长看的措辞由服务端预审。
 *
 * 全部写接口要求 `Idempotency-Key` 请求头；同 key 重放返回第一次的结果，
 * 不得产生第二条记录。
 */
@Controller('parent')
export class ParentController {
  constructor(
    private readonly authService: AuthService,
    private readonly directory: DirectoryService,
    private readonly growthService: GrowthService,
    private readonly platformData: PlatformDataService,
    private readonly feedbackService: FeedbackService,
    private readonly growthExportService: ParentGrowthExportService,
    @Optional() private readonly acceptedProfile?: ParentAcceptedProfileService,
    @Optional() private readonly learningStore?: LearningPlanStore,
    @Optional() private readonly worksService?: WorksService,
    @Optional() private readonly learningRead?: ParentLearningReadService,
    @Optional() private readonly communication?: ParentCommunicationService,
  ) {}

  /* ==================== 读接口 ==================== */

  @Get('children/:childId/profile')
  async getAcceptedProfile(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('childId') childId: string,
  ) {
    const actor = requireRole(this.authService, cookieHeader, 'parent', '该视图仅向家长开放');
    if (!this.acceptedProfile) throw new ServiceUnavailableException('成长摘要暂不可用');
    return { data: await this.acceptedProfile.read(actor, childId) };
  }

  /**
   * 首页：KPI、当前项目、需要关注、成长摘要、最近成果。
   */
  @Get('children/:childId/dashboard')
  async getDashboard(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('childId') childId: string,
  ): Promise<{ data: ParentHomePageData }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该视图仅向家长开放');
    await this.assertParentCanReadChild(user.id, childId);

    if (!this.learningRead) throw new ServiceUnavailableException('学习数据暂不可用');
    return { data: await this.learningRead.dashboard(user, childId) };
  }

  /**
   * 学习进展：作品列表、焦点作品、成长标注、版本时间线。
   */
  @Get('children/:childId/progress')
  async getProgress(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('childId') childId: string,
    @Query('artifactRef') artifactRef?: string,
  ): Promise<{ data: ParentProgressPageData }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该视图仅向家长开放');
    await this.assertParentCanReadChild(user.id, childId);

    if (!this.learningRead) throw new ServiceUnavailableException('作品数据暂不可用');
    return { data: await this.learningRead.progress(user, childId, artifactRef) };
  }

  /**
   * 消息与反馈：消息列表、服务工单。
   */
  @Get('children/:childId/messages')
  async getMessages(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('childId') childId: string,
  ): Promise<{ data: ParentMessagesPageData }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该视图仅向家长开放');
    await this.assertParentCanReadChild(user.id, childId);

    if (!this.learningRead) throw new ServiceUnavailableException('家庭消息暂不可用');
    return { data: await this.learningRead.messages(user, childId) };
  }

  /* ==================== 写接口 ==================== */

  /**
   * 发送鼓励。
   * 要求 `Idempotency-Key` 头；同 key 重放返回第一次的结果。
   */
  @Post('children/:childId/encouragements')
  async sendEncouragement(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('childId') childId: string,
    @Body() body: unknown,
  ): Promise<{ data: SendEncouragementResponse }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该操作仅向家长开放');
    await this.assertParentCanReadChild(user.id, childId);

    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0 || idempotencyKey.length > 160) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<SendEncouragementRequest>(body, ['message']);
    const message = typeof input.message === 'string' ? input.message.trim() : '';

    // 校验：长度 1..200
    if (message.length === 0 || message.length > 200) {
      throw new BadRequestException({
        code: 'ENCOURAGEMENT_INVALID',
        message: '鼓励内容长度必须在 1 到 200 字之间',
      });
    }

    if (!this.communication) throw new ServiceUnavailableException('家庭消息暂不可用');
    return { data: await this.communication.encourage(user, childId, message, idempotencyKey) };
  }

  /**
   * 确认消息（标记已读/暂不提醒）。
   */
  @Post('children/:childId/messages/:messageId/ack')
  @HttpCode(200)
  async ackMessage(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('childId') childId: string,
    @Param('messageId') messageId: string,
    @Body() body: unknown,
  ): Promise<{ data: ParentMessageAckResponse }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该操作仅向家长开放');
    await this.assertParentCanReadChild(user.id, childId);

    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0 || idempotencyKey.length > 160) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<ParentMessageAckRequest>(body, ['action']);
    if (input.action !== 'read' && input.action !== 'mute') {
      throw new BadRequestException('action 必须是 read 或 mute');
    }

    if (!this.communication || !this.learningRead) throw new ServiceUnavailableException('家庭消息暂不可用');
    const page = await this.learningRead.messages(user, childId);
    if (!page.messages.some(message => message.id === messageId)) {
      throw new ConflictException({ code: 'MESSAGE_ACTION_NOT_APPLICABLE', message: '消息不存在或不属于该孩子' });
    }
    return { data: await this.communication.acknowledge(user, childId, messageId, input.action, idempotencyKey) };
  }

  /**
   * 提交反馈。
   *
   * 目标孩子不再写死：关联孩子时服务端由 `childId` 或 message/project 推导并校验一致；
   * 一般使用问题可以不关联孩子，服务端会进入受限待分配队列；有关联孩子时再次校验家长绑定关系。
   */
  @Post('feedback')
  async submitFeedback(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<{ data: SubmitParentFeedbackResponse }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该操作仅向家长开放');

    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<SubmitParentFeedbackRequest>(body, [
      'source',
      'childId',
      'content',
      'messageId',
      'projectId',
      'attachmentRefs',
    ]);

    const ticket = await this.feedbackService.submitParentFeedback(user.id, input, idempotencyKey);

    return {
      data: {
        ticketId: ticket.id,
        status: 'processing',
        createdAt: ticket.createdAt,
      },
    };
  }

  /** 某孩子名下的全部反馈工单（家长必须绑定该孩子）。 */
  @Get('children/:childId/feedback')
  async listFeedback(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('childId') childId: string,
  ): Promise<{ data: ParentFeedbackListResponse }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该视图仅向家长开放');
    const tickets = await this.feedbackService.listForParent(user.id, childId);
    return { data: { tickets } };
  }

  /** 单条反馈工单详情（含完整时间线）。 */
  @Get('feedback/:ticketId')
  async getFeedback(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('ticketId') ticketId: string,
  ): Promise<{ data: ParentFeedbackDetailResponse }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该视图仅向家长开放');
    const ticket = await this.feedbackService.getForParent(user.id, ticketId);
    return { data: { ticket } };
  }

  /** 家长补充说明（追问）；已解决的工单需先重新打开。 */
  @Post('feedback/:ticketId/supplements')
  @HttpCode(200)
  async supplementFeedback(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('ticketId') ticketId: string,
    @Body() body: unknown,
  ): Promise<{ data: ParentFeedbackMutationResponse }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该操作仅向家长开放');
    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<SupplementParentFeedbackRequest>(body, ['content', 'attachmentRefs']);
    const ticket = await this.feedbackService.supplementParentFeedback(
      user.id,
      ticketId,
      input,
      idempotencyKey,
    );
    return { data: { ticket } };
  }

  /** 家长确认工单结果：`resolved=true` 关闭；`false` 重新打开。 */
  @Post('feedback/:ticketId/confirm')
  @HttpCode(200)
  async confirmFeedback(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('ticketId') ticketId: string,
    @Body() body: unknown,
  ): Promise<{ data: ParentFeedbackMutationResponse }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该操作仅向家长开放');
    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<ConfirmParentFeedbackRequest>(body, ['resolved', 'note']);
    const ticket = await this.feedbackService.confirmParentFeedback(
      user.id,
      ticketId,
      input,
      idempotencyKey,
    );
    return { data: { ticket } };
  }

  /**
   * 申请一次成长数据导出。
   *
   * 要求 `Idempotency-Key` 头；请求体必须同时确认 `confirmChildId`（与路径
   * `:childId` 一致）与 `confirmGuardianEmail`（与登录家长邮箱一致），否则 400。
   * 返回的是**任务元数据**，不含正文；正文通过下载接口读取。
   */
  @Post('children/:childId/growth-exports')
  async requestGrowthExport(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('childId') childId: string,
    @Body() body: unknown,
  ): Promise<{ data: ParentGrowthExportResponse }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该操作仅向家长开放');
    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<ParentGrowthExportRequest>(body, [
      'confirmChildId',
      'confirmGuardianEmail',
      'reason',
    ]);
    const job = await this.growthExportService.requestExport(user, childId, input, idempotencyKey);
    return { data: { job } };
  }

  /**
   * 下载导出正文。
   *
   * 每次下载都重新校验 active 监护关系：授权被撤销后返回 403，而不是空数据；
   * 过期返回 410；不属于当前家长的任务返回 404（不泄露存在性）。
   */
  @Get('growth-exports/:exportId/download')
  async downloadGrowthExport(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('exportId') exportId: string,
  ): Promise<{ data: ParentGrowthExportDownloadResponse }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该视图仅向家长开放');
    const document = await this.growthExportService.downloadExport(user, exportId);
    return { data: { document } };
  }

  /* ==================== 内部工具 ==================== */

  private async assertParentCanReadChild(parentId: string, childId: string): Promise<void> {
    if (!(await this.growthService.canParentReadChild(parentId, childId))) {
      throw new ForbiddenException('无权查看该孩子的数据');
    }
  }

  private getStageLabel(stage: string | null): string {
    const labels: Record<string, string> = {
      intent_confirmed: '确认方向',
      theory_learning: '理论学习',
      theory_check: '理论闯关',
      practice_ready: '实践准备',
      practice_building: '动手制作',
      reflection: '总结反思',
      published: '已发布',
      completed: '已完成',
    };
    return labels[stage ?? ''] ?? '进行中';
  }

  private getWorkStatus(stage: string): 'draft' | 'in_progress' | 'completed' {
    if (stage === 'published' || stage === 'completed') return 'completed';
    if (stage === 'intent_confirmed') return 'draft';
    return 'in_progress';
  }
}
