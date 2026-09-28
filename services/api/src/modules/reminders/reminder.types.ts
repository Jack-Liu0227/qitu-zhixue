import type { ReminderTemplateId, ReminderTriggerSource } from '@qitu/contracts';

/** 服务端内部的提醒记录（不直接对外暴露）。 */
export interface ReminderRecord {
  id: string;
  studentId: string;
  templateId: ReminderTemplateId;
  source: ReminderTriggerSource;
  /**
   * 去重键：`source:studentId:stallCount`。
   *
   * 同一个停滞事实重复上报（例如 AI 搭档重放 / 多次轮询）不会生成第二条提醒。
   */
  triggerKey: string;
  status: 'pending' | 'dismissed';
  createdAt: Date;
  expiresAt: Date;
  dismissedAt: Date | null;
}

/** 学生对提醒的偏好。 */
export interface ReminderPreferenceRecord {
  studentId: string;
  optedOut: boolean;
  updatedAt: Date;
}

/**
 * 提醒持久化抽象。
 *
 * 作为 Nest 注入令牌使用。当前只提供内存实现（见 `reminder.store.memory.ts`），
 * **没有**数据库迁移——这是 ISSUE-T2 在评审通过前刻意保留的阻塞点：
 * 在没有隐私评审结论之前，不把未成年人相关提醒落库。
 */
export abstract class ReminderStore {
  abstract save(record: ReminderRecord): Promise<void>;
  abstract findById(id: string): Promise<ReminderRecord | null>;
  abstract findByTriggerKey(triggerKey: string): Promise<ReminderRecord | null>;
  abstract listPending(studentId: string, now: Date): Promise<ReminderRecord[]>;
  abstract markDismissed(id: string, at: Date): Promise<void>;
  abstract getPreference(studentId: string): Promise<ReminderPreferenceRecord | null>;
  abstract setPreference(
    studentId: string,
    optedOut: boolean,
    at: Date,
  ): Promise<ReminderPreferenceRecord>;
}
