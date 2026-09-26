/**
 * Public data entry for the 灵感空间 module.
 *
 * `inspirationDataSource` is the single exported, swappable async source.
 * Wave 4 replaces this one binding with the real student API; no component changes.
 */
import { createMockInspirationDataSource } from './mock-inspiration-data-source';
import type { InspirationDataSource } from './inspiration-data-source';

export type { InspirationDataSource, InspirationScenario } from './inspiration-data-source';
export { createMockInspirationDataSource } from './mock-inspiration-data-source';
export type { MockInspirationDataSourceOptions } from './mock-inspiration-data-source';

/** Default binding. Swap this for the real API in Wave 4. */
export let inspirationDataSource: InspirationDataSource = createMockInspirationDataSource({
  scenario: 'ready',
});

/** 唯一换源入口。 */
export function setInspirationDataSource(source: InspirationDataSource): void {
  inspirationDataSource = source;
}
