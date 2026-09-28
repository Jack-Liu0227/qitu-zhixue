/**
 * 事务性 outbox 的**类型契约**（纯类型 + 常量，无运行时依赖）。
 *
 * 背景（ISSUE-FEEDBACK / #11）：反馈闭环要求「业务写入成功 → 同一事务内产生一条
 * 可重试的通知事件」。事件先落 `outbox` 表（`status='pending'`），由 `workers`
 * 异步消费并投递通知。当前 `services/workers` 仍只是初始化桩，**没有真实消费者**：
 * 事件会诚实地停留为 `pending`，不会假装已经发送成功。
 *
 * 术语：
 * - `pending`：已随业务事务提交，等待 worker 消费；可被重试。
 * - `published`：worker 投递成功（当前无 worker，不会被写入）。
 * - `failed`：达到重试上限后仍失败，属于**终态**，可由运维查询观测。
 */

/** `outbox.status` 的取值（与迁移里的 text 枚举一致）。 */
export type OutboxStatus = 'pending' | 'published' | 'failed';

/** 一条待投递事件。`id` 必须由调用方提供且稳定，重试不会产生第二条事件。 */
export interface OutboxEventInput {
  /** 稳定事件 id（由幂等指纹派生），重放不会追加第二条 outbox 行。 */
  id: string;
  /** 事件主题，见 `FEEDBACK_OUTBOX_TOPICS`。 */
  topic: string;
  /**
   * 事件载荷。**必须最小化**：只放路由所需 id 与状态，不放反馈原文 / 未成年人
   * 原始内容；写入前还会经 `redactSensitive` 递归脱敏。
   */
  payload: Record<string, unknown>;
}

/**
 * 反馈闭环通知事件主题。
 *
 * worker（未来实现）按主题决定通知受众：
 * - `submitted` / `supplemented` / `reopened` → 通知当前班主任；
 * - `replied` / `confirmed` → 通知家长。
 */
export const FEEDBACK_OUTBOX_TOPICS = {
  submitted: 'feedback.ticket.submitted',
  supplemented: 'feedback.ticket.supplemented',
  replied: 'feedback.ticket.replied',
  confirmed: 'feedback.ticket.confirmed',
  reopened: 'feedback.ticket.reopened',
} as const;

export type FeedbackOutboxTopic =
  (typeof FEEDBACK_OUTBOX_TOPICS)[keyof typeof FEEDBACK_OUTBOX_TOPICS];

/** 默认最大投递尝试次数；达到后事件转为终态 `failed`。 */
export const OUTBOX_MAX_ATTEMPTS = 5;
