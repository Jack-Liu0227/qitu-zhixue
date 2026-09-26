import { createMockWorkbenchDataSource, type MockWorkbenchOptions } from './mockWorkbenchDataSource';
import type { WorkbenchDataSource } from './workbenchDataSource';

export type { WorkbenchDataSource, MockWorkbenchOptions };

/**
 * The one swappable data source. Defaults to the in-memory mock; Wave 4 can
 * replace it with `createHttpWorkbenchDataSource(...)` from `../api`.
 *
 * Everything else in the module receives a `WorkbenchDataSource` via props, so
 * repointing this single export never touches component code.
 */
export function createWorkbenchDataSource(options?: MockWorkbenchOptions): WorkbenchDataSource {
  return createMockWorkbenchDataSource(options);
}

export const workbenchDataSource: WorkbenchDataSource = createMockWorkbenchDataSource();
