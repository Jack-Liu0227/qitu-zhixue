import type { ParentMessageStatus, ParentWorkStatus } from '@qitu/contracts';

/**
 * 家长端展示用格式化。纯函数，不碰数据。
 *
 * 为什么单独放一个文件：参考稿里时间和状态都是**人话**
 * （「今天 16:20」「待您确认」），而接口给的是 ISO 字符串和英文枚举。
 * 这套翻译如果散落在三个页面里各写一遍，早晚会出现同一状态三种说法。
 */

/** 「今天 16:20」/「昨天 18:30」/「9月20日 15:40」——参考稿的消息时间写法。 */
export function formatDayTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (dayDiff === 0) return `今天 ${time}`;
  if (dayDiff === 1) return `昨天 ${time}`;

  const monthDay = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date);
  return dayDiff > 1 && dayDiff < 7 ? `${monthDay} ${time}` : monthDay;
}

/** 「9月15日」——版本成长时间轴的短日期。 */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date);
}

/** 消息状态：接口给英文枚举，界面给人话。 */
const MESSAGE_STATUS_LABELS: Record<ParentMessageStatus, string> = {
  unread: '未读',
  pending_confirm: '待您确认',
  processing: '处理中',
  resolved: '已解决',
};

export function parentMessageStatusLabel(status: ParentMessageStatus): string {
  return MESSAGE_STATUS_LABELS[status] ?? status;
}

/** 作品状态。 */
const WORK_STATUS_LABELS: Record<ParentWorkStatus, string> = {
  draft: '草稿',
  in_progress: '进行中',
  completed: '已完成',
};

export function parentWorkStatusLabel(status: ParentWorkStatus): string {
  return WORK_STATUS_LABELS[status] ?? status;
}

/** 服务工单状态。 */
export function parentTicketStatusLabel(status: 'processing' | 'resolved'): string {
  return status === 'resolved' ? '已解决' : '处理中';
}

/** 按当前时刻给一句问候，而不是把称呼写死在文案里。 */
export function greeting(hour: number = new Date().getHours()): string {
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}
