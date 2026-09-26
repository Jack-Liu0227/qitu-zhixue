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
  ParentMessageTimelineStep,
} from '@qitu/contracts';
import { pickFields, requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { GrowthService } from '../growth/growth.service';
import { PlatformDataService } from '../platform-data/platform-data.service';

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
    private readonly growthService: GrowthService,
    private readonly platformData: PlatformDataService,
  ) {}

  /* ==================== 读接口 ==================== */

  /**
   * 首页：KPI、当前项目、需要关注、成长摘要、最近成果。
   */
  @Get('children/:childId/dashboard')
  getDashboard(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('childId') childId: string,
  ): { data: ParentHomePageData } {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该视图仅向家长开放');
    this.assertParentCanReadChild(user.id, childId);

    const student = this.platformData.getStudent(childId);
    if (student === null) throw new ForbiddenException('无权查看该孩子的数据');

    const summary = this.growthService.getSummary(childId);
    const projects = this.platformData.getProjectsByStudent(childId);
    const interventions = this.platformData.getInterventionsByStudent(childId);

    // KPI 四张卡
    const kpis: ParentKpi[] = [
      {
        id: 'weekly_sessions',
        label: '本周学习次数',
        value: '4 次',
        hint: '比上周多 1 次',
        trend: 'up',
      },
      {
        id: 'weekly_minutes',
        label: '本周学习时长',
        value: '3 小时 20 分',
        hint: null,
        trend: 'flat',
      },
      {
        id: 'current_progress',
        label: '当前项目进度',
        value: `${student.progressPercent}%`,
        hint: student.currentProjectTitle ?? null,
        trend: 'up',
      },
      {
        id: 'streak',
        label: '连续学习天数',
        value: `${summary.streakDays} 天`,
        hint: summary.streakDays >= 7 ? '坚持得很好' : null,
        trend: summary.streakDays > 0 ? 'up' : 'flat',
      },
    ];

    // 当前项目
    const currentProject: ParentCurrentProject | null = student.currentProjectId
      ? {
          projectId: student.currentProjectId,
          title: student.currentProjectTitle ?? '未命名项目',
          summary: '通过观察校园植物，学习记录方法和科学思维。',
          stage: student.currentStage ?? 'intent_confirmed',
          stageLabel: this.getStageLabel(student.currentStage),
          progressPercent: student.progressPercent,
          todayTask: student.stuck ? null : '继续观察记录，完成第 7 种植物',
          lastCompleted: '写下第一次观察反思',
          nextStep: '邀请同学一起扩充植物库',
        }
      : null;

    // 需要关注
    const attention: ParentAttentionItem[] = [];
    if (student.stuck) {
      attention.push({
        id: 'attention-stuck',
        level: 'attention',
        title: '需要您关注',
        detail: `${student.displayName}已 7 天未继续学习，可能需要您的鼓励。`,
      });
    }
    if (interventions.some((i) => i.status === 'open')) {
      attention.push({
        id: 'attention-intervention',
        level: 'info',
        title: '班主任正在关注',
        detail: '班主任已注意到孩子的学习状态，会主动联系您。',
      });
    }

    // 建议提问
    const suggestedQuestion: ParentSuggestedQuestion | null = student.currentProjectTitle
      ? {
          text: `${student.displayName}在做${student.currentProjectTitle}时，你觉得最有趣的是什么？`,
          projectTitle: student.currentProjectTitle,
        }
      : null;

    // 本周成长摘要
    const weeklySummary: ParentWeeklySummary = {
      completed: ['完成了 6 种植物的观察记录', '学会了用表格整理信息'],
      praised: ['主动提出好问题', '观察很细致'],
      growing: ['可以尝试加入季节对比', '邀请同学一起参与'],
    };

    // 最近成果
    const recentArtifacts: ParentRecentArtifact[] = [
      {
        artifactRef: 'artifact-demo-001',
        title: '校园植物观察手册',
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];

    return {
      data: {
        childId,
        childDisplayName: student.displayName,
        kpis,
        currentProject,
        attention,
        suggestedQuestion,
        weeklySummary,
        recentArtifacts,
        hasAnyProject: projects.length > 0,
        dataSource: 'demo',
      },
    };
  }

  /**
   * 学习进展：作品列表、焦点作品、成长标注、版本时间线。
   */
  @Get('children/:childId/progress')
  getProgress(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('childId') childId: string,
  ): { data: ParentProgressPageData } {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该视图仅向家长开放');
    this.assertParentCanReadChild(user.id, childId);

    const student = this.platformData.getStudent(childId);
    if (student === null) throw new ForbiddenException('无权查看该孩子的数据');

    const projects = this.platformData.getProjectsByStudent(childId);

    // 作品列表
    const works: ParentWorkItem[] = projects.map((p) => ({
      artifactRef: `artifact-${p.projectId}`,
      title: p.title,
      summary: '通过观察和记录，学习科学方法。',
      status: this.getWorkStatus(p.stage),
      versionLabel: p.stage === 'published' ? 'V3 完整版' : null,
      progressPercent: p.progressPercent,
      tags: ['观察记录', '科学思维'],
      updatedAt: p.updatedAt,
    }));

    // 焦点作品（当前项目）
    const focusWork = works.find((w) => w.status === 'in_progress') ?? null;

    // 焦点作品的成长标注
    const focusGrowth: ParentWorkGrowth | null = focusWork
      ? {
          independently: [
            '选择了 6 种校园植物',
            '拍摄并整理了观察照片',
            '记录了每周的生长变化',
          ],
          withAiHelp: [
            '学习了观察记录的要素',
            '理解了光合作用的条件',
            '优化了记录表格的结构',
          ],
          nextPlan: ['加入季节变化的对比', '邀请同学一起扩充植物库'],
        }
      : null;

    // 版本时间线
    const focusVersions: ParentVersionStep[] = focusWork
      ? this.platformData.getVersions(focusWork.artifactRef).map((v) => ({
          id: v.id,
          at: v.at,
          title: v.title,
          note: v.note,
        }))
      : [];

    return {
      data: {
        childId,
        works,
        focusWork,
        focusGrowth,
        focusVersions,
        dataSource: 'demo',
      },
    };
  }

  /**
   * 消息与反馈：消息列表、服务工单。
   */
  @Get('children/:childId/messages')
  getMessages(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('childId') childId: string,
  ): { data: ParentMessagesPageData } {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该视图仅向家长开放');
    this.assertParentCanReadChild(user.id, childId);

    const student = this.platformData.getStudent(childId);
    if (student === null) throw new ForbiddenException('无权查看该孩子的数据');

    const demoMessages = this.platformData.getMessagesByChild(childId);
    const demoTickets = this.platformData.getTicketsByChild(childId);

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
    const tickets: ParentServiceTicket[] = demoTickets.map((t) => ({
      id: t.id,
      problem: t.problem,
      projectTitle: t.projectTitle,
      owner: t.owner,
      status: t.status,
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
        dataSource: 'demo',
      },
    };
  }

  /* ==================== 写接口 ==================== */

  /**
   * 发送鼓励。
   * 要求 `Idempotency-Key` 头；同 key 重放返回第一次的结果。
   */
  @Post('children/:childId/encouragements')
  sendEncouragement(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('childId') childId: string,
    @Body() body: unknown,
  ): { data: SendEncouragementResponse } {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该操作仅向家长开放');
    this.assertParentCanReadChild(user.id, childId);

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
  ackMessage(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('childId') childId: string,
    @Param('messageId') messageId: string,
    @Body() body: unknown,
  ): { data: ParentMessageAckResponse } {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该操作仅向家长开放');
    this.assertParentCanReadChild(user.id, childId);

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
   */
  @Post('feedback')
  submitFeedback(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): { data: SubmitParentFeedbackResponse } {
    const user = requireRole(this.authService, cookieHeader, 'parent', '该操作仅向家长开放');

    if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '缺少 Idempotency-Key 请求头',
      });
    }

    const input = pickFields<SubmitParentFeedbackRequest>(body, [
      'source',
      'content',
      'messageId',
      'projectId',
    ]);

    const content = input.content?.trim() ?? '';
    if (content.length === 0 || content.length > 500) {
      throw new BadRequestException({
        code: 'FEEDBACK_INVALID',
        message: '反馈内容长度必须在 1 到 500 字之间',
      });
    }

    if (input.source === 'message' && !input.messageId) {
      throw new BadRequestException('source 为 message 时 messageId 必填');
    }

    if (input.source === 'project' && !input.projectId) {
      throw new BadRequestException('source 为 project 时 projectId 必填');
    }

    // 提取 childId（简化：从 messageId 或 projectId 推断；生产环境应从绑定关系查）
    const childId = 'student-demo'; // 演示简化

    const record = this.platformData.recordFeedback(
      user.id,
      childId,
      input.source ?? 'general',
      content,
      input.messageId ?? null,
      input.projectId ?? null,
      idempotencyKey,
    );

    if (record === null) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '该幂等键已被使用',
      });
    }

    return {
      data: {
        ticketId: record.id,
        status: 'processing',
        createdAt: record.createdAt,
      },
    };
  }

  /* ==================== 内部工具 ==================== */

  private assertParentCanReadChild(parentId: string, childId: string): void {
    if (!this.growthService.canParentReadChild(parentId, childId)) {
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
