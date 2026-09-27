import type { TutorDataSource } from './dataSource';
import { MockTutorDataSource } from './mockTutorDataSource';
import { TutorApiDataSource } from './tutorApiDataSource';

export type { TutorDataSource } from './dataSource';
export { TutorDataError } from './dataSource';
export { MockTutorDataSource } from './mockTutorDataSource';
export type { MockTutorScenario } from './mockTutorDataSource';
export { TutorApiDataSource } from './tutorApiDataSource';
export { LiveTutorSocket } from './liveTutorSocket';
export { openTutorStream, TUTOR_STREAM_PATH } from './tutorStream';
export type { TutorStreamHandlers, TutorStreamRequest } from './tutorStream';

/**
 * The single module-level data source.
 *
 * Components never call `fetch` and never import a mock directly; they read
 * this holder through `useTutorDataSource()` (context) so the whole module can
 * be repointed with `setTutorDataSource(...)`.
 *
 * The default is the real API (`TutorApiDataSource`): the conversation is
 * streamed from `POST /api/v1/tutor/stream`. It does NOT silently degrade to
 * fixtures — an unreachable API becomes a visible offline/error state, because
 * a student must never mistake demo content for their own learning record.
 * `MockTutorDataSource` stays available for explicit tests/QA via
 * `setTutorDataSource(...)`.
 */
let activeDataSource: TutorDataSource = new TutorApiDataSource();

export function getTutorDataSource(): TutorDataSource {
  return activeDataSource;
}

/** Swap the data source (Wave 4 / tests). Not called by components. */
export function setTutorDataSource(next: TutorDataSource): void {
  activeDataSource = next;
}
