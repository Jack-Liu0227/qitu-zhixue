import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  ConfirmParentFeedbackRequest,
  ParentFeedbackEntry,
  ParentFeedbackEventKind,
  ParentFeedbackSource,
  ParentFeedbackStatus,
  ParentFeedbackTicket,
  ReplyTeacherFeedbackRequest,
  SubmitParentFeedbackRequest,
  SupplementParentFeedbackRequest,
  TeacherFeedbackRow,
} from '@qitu/contracts';
import { DirectoryService } from '../directory/directory.service';
import { PlatformDataService } from '../platform-data/platform-data.service';
import { FeedbackAttachmentRegistry } from './feedback.attachments';
import { DATA_MODE_TOKEN, type DataMode } from '../../database';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { AuditWriter } from '../../common/audit/audit.service';

/** 反馈内容长度上限，与家长端契约（≤500 字）保持一致。 */
export const FEEDBACK_CONTENT_MAX_LENGTH = 500;

/** `processing` 之后、未被家长确认解决之前，家长都可以继续补充。 */
const SUPPLEMENT_ALLOWED: readonly ParentFeedbackStatus[] = ['processing', 'replied', 'reopened'];

/** 班主任回复只在这些状态下允许（已解决需家长先重开）。 */
const REPLY_ALLOWED: readonly ParentFeedbackStatus[] = ['processing', 'reopened'];

interface StoredEntry {
  id: string;
  kind: ParentFeedbackEventKind;
  authorRole: 'parent' | 'teacher';
  authorId: string;
  authorDisplayName: string;
  content: string;
  attachmentRefs: string[];
  resolved: boolean | null;
  createdAt: Date;
}

interface StoredTicket {
  id: string;
  childId: string | null;
  source: ParentFeedbackSource;
  projectId: string | null;
  projectTitle: string | null;
  messageId: string | null;
  parentId: string;
  status: ParentFeedbackStatus;
  problem: string;
  entries: StoredEntry[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 统一反馈工单服务。
 *
 * 这是家长端与班主任端**唯一**的工单真相：`/parent/feedback` 系列与
 * `/teacher/feedback` 系列都读写它，不再各自维护一份「服务工单」。
 *
 * 三件由服务端独占的事：
 *  1. **对象级授权**：有关联孩子时，家长必须实际绑定 `ticket.childId`；班主任必须是该学生
 *     **当前**的班主任（`DirectoryService.mentorOfStudent`，只认 active 分配）。无孩子的一般使用问题只绑定提交家长，进入待分配队列。
 *     授权失败不区分「不存在 / 无权限」，避免用差异探测他人数据。
 *  2. **状态机**：`status` 与时间线事件只由本服务迁移，客户端请求体里没有
 *     `status` 字段。非法迁移统一抛 `FEEDBACK_TRANSITION_INVALID`（409）。
 *  3. **附件归属**：写入前通过 `FeedbackAttachmentRegistry` 校验附件确实属于
 *     当前账号，防止把别人的附件挂到自己的工单上。
 *
 * 写操作全部经 `IdempotencyStore`（`(scope,key)` 唯一、同 key 不同载荷 409）与
 * `AuditWriter`（审计只记过程事实，不含反馈原文）。另有一张进程内
 * `(scope,key) → ticketId` 索引作为兜底：若业务写入成功但审计失败，重放同一
 * 幂等键会命中已有工单，而不会追加第二条记录。
 *
 * 存储目前是进程内 Map，与 Directory / PlatformData 的演示域一致；生产需要把
 * `feedback_tickets`（见 `docs/DATABASE.md` 规划）落库时，只需替换这一层。
 */
@Injectable()
export class FeedbackService {
  private readonly tickets: StoredTicket[] = [];
  /** `(scope,key)` → `ticketId`，见类注释的兜底说明。 */
  private readonly idempotencyIndex = new Map<string, string>();
  private demoSeeded = false;

  constructor(
    private readonly directory: DirectoryService,
    private readonly platformData: PlatformDataService,
    private readonly attachments: FeedbackAttachmentRegistry,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
    @Inject(DATA_MODE_TOKEN) private readonly mode: DataMode,
  ) {}

  /* ==================== 家长读接口 ==================== */

  /** 某孩子名下的工单列表（家长必须绑定该孩子）。 */
  async listForParent(parentId: string, childId: string): Promise<ParentFeedbackTicket[]> {
    await this.ensureSeeded();
    await this.assertParentOfChild(parentId, childId);
    return this.mapAll(this.ticketsForChild(childId));
  }

  /** 工单详情；家长无权访问时同样返回 `FEEDBACK_NOT_FOUND`，不泄露存在性。 */
  async getForParent(parentId: string, ticketId: string): Promise<ParentFeedbackTicket> {
    await this.ensureSeeded();
    const ticket = this.requireTicket(ticketId);
    if (ticket.childId === null ? ticket.parentId !== parentId : !(await this.isParentOfChild(parentId, ticket.childId))) {
      feedbackNotFound();
    }
    return this.toTicket(ticket);
  }

  /* ==================== 家长写接口 ==================== */

  /** 提交反馈。`general` 必填 `childId`；`message`/`project` 由关联对象推导并校验。 */
  async submitParentFeedback(
    parentId: string,
    input: SubmitParentFeedbackRequest,
    idempotencyKey: string,
  ): Promise<ParentFeedbackTicket> {
    await this.ensureSeeded();

    const source = assertSource(input.source);
    const content = assertContent(input.content, '反馈内容');
    const resolved = this.resolveTarget(source, input);
    if (resolved.childId !== null) {
      await this.assertParentOfChild(parentId, resolved.childId);
    }
    const attachmentRefs = await this.validatedAttachments(parentId, input.attachmentRefs);

    const scope = 'parent.feedback.submit';
    const requestHash = hashIdempotentInput(scope, {}, {
      source,
      childId: resolved.childId,
      content,
      messageId: resolved.messageId,
      projectId: resolved.projectId,
      attachmentRefs,
    });

    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, requestHash, async () => {
        const existing = this.lookupIdempotent(scope, idempotencyKey);
        if (existing) {
          return { status: 201, body: await this.toTicket(existing) };
        }

        const now = new Date();
        const parent = await this.directory.findUser(parentId);
        const ticket: StoredTicket = {
          id: `ft-${randomUUID()}`,
          childId: resolved.childId,
          source,
          projectId: resolved.projectId,
          projectTitle: resolved.projectTitle,
          messageId: resolved.messageId,
          parentId,
          status: 'processing',
          problem: content,
          entries: [
            {
              id: `fe-${randomUUID()}`,
              kind: 'submitted',
              authorRole: 'parent',
              authorId: parentId,
              authorDisplayName: parent?.displayName ?? '家长',
              content,
              attachmentRefs,
              resolved: null,
              createdAt: now,
            },
          ],
          createdAt: now,
          updatedAt: now,
        };
        this.tickets.push(ticket);
        this.rememberIdempotent(scope, idempotencyKey, ticket.id);

        await this.audit.write({
          actorId: parentId,
          actorRole: 'parent',
          action: 'feedback.submit',
          targetType: 'feedback_ticket',
          targetId: ticket.id,
          idempotencyKey: `${scope}:${idempotencyKey}`,
          detail: {
            childId: ticket.childId,
            source: ticket.source,
            projectId: ticket.projectId,
            messageId: ticket.messageId,
          },
        });

        return { status: 201, body: await this.toTicket(ticket) };
      });

      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /** 家长补充说明。`resolved` 之后不可再补充，需先重开。 */
  async supplementParentFeedback(
    parentId: string,
    ticketId: string,
    input: SupplementParentFeedbackRequest,
    idempotencyKey: string,
  ): Promise<ParentFeedbackTicket> {
    await this.ensureSeeded();

    const ticket = this.requireTicket(ticketId);
    if (ticket.childId === null ? ticket.parentId !== parentId : !(await this.isParentOfChild(parentId, ticket.childId))) {
      feedbackNotFound();
    }

    const content = assertContent(input.content, '补充内容');
    const attachmentRefs = await this.validatedAttachments(parentId, input.attachmentRefs);
    if (!SUPPLEMENT_ALLOWED.includes(ticket.status)) {
      transitionInvalid('该工单已确认解决，如需继续沟通请先重新打开');
    }

    const scope = `parent.feedback.supplement:${ticketId}`;
    const requestHash = hashIdempotentInput(scope, { ticketId }, { content, attachmentRefs });

    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, requestHash, async () => {
        const existing = this.lookupIdempotent(scope, idempotencyKey);
        if (existing) {
          return { status: 200, body: await this.toTicket(existing) };
        }

        const parent = await this.directory.findUser(parentId);
        const now = new Date();
        ticket.entries.push({
          id: `fe-${randomUUID()}`,
          kind: 'supplemented',
          authorRole: 'parent',
          authorId: parentId,
          authorDisplayName: parent?.displayName ?? '家长',
          content,
          attachmentRefs,
          resolved: null,
          createdAt: now,
        });
        ticket.updatedAt = now;
        // 家长补充后回到待处理，等待班主任再次查看。
        ticket.status = 'processing';
        this.rememberIdempotent(scope, idempotencyKey, ticket.id);

        await this.audit.write({
          actorId: parentId,
          actorRole: 'parent',
          action: 'feedback.supplement',
          targetType: 'feedback_ticket',
          targetId: ticket.id,
          idempotencyKey: `${scope}:${idempotencyKey}`,
          detail: { childId: ticket.childId },
        });

        return { status: 200, body: await this.toTicket(ticket) };
      });

      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /**
   * 家长确认结果。
   *
   * - `resolved=true`：`processing` / `replied` / `reopened` 均可关闭 → `resolved`；
   * - `resolved=false`：仅 `replied` / `resolved` 可重开 → `reopened`；
   *   尚在 `processing` 时无需「重开」，`reopened` 时已是该状态，均返回 409。
   */
  async confirmParentFeedback(
    parentId: string,
    ticketId: string,
    input: ConfirmParentFeedbackRequest,
    idempotencyKey: string,
  ): Promise<ParentFeedbackTicket> {
    await this.ensureSeeded();

    const ticket = this.requireTicket(ticketId);
    if (ticket.childId === null ? ticket.parentId !== parentId : !(await this.isParentOfChild(parentId, ticket.childId))) {
      feedbackNotFound();
    }

    if (typeof input.resolved !== 'boolean') {
      throw new BadRequestException({ code: 'FEEDBACK_INVALID', message: 'resolved 必须为布尔值' });
    }
    const resolved = input.resolved;
    const note = assertOptionalNote(input.note);

    if (!resolved && !['replied', 'resolved'].includes(ticket.status)) {
      transitionInvalid('当前工单状态不支持「重新打开」');
    }

    const scope = `parent.feedback.confirm:${ticketId}`;
    const requestHash = hashIdempotentInput(scope, { ticketId }, { resolved, note });

    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, requestHash, async () => {
        const existing = this.lookupIdempotent(scope, idempotencyKey);
        if (existing) {
          return { status: 200, body: await this.toTicket(existing) };
        }

        const parent = await this.directory.findUser(parentId);
        const now = new Date();
        ticket.entries.push({
          id: `fe-${randomUUID()}`,
          kind: resolved ? 'confirmed' : 'reopened',
          authorRole: 'parent',
          authorId: parentId,
          authorDisplayName: parent?.displayName ?? '家长',
          content:
            note.length > 0
              ? note
              : resolved
                ? '家长确认问题已解决'
                : '家长确认问题仍未解决',
          attachmentRefs: [],
          resolved,
          createdAt: now,
        });
        ticket.updatedAt = now;
        ticket.status = resolved ? 'resolved' : 'reopened';
        this.rememberIdempotent(scope, idempotencyKey, ticket.id);

        await this.audit.write({
          actorId: parentId,
          actorRole: 'parent',
          action: resolved ? 'feedback.confirm' : 'feedback.reopen',
          targetType: 'feedback_ticket',
          targetId: ticket.id,
          idempotencyKey: `${scope}:${idempotencyKey}`,
          detail: { childId: ticket.childId, resolved },
        });

        return { status: 200, body: await this.toTicket(ticket) };
      });

      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /* ==================== 班主任接口 ==================== */

  /** 当前班主任名下全部学生的工单列表。 */
  async listForTeacher(teacherId: string): Promise<TeacherFeedbackRow[]> {
    await this.ensureSeeded();
    const students = await this.directory.studentsOfMentor(teacherId);
    const studentIds = new Set(students.map((s) => s.userId));
    const visible = this.tickets
      .filter((t) => t.childId !== null && studentIds.has(t.childId))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return Promise.all(visible.map((t) => this.toRow(t, students)));
  }

  /** 工单详情；班主任不是该学生当前班主任时返回 403 `STUDENT_NOT_ASSIGNED`。 */
  async getForTeacher(teacherId: string, ticketId: string): Promise<ParentFeedbackTicket> {
    await this.ensureSeeded();
    const ticket = this.requireTicket(ticketId);
    await this.assertTeacherOfChild(teacherId, ticket.childId);
    return this.toTicket(ticket);
  }

  /** 班主任公开回复；`resolved` 的工单需家长先重开。 */
  async replyToFeedback(
    teacherId: string,
    ticketId: string,
    input: ReplyTeacherFeedbackRequest,
    idempotencyKey: string,
  ): Promise<ParentFeedbackTicket> {
    await this.ensureSeeded();

    const ticket = this.requireTicket(ticketId);
    await this.assertTeacherOfChild(teacherId, ticket.childId);

    const content = assertContent(input.content, '回复内容');
    const attachmentRefs = await this.validatedAttachments(teacherId, input.attachmentRefs);
    if (!REPLY_ALLOWED.includes(ticket.status)) {
      transitionInvalid('该工单当前状态不允许回复，请先由家长重新打开');
    }

    const scope = `teacher.feedback.reply:${ticketId}`;
    const requestHash = hashIdempotentInput(scope, { ticketId }, { content, attachmentRefs });

    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, requestHash, async () => {
        const existing = this.lookupIdempotent(scope, idempotencyKey);
        if (existing) {
          return { status: 200, body: await this.toTicket(existing) };
        }

        const teacher = await this.directory.findUser(teacherId);
        const now = new Date();
        ticket.entries.push({
          id: `fe-${randomUUID()}`,
          kind: 'replied',
          authorRole: 'teacher',
          authorId: teacherId,
          authorDisplayName: teacher?.displayName ?? '班主任',
          content,
          attachmentRefs,
          resolved: null,
          createdAt: now,
        });
        ticket.updatedAt = now;
        ticket.status = 'replied';
        this.rememberIdempotent(scope, idempotencyKey, ticket.id);

        await this.audit.write({
          actorId: teacherId,
          actorRole: 'teacher',
          action: 'feedback.reply',
          targetType: 'feedback_ticket',
          targetId: ticket.id,
          idempotencyKey: `${scope}:${idempotencyKey}`,
          detail: { childId: ticket.childId },
        });

        return { status: 200, body: await this.toTicket(ticket) };
      });

      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /* ==================== 内部：授权 ==================== */

  private async isParentOfChild(parentId: string, childId: string): Promise<boolean> {
    const children = await this.directory.childrenOfParent(parentId);
    return children.some((c) => c.userId === childId);
  }

  private async assertParentOfChild(parentId: string, childId: string): Promise<void> {
    if (!(await this.isParentOfChild(parentId, childId))) {
      throw new ForbiddenException({
        code: 'FEEDBACK_NOT_FOUND',
        message: '无权访问该孩子的反馈工单',
      });
    }
  }

  private async assertTeacherOfChild(teacherId: string, childId: string | null): Promise<void> {
    // 无孩子的一般使用问题进入受限接待队列，不暴露给普通班主任。
    if (childId === null) {
      throw new ForbiddenException({
        code: 'STUDENT_NOT_ASSIGNED',
        message: '该反馈尚未分配到当前学生班主任',
      });
    }
    // 复用目录真源：只认 active 的当前班主任分配，历史分配一律不算。
    const mentor = await this.directory.mentorOfStudent(childId);
    if (mentor === null || mentor.userId !== teacherId) {
      throw new ForbiddenException({
        code: 'STUDENT_NOT_ASSIGNED',
        message: '您当前不是该学生的班主任',
      });
    }
  }

  /* ==================== 内部：校验 ==================== */

  private resolveTarget(
    source: ParentFeedbackSource,
    input: SubmitParentFeedbackRequest,
  ): {
    childId: string | null;
    messageId: string | null;
    projectId: string | null;
    projectTitle: string | null;
  } {
    const declared =
      typeof input.childId === 'string' && input.childId.trim().length > 0
        ? input.childId.trim()
        : null;

    if (source === 'message') {
      if (!input.messageId) {
        throw new BadRequestException({
          code: 'FEEDBACK_INVALID',
          message: 'source 为 message 时 messageId 必填',
        });
      }
      const message = this.platformData.getMessage(input.messageId);
      if (message === null) {
        throw new BadRequestException({ code: 'FEEDBACK_INVALID', message: '关联消息不存在' });
      }
      if (declared !== null && declared !== message.childId) {
        throw new BadRequestException({
          code: 'FEEDBACK_INVALID',
          message: 'childId 与关联消息的归属不一致',
        });
      }
      return {
        childId: message.childId,
        messageId: message.id,
        projectId: null,
        projectTitle: message.projectTitle,
      };
    }

    if (source === 'project') {
      if (!input.projectId) {
        throw new BadRequestException({
          code: 'FEEDBACK_INVALID',
          message: 'source 为 project 时 projectId 必填',
        });
      }
      const project = this.platformData.getProject(input.projectId);
      if (project === null) {
        throw new BadRequestException({ code: 'FEEDBACK_INVALID', message: '关联项目不存在' });
      }
      if (declared !== null && declared !== project.studentId) {
        throw new BadRequestException({
          code: 'FEEDBACK_INVALID',
          message: 'childId 与关联项目的归属不一致',
        });
      }
      return {
        childId: project.studentId,
        messageId: null,
        projectId: project.projectId,
        projectTitle: project.title,
      };
    }

    // general：可以关联有效孩子，也允许不带孩子的一般使用问题。
    return { childId: declared, messageId: null, projectId: null, projectTitle: null };
  }

  private async validatedAttachments(
    actorId: string,
    raw: readonly string[] | null | undefined,
  ): Promise<string[]> {
    if (raw === null || raw === undefined) return [];
    if (!Array.isArray(raw)) {
      throw new BadRequestException({
        code: 'FEEDBACK_ATTACHMENT_INVALID',
        message: 'attachmentRefs 必须为数组',
      });
    }
    const ids = raw
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    await this.attachments.assertOwnedBy(actorId, ids);
    return ids;
  }

  /* ==================== 内部：存取与映射 ==================== */

  private ticketsForChild(childId: string): StoredTicket[] {
    return this.tickets
      .filter((t) => t.childId === childId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  private requireTicket(ticketId: string): StoredTicket {
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (ticket === undefined) {
      feedbackNotFound();
    }
    return ticket;
  }

  private lookupIdempotent(scope: string, key: string): StoredTicket | null {
    const ticketId = this.idempotencyIndex.get(`${scope}::${key}`);
    if (ticketId === undefined) return null;
    return this.tickets.find((t) => t.id === ticketId) ?? null;
  }

  private rememberIdempotent(scope: string, key: string, ticketId: string): void {
    this.idempotencyIndex.set(`${scope}::${key}`, ticketId);
  }

  private async mapAll(tickets: StoredTicket[]): Promise<ParentFeedbackTicket[]> {
    return Promise.all(tickets.map((t) => this.toTicket(t)));
  }

  private async toTicket(ticket: StoredTicket): Promise<ParentFeedbackTicket> {
    const [child, mentor] = ticket.childId === null
      ? [null, null] as const
      : await Promise.all([
          this.directory.findUser(ticket.childId),
          this.directory.mentorOfStudent(ticket.childId),
        ]);

    const entries: ParentFeedbackEntry[] = ticket.entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      authorRole: e.authorRole,
      authorDisplayName: e.authorDisplayName,
      content: e.content,
      attachmentRefs: [...e.attachmentRefs],
      resolved: e.resolved,
      createdAt: e.createdAt.toISOString(),
    }));

    return {
      id: ticket.id,
      childId: ticket.childId,
      childDisplayName: child?.displayName ?? '未关联孩子',
      source: ticket.source,
      projectId: ticket.projectId,
      projectTitle: ticket.projectTitle,
      messageId: ticket.messageId,
      status: ticket.status,
      problem: ticket.problem,
      owner: mentor?.displayName ?? null,
      handledIn: formatHandledIn(ticket),
      entries,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
    };
  }

  private async toRow(
    ticket: StoredTicket,
    students: Awaited<ReturnType<DirectoryService['studentsOfMentor']>>,
  ): Promise<TeacherFeedbackRow> {
    const student = students.find((s) => s.userId === ticket.childId);
    return {
      ticketId: ticket.id,
      studentId: ticket.childId,
      studentDisplayName: student?.displayName ?? '学生',
      problem: ticket.problem,
      projectTitle: ticket.projectTitle,
      status: ticket.status,
      replied: ticket.entries.some((e) => e.kind === 'replied'),
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
    };
  }

  /* ==================== 内部：演示种子 ==================== */

  /**
   * 演示种子：把旧版写死在 `platform-data` 里的 `ticket-001` 迁到这里。
   *
   * 只在 `demo` / `test` 生效；`live` 下不注入任何演示数据。这样切换数据模式
   * 的语义与 `DirectoryService` 的内存引擎保持一致。
   */
  private async ensureSeeded(): Promise<void> {
    if (this.demoSeeded || this.mode === 'live') return;
    this.demoSeeded = true;

    const child = await this.directory.findUser('student-demo');
    const parent = await this.directory.findUser('parent-demo');
    const project = this.platformData.getProject('project-demo-001');
    if (child === null || project === null) return;

    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const repliedAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000 + 15 * 60 * 1000);

    this.tickets.push({
      id: 'ticket-001',
      childId: 'student-demo',
      source: 'project',
      projectId: project.projectId,
      projectTitle: project.title,
      messageId: null,
      parentId: parent?.userId ?? 'parent-demo',
      status: 'resolved',
      problem: '希望了解如何引导孩子更主动地提问',
      entries: [
        {
          id: 'fe-ticket-001-submitted',
          kind: 'submitted',
          authorRole: 'parent',
          authorId: parent?.userId ?? 'parent-demo',
          authorDisplayName: parent?.displayName ?? '演示家长',
          content: '希望了解如何引导孩子更主动地提问',
          attachmentRefs: [],
          resolved: null,
          createdAt,
        },
        {
          id: 'fe-ticket-001-replied',
          kind: 'replied',
          authorRole: 'teacher',
          authorId: 'teacher-demo',
          authorDisplayName: '演示班主任',
          content: '可以先用开放式问题回应，把「为什么」换成「你觉得呢」，让孩子自己说出来。',
          attachmentRefs: [],
          resolved: null,
          createdAt: repliedAt,
        },
        {
          id: 'fe-ticket-001-confirmed',
          kind: 'confirmed',
          authorRole: 'parent',
          authorId: parent?.userId ?? 'parent-demo',
          authorDisplayName: parent?.displayName ?? '演示家长',
          content: '家长确认问题已解决',
          attachmentRefs: [],
          resolved: true,
          createdAt: repliedAt,
        },
      ],
      createdAt,
      updatedAt: repliedAt,
    });
  }
}

/* ==================== 纯函数工具 ==================== */

function assertSource(source: ParentFeedbackSource): ParentFeedbackSource {
  if (source !== 'general' && source !== 'message' && source !== 'project') {
    throw new BadRequestException({
      code: 'FEEDBACK_INVALID',
      message: 'source 必须是 general、message 或 project',
    });
  }
  return source;
}

function assertContent(raw: unknown, label: string): string {
  const content = typeof raw === 'string' ? raw.trim() : '';
  if (content.length === 0 || content.length > FEEDBACK_CONTENT_MAX_LENGTH) {
    throw new BadRequestException({
      code: 'FEEDBACK_INVALID',
      message: `${label}长度必须在 1 到 ${FEEDBACK_CONTENT_MAX_LENGTH} 字之间`,
    });
  }
  return content;
}

function assertOptionalNote(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string') {
    throw new BadRequestException({ code: 'FEEDBACK_INVALID', message: 'note 必须为字符串' });
  }
  const note = raw.trim();
  if (note.length > FEEDBACK_CONTENT_MAX_LENGTH) {
    throw new BadRequestException({
      code: 'FEEDBACK_INVALID',
      message: `note 长度不能超过 ${FEEDBACK_CONTENT_MAX_LENGTH} 字`,
    });
  }
  return note;
}

function feedbackNotFound(): never {
  throw new NotFoundException({
    code: 'FEEDBACK_NOT_FOUND',
    message: '反馈工单不存在',
  });
}

function transitionInvalid(message: string): never {
  throw new ConflictException({
    code: 'FEEDBACK_TRANSITION_INVALID',
    message,
  });
}

/** 服务端格式化处理时长，例如「2小时15分钟」「3天」「不到1分钟」。 */
export function formatHandledIn(ticket: { createdAt: Date; updatedAt: Date; status: ParentFeedbackStatus }): string {
  const end = ticket.status === 'resolved' ? ticket.updatedAt : new Date();
  const ms = Math.max(0, end.getTime() - ticket.createdAt.getTime());
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '不到1分钟';
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (mins > 0) parts.push(`${mins}分钟`);
  return parts.join('');
}
