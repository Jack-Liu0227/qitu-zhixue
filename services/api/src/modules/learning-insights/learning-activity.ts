import type { LearningActivitySummary } from '@qitu/contracts';

const DAY = 86_400_000;
const OFFSET = 8 * 3_600_000;
export const activityDate = (at: number) => new Date(at + OFFSET).toISOString().slice(0, 10);
export function activityWeekStart(now: Date): number {
  const local = new Date(now.getTime() + OFFSET);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - OFFSET
    - ((local.getUTCDay() + 6) % 7) * DAY;
}

export function summarizeLearningActivity(
  events: readonly Date[], completions: readonly Date[], now = new Date(),
): LearningActivitySummary {
  const start = activityWeekStart(now);
  const previous = start - 7 * DAY;
  const times = [...new Set([...events, ...completions].map(at => at.getTime()))]
    .filter(at => Number.isFinite(at) && at >= previous && at <= now.getTime()).sort((a, b) => a - b);
  const daily = Array.from({ length: 14 }, (_, index) => ({
    date: activityDate(previous + index * DAY), sessions: 0, minutes: 0, completedSessions: 0,
  }));
  let last: number | null = null;
  for (const at of times) {
    const day = daily.find(row => row.date === activityDate(at));
    if (!day) continue;
    const sameDay = last !== null && activityDate(last) === day.date;
    if (!sameDay || last === null || at - last > 30 * 60_000) day.sessions++;
    else day.minutes += Math.min(at - last, 5 * 60_000) / 60_000;
    last = at;
  }
  for (const at of completions) {
    if (at.getTime() > now.getTime()) continue;
    const day = daily.find(row => row.date === activityDate(at.getTime()));
    if (day) day.completedSessions++;
  }
  const current = daily.slice(7);
  const sum = (rows: typeof daily, field: 'sessions' | 'minutes') => Math.round(rows.reduce((total, row) => total + row[field], 0));
  return {
    policyVersion: 'learning-activity.v1', timezone: 'Asia/Shanghai', weekStart: new Date(start).toISOString(),
    sessionsThisWeek: sum(current, 'sessions'), minutesThisWeek: sum(current, 'minutes'),
    sessionsLastWeek: sum(daily.slice(0, 7), 'sessions'), minutesLastWeek: sum(daily.slice(0, 7), 'minutes'),
    activeDays: current.filter(row => row.sessions > 0).length,
    completedSessionsThisWeek: current.reduce((total, row) => total + row.completedSessions, 0),
    lastActivityAt: last === null ? null : new Date(last).toISOString(),
    daily: current.map(row => ({ ...row, minutes: Math.round(row.minutes) })),
  };
}
