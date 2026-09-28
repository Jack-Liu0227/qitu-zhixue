/**
 * 提醒投递的**评审门禁**。
 *
 * ISSUE-T2 仍处于 `Proposed`，在通过产品 / 隐私评审（R-T2）之前，任何真实
 * 投递都必须关闭。因此门禁的**默认实现是关闭**：只有显式把环境变量
 * `QITU_REMINDER_DELIVERY_ENABLED` 设为 `'true'` 才放行。
 *
 * 这是「fail-closed」的落点：读不到配置、配置写错、部署忘记设置，结果都是
 * 不投递，而不是误投。开启门禁还要求有数据库能力（写操作的幂等与审计），
 * 详见 `reminders.md`。
 */
export abstract class ReminderDeliveryGate {
  /** 返回 `true` 才允许生成 / 读取提醒内容。 */
  abstract isDeliveryApproved(): boolean;
}

/** 基于环境变量 + 持久化能力的门禁；缺任一条件一律关闭。 */
export class EnvReminderDeliveryGate extends ReminderDeliveryGate {
  constructor(private readonly persistenceAvailable: boolean) {
    super();
  }

  isDeliveryApproved(): boolean {
    // 开启投递需要两件事同时成立：显式配置的开关 + 可用的持久化能力。
    // 缺少任一条件都 fail-closed，避免在无库环境下从内存投递、无法审计。
    return this.persistenceAvailable && process.env.QITU_REMINDER_DELIVERY_ENABLED === 'true';
  }
}

/** 固定门禁，便于测试与显式注入；默认关闭。 */
export class StaticReminderDeliveryGate extends ReminderDeliveryGate {
  constructor(private readonly approved = false) {
    super();
  }

  isDeliveryApproved(): boolean {
    return this.approved;
  }
}
