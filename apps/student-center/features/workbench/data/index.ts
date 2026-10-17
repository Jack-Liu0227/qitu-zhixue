import { createHttpWorkbenchDataSource } from '../api/workbenchApi';
import { createMockWorkbenchDataSource, type MockWorkbenchOptions } from './mockWorkbenchDataSource';
import type { WorkbenchDataSource } from './workbenchDataSource';

export type { WorkbenchDataSource, MockWorkbenchOptions };

/**
 * The one swappable data source. Defaults to the real HTTP source (same-origin
 * relative paths); `createMockWorkbenchDataSource` stays exported for explicit
 * tests / five-state reproduction only — the production path never renders it.
 *
 * Everything else in the module receives a `WorkbenchDataSource` via props, so
 * repointing this single export never touches component code.
 */
export function createWorkbenchDataSource(options?: MockWorkbenchOptions): WorkbenchDataSource {
  return createMockWorkbenchDataSource(options);
}

export const workbenchDataSource: WorkbenchDataSource = createHttpWorkbenchDataSource('');
