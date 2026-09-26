/**
 * The single swappable data source for the 今天 module.
 *
 * Wave 4 (route wiring) re-points `todayDataSource` at the real student API
 * without touching any component: components and hooks only ever import from
 * `features/today/data`. No component calls `fetch` directly.
 */
import type { ActiveProjectSummary, NotificationList, TodayView } from '../types';

export interface TodayDataSource {
  /** C1 `GET /api/v1/students/me/today`. */
  getToday(): Promise<TodayView>;
  /** C2 `GET /api/v1/students/me/active-project`; resolves `null` when none. */
  getActiveProject(): Promise<ActiveProjectSummary | null>;
  /** C3 `GET /api/v1/students/me/notifications?unread=true`. */
  getNotifications(): Promise<NotificationList>;
}

/** Scenario selector used by the mock source so every UI state is reachable. */
export type TodayScenario = 'ready' | 'empty' | 'error' | 'offline' | 'permission-denied';
