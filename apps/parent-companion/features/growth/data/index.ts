import { createParentGrowthApiDataSource } from '../api';
import type { ParentGrowthDataSource } from './parentGrowthDataSource';

export type {
  ParentGrowthDataSource,
  ParentGrowthDataSourceErrorCode,
} from './parentGrowthDataSource';
export {
  ParentGrowthDataSourceError,
  ParentGrowthOfflineError,
  ParentGrowthPermissionError,
} from './parentGrowthDataSource';

/**
 * 页面获取数据源的唯一入口。
 *
 * 默认走真实只读 API（`/api/v1/parent/children*`），同源相对路径，会话 cookie
 * 自动带上。`apiBaseUrl` 显式传空串之外的值时可指向别的源（测试 / 评审用）。
 */
export function createParentGrowthDataSource(options?: {
  apiBaseUrl?: string;
}): ParentGrowthDataSource {
  // 空串 = 同源相对请求（`/api/v1/...` 由 nginx 转发给本 worktree 的 API）。
  return createParentGrowthApiDataSource(options?.apiBaseUrl ?? '');
}

/** 生产使用的共享单例。 */
export const parentGrowthDataSource: ParentGrowthDataSource = createParentGrowthDataSource();
