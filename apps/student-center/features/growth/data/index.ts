import { createGrowthApiDataSource } from '../api';
import type { GrowthDataSource } from './growthDataSource';
import { createMockGrowthDataSource, type MockGrowthScenario } from './mockGrowthDataSource';

export type { GrowthDataSource, GrowthDataSourceErrorCode } from './growthDataSource';
export {
  GrowthDataSourceError,
  GrowthOfflineError,
  GrowthPermissionError,
} from './growthDataSource';
export { createMockGrowthDataSource, resetGrowthCache, type MockGrowthScenario } from './mockGrowthDataSource';
export { projectStudentEntry, projectStudentTimeline } from './projectStudentEntry';

/**
 * The single place components get their data source from.
 *
 * 默认走向真实只读 API（`/api/v1/students/me/growth*`），相对路径，走 nginx 同源
 * 代理，会话 cookie 自动带上。`apiBaseUrl` 显式传空串之外的值时可指向别的源。
 *
 * 显式传 `scenario` 时仍然返回 mock：错误态 / 空态的样子需要能稳定复现，
 * 这比每次都去改后端数据现实得多。
 */
export function createGrowthDataSource(options?: {
  scenario?: MockGrowthScenario;
  apiBaseUrl?: string;
}): GrowthDataSource {
  if (options?.scenario !== undefined) {
    return createMockGrowthDataSource(options.scenario);
  }
  // 空串 = 同源相对请求（`/api/v1/...` 由 nginx 转发给本 worktree 的 API）。
  return createGrowthApiDataSource(options?.apiBaseUrl ?? '');
}

/** Default singleton used by the page when no data source is injected. */
export const growthDataSource: GrowthDataSource = createGrowthDataSource();
