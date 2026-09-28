import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  DismissReminderResponse,
  GetStudentRemindersResponse,
  ReminderPreferenceView,
  ReminderView,
  SetReminderPreferenceRequest,
} from '@qitu/contracts';
import { AuditWriter } from '../../common/audit/audit.service';
import type { AuditEntry } from '../../common/audit/audit-entry';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import {
  LEARNING_PROGRESS_STALL_SOURCE,
  LEARNING_STALL_ESCALATION_THRESHOLD,
  LearningStallSignal,
  LearningStallSignalSink,
} from './learning-stall-signal';
import { ReminderDeliveryGate } from './reminder.gate';
import { pickReminderTemplate, REMINDER_TEMPLATES } from './reminder.templates';
import { ReminderRecord, ReminderStore } from './reminder.types';

/** 提醒默认有效期：24 小时。过期即不再投递。 */
export const REMINDER_TTL_MS = 24 * 60 * 60 * 1000;

/** 审计动作标识（服务端权威，客户端不可指定）。 */
export const REMINDER_AUDIT_ACTIONS = {
  dismissed: 'reminder.dismissed',
  preferenceUpdated: 'reminder.preference.updated',
} as const;

/**
 * 学习进度停滞提醒服务（ISSUE-T2 / #6，安全管线段）。
 *
 * 职责与边界：
 * - **唯一触发源**：实现 `LearningStallSignalSink`，只消费服务端 AI 搭档的
 *   连续卡顿信号；不读取聊天原文、不做任何情绪 / 诊断 / 风险推断。
 * - **服务端独占文案**：模板来自白名单（`reminder.templates.ts`），客户端
 *   只能读投影，不能提交模板或触发源。
 * - **对象级权限**：所有方法都以 `studentId` 为作用域；跨学生访问统一
 *   `REMINDER_NOT_FOUND`（404），不通过 403 / 404 差异泄露他人提醒是否存在。
 * - **写操作幂等**：关闭 / 重新打开与「知道了」都经 `IdempotencyStore`；
 *   无数据库时由幂等层诚实返回 503，不假装成功。
 * - **审计最小化**：只记录 `studentId / templateId / source / category` 等
 *   元数据，绝不写原始对话、语音或推断结果。
 * - **fail-closed**：评审门禁未通过、存储不可用、来源非法或学生已 opt-out 时，
 *   一律不生成、不返回提醒。
 */
@Injectable()
export class ReminderService extends LearningStallSignalSink {
  private readonly logger = new Logger(ReminderService.name);
  /**
   * 进行中的去重键。
   *
   * `ingestStallSignal` 是同步的（不能中断 AI 搭档回合），但落库是异步的；
   * 若同一停滞事实在首个写入完成前被连续上报，两次都会通过
   * `findByTriggerKey` 检查而重复写入。此集合在**同步**阶段就占位，
   * 保证单实例内同一 triggerKey 只有一个在途写入。跨实例仍需数据库唯一索引
   * （见 `reminders.md` 的未落库说明）。
   */
  private readonly inFlightTriggerKeys = new Set<string>();

  constructor(
    @Inject(ReminderStore) private readonly store: ReminderStore | null,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
    @Inject(ReminderDeliveryGate) private readonly gate: ReminderDeliveryGate,
  ) {
    super();
  }

  /**
   * 消费一次学习进度停滞信号。
   *
   * 同步、无副作用外溢、绝不抛错：AI 搭档的回合不因提醒能力失败而中断。
   * 任何前置条件不满足都直接返回（fail-closed, 不投递）。
   */
  ingestStallSignal(signal: LearningStallSignal): void {
    if (signal.source !== LEARNING_PROGRESS_STALL_SOURCE) return;
    if (!Number.isInteger(signal.stallCount) || signal.stallCount < LEARNING_STALL_ESCALATION_THRESHOLD) {
      return;
    }
    if (!this.gate.isDeliveryApproved()) return;
    const store = this.store;
    if (store === null) return;

    const triggerKey = `${signal.source}:${signal.studentId}:${signal.stallCount}`;
    if (this.inFlightTriggerKeys.has(triggerKey)) return;
    this.inFlightTriggerKeys.add(triggerKey);
    void this.createIfAbsent(store, signal, triggerKey);
  }

  private async createIfAbsent(
    store: ReminderStore,
    signal: LearningStallSignal,
    triggerKey: string,
  ): Promise<void> {
    try {
      if ((await store.findByTriggerKey(triggerKey)) !== null) return;
      const preference = await store.getPreference(signal.studentId);
      if (preference?.optedOut === true) return;

      const template = pickReminderTemplate(signal.stallCount);
      const now = new Date();
      const record: ReminderRecord = {
        id: randomUUID(),
        studentId: signal.studentId,
        templateId: template.id,
        source: template.source,
        triggerKey,
        status: 'pending',
        createdAt: now,
        expiresAt: new Date(now.getTime() + REMINDER_TTL_MS),
        dismissedAt: null,
      };
      await store.save(record);
    } catch (error) {
      // 生成失败即不投递（fail-closed）；不把异常抛回 AI 搭档回合。
      this.logger.warn(
        `提醒生成失败，已按 fail-closed 忽略：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.inFlightTriggerKeys.delete(triggerKey);
    }
  }

  /**
   * 读取当前学生的可投递提醒。
   *
   * - 门禁关闭 → 空列表且 `deliveryEnabled=false`（不泄露任何文案）；
   * - 学生 opt-out → 空列表但 `deliveryEnabled=true`（尊重学生选择）；
   * - 否则返回未过期、未 dismiss 的提醒。
   */
  async listForStudent(studentId: string): Promise<GetStudentRemindersResponse> {
    const store = this.store;
    if (store === null || !this.gate.isDeliveryApproved()) {
      return { reminders: [], deliveryEnabled: false, optedOut: false };
    }
    const preference = await store.getPreference(studentId);
    const optedOut = preference?.optedOut === true;
    if (optedOut) {
      return { reminders: [], deliveryEnabled: true, optedOut: true };
    }
    const pending = await store.listPending(studentId, new Date());
    return {
      reminders: pending.map((record) => toReminderView(record)),
      deliveryEnabled: true,
      optedOut: false,
    };
  }

  /**
   * 学生「知道了」某条提醒。
   *
   * 对象级权限：提醒必须属于该学生，否则统一 404。已 dismiss 的重复调用
   * 返回首次的 `dismissedAt`（天然幂等），过期提醒返回 409。
   */
  async dismiss(
    studentId: string,
    reminderId: string,
    idempotencyKey: string,
  ): Promise<DismissReminderResponse> {
    const store = this.requireStore();
    const scope = `reminder.dismiss:${studentId}`;
    const requestHash = hashIdempotentInput(scope, { reminderId }, {});

    const result = await this.idempotency.execute<DismissReminderResponse>(
      scope,
      idempotencyKey,
      requestHash,
      async () => {
        const record = await store.findById(reminderId);
        if (record === null || record.studentId !== studentId) {
          throw new NotFoundException({
            code: 'REMINDER_NOT_FOUND',
            message: '提醒不存在',
          });
        }
        if (record.status === 'dismissed' && record.dismissedAt !== null) {
          return {
            status: 200,
            body: { reminderId, dismissedAt: record.dismissedAt.toISOString() },
          };
        }
        const now = new Date();
        if (record.expiresAt.getTime() <= now.getTime()) {
          throw new ConflictException({
            code: 'REMINDER_ACTION_NOT_APPLICABLE',
            message: '提醒已过期',
          });
        }
        await store.markDismissed(record.id, now);
        await this.audit.write(
          this.buildAuditEntry(AUDIT_ACTION_DISMISSED, studentId, record, idempotencyKey),
        );
        return { status: 200, body: { reminderId, dismissedAt: now.toISOString() } };
      },
    );
    return result.body;
  }

  /**
   * 设置提醒偏好（关闭 / 重新打开）。
   *
   * 请求体只有 `optedOut`；模板与触发源永远来自服务端。
   */
  async setPreference(
    studentId: string,
    request: SetReminderPreferenceRequest,
    idempotencyKey: string,
  ): Promise<ReminderPreferenceView> {
    if (typeof request.optedOut !== 'boolean') {
      throw new BadRequestException({
        code: 'REMINDER_PREFERENCE_INVALID',
        message: 'optedOut 必须是布尔值',
      });
    }
    const store = this.requireStore();
    const scope = `reminder.preference:${studentId}`;
    const requestHash = hashIdempotentInput(scope, {}, { optedOut: request.optedOut });

    const result = await this.idempotency.execute<ReminderPreferenceView>(
      scope,
      idempotencyKey,
      requestHash,
      async () => {
        const now = new Date();
        const preference = await store.setPreference(studentId, request.optedOut, now);
        const entry: AuditEntry = {
          actorId: studentId,
          actorRole: 'student',
          action: AUDIT_ACTION_PREFERENCE_UPDATED,
          targetType: 'student_reminder_preference',
          targetId: studentId,
          idempotencyKey,
          detail: { optedOut: preference.optedOut },
        };
        await this.audit.write(entry);
        return {
          status: 200,
          body: { optedOut: preference.optedOut, updatedAt: preference.updatedAt.toISOString() },
        };
      },
    );
    return result.body;
  }

  /** 存储不可用时诚实失败（503），不退回内存假装成功。 */
  private requireStore(): ReminderStore {
    if (this.store === null) {
      throw new ServiceUnavailableException({
        code: 'REMINDER_UNAVAILABLE',
        message: '提醒能力暂不可用',
      });
    }
    return this.store;
  }

  private buildAuditEntry(
    action: string,
    studentId: string,
    record: ReminderRecord,
    idempotencyKey: string,
  ): AuditEntry {
    // 只写元数据：不包含任何原始对话、语音、模型输出或推断标签。
    return {
      actorId: studentId,
      actorRole: 'student',
      action,
      targetType: 'student_reminder',
      targetId: record.id,
      idempotencyKey,
      detail: {
        templateId: record.templateId,
        source: record.source,
        category: REMINDER_TEMPLATES[record.templateId].category,
      },
    };
  }
}

const AUDIT_ACTION_DISMISSED = REMINDER_AUDIT_ACTIONS.dismissed;
const AUDIT_ACTION_PREFERENCE_UPDATED = REMINDER_AUDIT_ACTIONS.preferenceUpdated;

/** 把内部记录投影成对外只读视图。 */
export function toReminderView(record: ReminderRecord): ReminderView {
  const template = REMINDER_TEMPLATES[record.templateId];
  return {
    reminderId: record.id,
    templateId: record.templateId,
    category: template.category,
    source: record.source,
    title: template.title,
    body: template.body,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
  };
}
