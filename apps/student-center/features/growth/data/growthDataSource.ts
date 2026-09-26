import type {
  GrowthProjectOption,
  StudentGrowthPageData,
  StudentGrowthQuery,
  StudentGrowthSummary,
  StudentGrowthTimeline,
} from '../types';

/**
 * The ONE swappable async data source for the growth module.
 *
 * Components must never call `fetch` directly; Wave 4 repoints this interface
 * at the real read-only API by swapping the implementation in `data/index.ts`.
 * Every method is a read — there is deliberately no create/update/delete
 * method, matching the server-owned, read-only growth model (growth-spec.md §8).
 */
export interface GrowthDataSource {
  loadGrowthPage(query: StudentGrowthQuery): Promise<StudentGrowthPageData>;
  getSummary(): Promise<StudentGrowthSummary>;
  getTimeline(query: StudentGrowthQuery): Promise<StudentGrowthTimeline>;
  getProjectOptions(): Promise<GrowthProjectOption[]>;
}

export type GrowthDataSourceErrorCode =
  | 'GROWTH_UNAVAILABLE'
  | 'GROWTH_OFFLINE'
  | 'GROWTH_PERMISSION_DENIED';

export class GrowthDataSourceError extends Error {
  readonly code: GrowthDataSourceErrorCode;

  constructor(code: GrowthDataSourceErrorCode, message: string) {
    super(message);
    this.name = 'GrowthDataSourceError';
    this.code = code;
  }
}

/** 401/403: a non-student session, or a revoked context. No growth data leaks. */
export class GrowthPermissionError extends GrowthDataSourceError {
  constructor(message = '当前账号无法查看学生成长轨迹') {
    super('GROWTH_PERMISSION_DENIED', message);
    this.name = 'GrowthPermissionError';
  }
}

/** Network failure. Carries the last in-memory read-only page, if any. */
export class GrowthOfflineError extends GrowthDataSourceError {
  readonly lastKnown: StudentGrowthPageData | null;

  constructor(lastKnown: StudentGrowthPageData | null, message = '网络连接不可用') {
    super('GROWTH_OFFLINE', message);
    this.name = 'GrowthOfflineError';
    this.lastKnown = lastKnown;
  }
}
