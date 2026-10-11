/**
 * Public data entry for the 今天 module.
 *
 * `todayDataSource` is the single exported, swappable async source. Wave 4
 * replaces this one binding with the real student API; no component changes.
 */
import { createMockTodayDataSource } from './mockTodayDataSource';
import { ApiTodayDataSource } from './apiTodayDataSource';
import type { TodayDataSource } from './todayDataSource';

export type { TodayDataSource, TodayScenario } from './todayDataSource';
export { createMockTodayDataSource } from './mockTodayDataSource';
export { ApiTodayDataSource } from './apiTodayDataSource';
export type { MockTodayDataSourceOptions } from './mockTodayDataSource';

/** Real API binding connected to backend /api/v1/projects and /api/v1/project-templates */
export const todayDataSource: TodayDataSource = new ApiTodayDataSource();
