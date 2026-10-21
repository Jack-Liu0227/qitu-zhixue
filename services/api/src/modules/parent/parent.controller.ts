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

    const student = await this.directory.findUser(childId);
    if (!student) throw new ForbiddenException('无权查看该孩子的数据');
    if (!this.learningStore || !this.worksService) throw new ServiceUnavailableException('学习数据暂不可用');
    const projects = await this.learningStore.listProjectsByStudent(childId);
    const current = currentStudentProject(projects);
    const summary = this.growthService.getSummary(childId);
    // Works owner limits parent visibility; only its authorized projection is composed here.
    const artifacts = (await this.worksService.listArtifacts(user, {})).filter((item) => item.studentId === childId);
    return { data: {
      childId, childDisplayName: student.displayName,
      kpis: [
        { id: 'weekly_sessions', label: '本周学习次数', value: '暂未接入', hint: '学习次数统计尚不可用', trend: 'flat' },
        { id: 'weekly_minutes', label: '本周学习时长', value: '暂未接入', hint: '学习时长统计尚不可用', trend: 'flat' },
        { id: 'current_progress', label: '当前项目进度', value: current ? `${current.progressPercent}%` : '未开始', hint: '服务端项目阶段进度，不代表知识掌握比例', trend: 'flat' },
        { id: 'streak', label: '连续成长记录天数', value: `${summary.streakDays} 天`, hint: '来自已确认的成长档案', trend: 'flat' },
      ],
      currentProject: current ? {
        projectId: current.id, title: current.title, summary: '',
        stage: current.status, stageLabel: projectStageLabel(current.status), progressPercent: current.progressPercent,
        todayTask: null, lastCompleted: null, nextStep: null,
      } : null,
      attention: [], suggestedQuestion: current ? { text: '今天的探究中，你发现了什么有趣的问题？', projectTitle: current.title } : null,
      weeklySummary: { completed: [], praised: [], growing: [] },
      recentArtifacts: artifacts.slice(0, 3).map((item) => ({ artifactRef: item.id, title: item.title, createdAt: item.createdAt })),
      hasAnyProject: projects.length > 0, dataSource: 'live',
    } };
  }

  /**
   * 学习进展：作品列表、焦点作品、成长标注、版本时间线。
   */
  @Get('children/:childId/progress')
  async getProgress(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('childId') childId: string,
  ): Promise<{ data: ParentProgressPageData }> {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该视图仅向家长开放');
    await this.assertParentCanReadChild(user.id, childId);

    // 身份（含展示名）取自目录这个唯一真源。
    const student = await this.directory.findUser(childId);
    if (student === null) throw new ForbiddenException('无权查看该孩子的数据');

    if (!this.worksService || !this.learningStore) throw new ServiceUnavailableException('作品数据暂不可用');
    const artifacts = (await this.worksService.listArtifacts(user, {})).filter((item) => item.studentId === childId);
    const projects = await this.learningStore.listProjectsByStudent(childId);
    const works: ParentWorkItem[] = artifacts.map((artifact) => ({
      artifactRef: artifact.id, title: artifact.title, summary: artifact.summary,
      status: artifact.status === 'published' ? 'completed' : artifact.status === 'draft' ? 'draft' : 'in_progress',
      versionLabel: artifact.versionCount ? `V${artifact.currentVersionIndex}` : null,
      progressPercent: projects.find((project) => project.id === artifact.projectId)?.progressPercent ?? 0,
      tags: artifact.tags, updatedAt: artifact.updatedAt,
    }));
    const focusWork = works.find((work) => work.status === 'in_progress') ?? works[0] ?? null;
    // Version notes and source files are not part of the minimal parent projection.
    return { data: { childId, works, focusWork, focusGrowth: null, focusVersions: [], dataSource: 'live' } };
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

    // 身份（含展示名）取自目录这个唯一真源。
    const student = await this.directory.findUser(childId);
    if (student === null) throw new ForbiddenException('无权查看该孩子的数据');

    const messagesAvailable = this.directory.allowsDemoLogin();
    const demoMessages = messagesAvailable ? this.platformData.getMessagesByChild(childId) : [];
    // 服务工单来自统一反馈服务，不再直读 platform-data（那里已经不再维护工单）。
    const feedbackTickets = await this.feedbackService.listForParent(user.id, childId);

    // 消息列表
    const messages: ParentMessage[] = demoMessages.map((m) => {
      const focus: ParentMessageFocus | null = m.hasFocus
        ? {
            headline: m.title,
            occurredAt: m.occurredAt,
            projectTitle: m.projectTitle,
            whatHappened: `${student.displayName}已 7 天未与 AI搭档互动，可能遇到了困难或失去了兴趣。`,
            whatSystemDid: 'AI搭档已尝试发送提醒，班主任也收到了通知。',
            needParent: true,
            needParentNote: '这个阶段孩子可能需要您的鼓励和陪伴。',
            howYouCanHelp: '您可以和孩子聊聊项目进展，了解是否遇到困难，或者给孩子一句鼓励。',
            timeline: [
              { label: 'AI搭档发现', at: m.occurredAt, state: 'done' },
              { label: '通知班主任', at: m.occurredAt, state: 'done' },
              { label: '等待家长确认', at: null, state: 'current' },
              { label: '持续观察', at: null, state: 'future' },
            ],
          }
        : null;

      return {
        id: m.id,
        kind: m.kind,
        title: m.title,
        summary: m.summary,
        occurredAt: m.occurredAt,
        status: m.status,
        projectTitle: m.projectTitle,
        focus,
      };
    });

    // 服务工单
    const tickets: ParentServiceTicket[] = feedbackTickets.map((t) => ({
      id: t.id,
      problem: t.problem,
      projectTitle: t.projectTitle,
      owner: t.owner ?? '待分配',
      status: t.status === 'resolved' ? 'resolved' : 'processing',
      handledIn: t.handledIn,
    }));

    // 消息汇总
    const summary: ParentMessagesSummary = {
      total: messages.length,
      pendingConfirm: messages.filter((m) => m.status === 'pending_confirm').length,
      processing: messages.filter((m) => m.status === 'processing').length,
      resolved: messages.filter((m) => m.status === 'resolved').length,
    };

    return {
      data: {
        childId,
        summary,
        messages,
        tickets,
        dataSource: messagesAvailable ? 'demo' : 'live',
        messagesAvailable,
      },
    };
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

    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<SendEncouragementRequest>(body, ['message']);
    const message = input.message?.trim() ?? '';

    // 校验：长度 1..200
    if (message.length === 0 || message.length > 200) {
      throw new BadRequestException({
        code: 'ENCOURAGEMENT_INVALID',
        message: '鼓励内容长度必须在 1 到 200 字之间',
      });
    }

    // 记录（幂等）
    const record = this.platformData.recordEncouragement(user.id, childId, message, idempotencyKey);
    if (record === null) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '该幂等键已被使用',
      });
    }

    return {
      data: {
        id: record.id,
        sentAt: record.sentAt,
        delivered: record.delivered,
      },
    };
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

    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<ParentMessageAckRequest>(body, ['action']);
    if (input.action !== 'read' && input.action !== 'mute') {
      throw new BadRequestException('action 必须是 read 或 mute');
    }

    const message = this.platformData.getMessage(messageId);
    if (message === null || message.childId !== childId) {
      throw new ConflictException({
        code: 'MESSAGE_ACTION_NOT_APPLICABLE',
        message: '消息不存在或不属于该孩子',
      });
    }

    const success = this.platformData.ackMessage(messageId, input.action);
    if (!success) {
      throw new ConflictException({
        code: 'MESSAGE_ACTION_NOT_APPLICABLE',
        message: '该消息当前状态不支持此操作',
      });
    }

    return {
      data: {
        messageId,
        status: input.action === 'read' ? 'resolved' : 'processing',
        ackedAt: new Date().toISOString(),
      },
    };
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
