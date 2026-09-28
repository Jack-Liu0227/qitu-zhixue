import type { ReminderInboxUiState } from '@qitu/contracts';

/**
 * 提醒收件箱的**五态投影**（纯函数，无副作用，可直接单测）。
 *
 * 服务端保证 empty（空数组）与 permission-denied（统一 401/403）可表达；
 * loading / error / offline 由客户端根据请求生命周期与错误码推导。把这段
 * 映射抽成纯函数，是为了让四个平台（学生 / 家长 / 班主任 / 管理）共用同一份
 * 状态判定，避免各写一套导致状态漂移。
 */

/** 请求生命周期中的粗粒度结果。 */
export type ReminderFetchStatus = 'loading' | 'ready' | 'error' | 'denied' | 'offline';

export interface ReminderInboxInput {
  status: ReminderFetchStatus;
  /** 仅在 `status === 'ready'` 时有意义。 */
  reminderCount: number;
}

export function deriveReminderInboxState(input: ReminderInboxInput): ReminderInboxUiState {
  switch (input.status) {
    case 'loading':
      return 'loading';
    case 'denied':
      return 'permission-denied';
    case 'offline':
      return 'offline';
    case 'error':
      return 'error';
    case 'ready':
      return input.reminderCount > 0 ? 'ready' : 'empty';
  }
}

/**
 * 把 HTTP / 网络状态翻译成粗粒度结果。
 *
 * - 401 / 403 → `denied`（权限失败，后端为准）
 * - 0 → `offline`（`fetch` 抛出 / 断网）
 * - 其它非 2xx → `error`
 * - 2xx → `ready`
 */
export function classifyReminderFetch(status: number): ReminderFetchStatus {
  if (status === 401 || status === 403) return 'denied';
  if (status === 0) return 'offline';
  if (status >= 200 && status < 300) return 'ready';
  return 'error';
}
