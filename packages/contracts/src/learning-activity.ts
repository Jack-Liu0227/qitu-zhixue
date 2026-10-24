/** Process statistics only. These counts never authorize learning transitions. */
export interface LearningActivitySummary {
  policyVersion: 'learning-activity.v1';
  timezone: 'Asia/Shanghai';
  weekStart: string;
  sessionsThisWeek: number;
  minutesThisWeek: number;
  sessionsLastWeek: number;
  minutesLastWeek: number;
  activeDays: number;
  completedSessionsThisWeek: number;
  lastActivityAt: string | null;
  daily: { date: string; sessions: number; minutes: number; completedSessions: number }[];
}

export interface StudentEncouragement {
  id: string;
  senderDisplayName: string;
  message: string;
  sentAt: string;
}
