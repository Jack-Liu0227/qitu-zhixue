/**
 * Public data entry for the 今天 module.
 *
 * `todayDataSource` is the single exported, swappable async source. Wave 4
 * replaces this one binding with the real student API; no component changes.
 */
import { createMockTodayDataSource } from './mockTodayDataSource';
import type { TodayDataSource } from './todayDataSource';

export type { TodayDataSource, TodayScenario } from './todayDataSource';
export { createMockTodayDataSource } from './mockTodayDataSource';
export type { MockTodayDataSourceOptions } from './mockTodayDataSource';

/** Default binding. Swap this for the real API in Wave 4. */
export const todayDataSource: TodayDataSource = createMockTodayDataSource({ scenario: 'ready' });
