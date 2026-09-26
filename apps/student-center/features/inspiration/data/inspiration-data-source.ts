import type { InspirationTemplate } from '../types';

/** 场景选择器：让 loading / empty / error / offline / 权限失败五态都可触达。 */
export type InspirationScenario = 'ready' | 'empty' | 'error' | 'offline' | 'permission-denied';

/**
 * 「灵感空间」唯一可换数据源接口。
 *
 * 组件只调用本接口，绝不直接 fetch。真实 API 落地后通过
 * `setInspirationDataSource` 换源，组件与 hooks 无需改动。
 */
export interface InspirationDataSource {
  listTemplates(): Promise<InspirationTemplate[]>;
}
