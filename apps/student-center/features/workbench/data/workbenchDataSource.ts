import type {
  PreviewResult,
  PreviewableKind,
  SimulatorRun,
  TutorSuggestion,
  WorkbenchContent,
  WorkbenchDraft,
  WorkbenchKind,
  WorkbenchProject,
  WorkbenchSnapshot,
  WorkbenchStageProgress,
} from '../types/workbench';

/**
 * The single swappable data source for the workbench page.
 *
 * Components never call `fetch` directly. Wave 4 repoints this one interface at
 * the real API (see `../api/workbenchApi.ts`) without touching components.
 */
export interface WorkbenchDataSource {
  getProject(projectId: string): Promise<WorkbenchProject>;
  getStageProgress(projectId: string): Promise<WorkbenchStageProgress>;
  getDraft<K extends WorkbenchKind>(projectId: string, kind: K): Promise<WorkbenchDraft<K>>;
  /**
   * `revision` is sent as `If-Match`. A stale revision MUST reject with
   * `WorkbenchConflictError` carrying the server's current revision + content.
   */
  patchDraft<K extends WorkbenchKind>(
    projectId: string,
    kind: K,
    revision: number,
    content: WorkbenchContent<K>,
  ): Promise<WorkbenchDraft<K>>;
  createSnapshot<K extends WorkbenchKind>(
    projectId: string,
    kind: K,
    revision: number,
  ): Promise<WorkbenchSnapshot>;
  preview(projectId: string, kind: PreviewableKind, revision: number): Promise<PreviewResult>;
  /** Persisted run record; NOT part of project evidence. */
  runSimulator(projectId: string, input: string, draftRevision: number): Promise<SimulatorRun>;
  /** Gap: no project-scoped suggestion endpoint exists yet. */
  getTutorSuggestions(projectId: string): Promise<TutorSuggestion[]>;
  heartbeat(): Promise<boolean>;
}
