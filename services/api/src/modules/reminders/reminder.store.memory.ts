import { ReminderStore } from './reminder.types';
import type { ReminderPreferenceRecord, ReminderRecord } from './reminder.types';

/**
 * 内存提醒存储。
 *
 * 仅用于 demo / 单测，**不是**生产实现：进程重启即丢失，且无法跨实例共享。
 * 生产需要数据库表与迁移；在 T2 通过产品 / 隐私评审前不落库，见
 * `reminders.md` 的阻塞说明。
 */
export class InMemoryReminderStore extends ReminderStore {
  private readonly records = new Map<string, ReminderRecord>();
  private readonly preferences = new Map<string, ReminderPreferenceRecord>();

  async save(record: ReminderRecord): Promise<void> {
    this.records.set(record.id, { ...record });
  }

  async findById(id: string): Promise<ReminderRecord | null> {
    const record = this.records.get(id);
    return record === undefined ? null : { ...record };
  }

  async findByTriggerKey(triggerKey: string): Promise<ReminderRecord | null> {
    for (const record of this.records.values()) {
      if (record.triggerKey === triggerKey) return { ...record };
    }
    return null;
  }

  async listPending(studentId: string, now: Date): Promise<ReminderRecord[]> {
    return [...this.records.values()]
      .filter(
        (record) =>
          record.studentId === studentId &&
          record.status === 'pending' &&
          record.expiresAt.getTime() > now.getTime(),
      )
      .map((record) => ({ ...record }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async markDismissed(id: string, at: Date): Promise<void> {
    const record = this.records.get(id);
    if (record === undefined) return;
    this.records.set(id, { ...record, status: 'dismissed', dismissedAt: at });
  }

  async getPreference(studentId: string): Promise<ReminderPreferenceRecord | null> {
    const preference = this.preferences.get(studentId);
    return preference === undefined ? null : { ...preference };
  }

  async setPreference(
    studentId: string,
    optedOut: boolean,
    at: Date,
  ): Promise<ReminderPreferenceRecord> {
    const preference: ReminderPreferenceRecord = { studentId, optedOut, updatedAt: at };
    this.preferences.set(studentId, preference);
    return { ...preference };
  }
}
