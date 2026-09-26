/**
 * 家长陪伴中心 — 成长轨迹 (growth) parent-projection feature.
 *
 * 只读：展示家长投影的服务端成长记录（`GET /api/v1/parent/children*`），
 * 没有客户端写路径，也不渲染学生端的 icon / 鼓励语 / 风险标签。
 */

export { ParentGrowthPage, type ParentGrowthPageProps } from './components/ParentGrowthPage';

export {
  createParentGrowthDataSource,
  parentGrowthDataSource,
  type ParentGrowthDataSource,
} from './data';
export {
  ParentGrowthDataSourceError,
  ParentGrowthOfflineError,
  ParentGrowthPermissionError,
} from './data/parentGrowthDataSource';

export {
  createDefaultParentGrowthQuery,
  type ChildRef,
  type ParentGrowthEntry,
  type ParentGrowthPageData,
  type ParentGrowthSummary,
  type StudentGrowthQuery,
} from './types';
