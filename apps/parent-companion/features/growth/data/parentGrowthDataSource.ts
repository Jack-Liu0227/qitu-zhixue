import type { ChildRef, ParentGrowthPageData, StudentGrowthQuery } from '../types';

/**
 * 家长端成长轨迹唯一可替换的异步数据源。
 *
 * 组件永远不直接调用 `fetch`；只暴露读方法——成长档案没有客户端写路径
 * （growth-spec.md §8），这里也刻意不提供任何 create / update / delete。
 */
export interface ParentGrowthDataSource {
  /** 只返回当前家长已绑定的孩子；越权在服务端挡住。 */
  getChildren(): Promise<ChildRef[]>;
  /** 读取某个孩子的家长投影成长页；未绑定时服务端返回 403。 */
  getGrowthPage(childId: string, query: StudentGrowthQuery): Promise<ParentGrowthPageData>;
}

export type ParentGrowthDataSourceErrorCode =
  'PARENT_GROWTH_UNAVAILABLE' | 'PARENT_GROWTH_OFFLINE' | 'PARENT_GROWTH_PERMISSION_DENIED';

export class ParentGrowthDataSourceError extends Error {
  readonly code: ParentGrowthDataSourceErrorCode;

  constructor(code: ParentGrowthDataSourceErrorCode, message: string) {
    super(message);
    this.name = 'ParentGrowthDataSourceError';
    this.code = code;
  }
}

/** 401/403：非家长会话，或试图读取未绑定的孩子。任何成长数据都不泄露。 */
export class ParentGrowthPermissionError extends ParentGrowthDataSourceError {
  constructor(message = '当前账号无法查看该孩子的成长轨迹') {
    super('PARENT_GROWTH_PERMISSION_DENIED', message);
    this.name = 'ParentGrowthPermissionError';
  }
}

/** 网络失败。携带内存中最近一次成功读取的只读页（若有）。 */
export class ParentGrowthOfflineError extends ParentGrowthDataSourceError {
  readonly lastKnown: ParentGrowthPageData | null;

  constructor(lastKnown: ParentGrowthPageData | null, message = '网络连接不可用') {
    super('PARENT_GROWTH_OFFLINE', message);
    this.name = 'ParentGrowthOfflineError';
    this.lastKnown = lastKnown;
  }
}
