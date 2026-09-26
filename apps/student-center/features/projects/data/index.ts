import { MockProjectsDataSource } from './mock-projects-data-source';
import type { ProjectsDataSource } from './data-source';

export * from './data-source';

/** 当前数据源实例。组件一律通过它取数，绝不直接 fetch。 */
export let projectsDataSource: ProjectsDataSource = new MockProjectsDataSource();

/**
 * 唯一换源入口：Wave 4 用真实 API 客户端替换。
 * 组件与 hooks 不感知实现变化。
 */
export function setProjectsDataSource(source: ProjectsDataSource): void {
  projectsDataSource = source;
}
