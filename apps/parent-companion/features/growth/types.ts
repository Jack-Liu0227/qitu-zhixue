import type { StudentGrowthQuery } from '@qitu/contracts';

/**
 * 家长陪伴中心 — 成长轨迹 (growth) parent-projection view types.
 *
 * 契约类型在 `@qitu/contracts`（单一事实来源），这里只做 re-export，
 * 便于模块内部使用短路径。家长投影比学生投影更窄：
 *  - 没有 `icon` / `encouragement` / `objectiveTitles`
 *  - 没有分数 / 排名 / 百分位 / 任何内部风险标签
 *  - `summaryParent` 是服务端预审过的、面向家长的措辞
 */
export type {
  ChildRef,
  ParentGrowthEntry,
  ParentGrowthPageData,
  ParentGrowthSummary,
  StudentGrowthFilterType,
  StudentGrowthQuery,
} from '@qitu/contracts';

/** 服务端 `limit` 默认 20（上限 100）；这里跟随默认值。 */
export const PARENT_GROWTH_DEFAULT_LIMIT = 20;

/**
 * 家长端成长轨迹只读查询。
 *
 * 家长端首期不暴露 `type` / `projectId` 筛选（产品导航冻结），
 * 因此固定为 `type: 'all'` 与 `projectId: null`，只保留分页游标。
 */
export function createDefaultParentGrowthQuery(): StudentGrowthQuery {
  return {
    type: 'all',
    projectId: null,
    from: null,
    to: null,
    cursor: null,
    limit: PARENT_GROWTH_DEFAULT_LIMIT,
  };
}
