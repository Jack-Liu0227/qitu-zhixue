import type { ApiErrorCode, ProblemDetails, WorkbenchConflictDetails } from '@qitu/contracts';
import {
  WorkbenchConflictError,
  type PreviewResult,
  type PreviewableKind,
  type SimulatorRun,
  type TutorSuggestion,
  type WorkbenchContent,
  type WorkbenchDraft,
  type WorkbenchKind,
  type WorkbenchProject,
  type WorkbenchSnapshot,
  type WorkbenchStageProgress,
} from '../types/workbench';
import type { WorkbenchDataSource } from '../data/workbenchDataSource';

/** Contract code for the optimistic-lock 409. */
const OPTIMISTIC_LOCK_CODE: ApiErrorCode = 'WORKBENCH_OPTIMISTIC_LOCK_CONFLICT';

export class WorkbenchHttpError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails<unknown> | null;

  constructor(status: number, problem: ProblemDetails<unknown> | null) {
    super(problem?.message ?? `request failed (${status})`);
    this.name = 'WorkbenchHttpError';
    this.status = status;
    this.problem = problem;
  }
}

interface IdempotencySource {
  (): string;
}

function defaultIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `wb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Normalize either the contracts shape or the raw 409 body into details. */
function toConflictDetails(raw: unknown): WorkbenchConflictDetails {
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as Record<string, unknown>;
    const revision = record.currentRevision ?? record.serverRevision;
    const content = record.content ?? record.serverContent;
    if (typeof revision === 'number') {
      return { currentRevision: revision, content };
    }
  }
  return { currentRevision: 0, content: null };
}

/**
 * HTTP implementation of the single data source. Wave 4 swaps this in for the
 * mock without touching any component. Every mutate carries an idempotency key
 * and the draft `PATCH` carries `If-Match`.
 */
export function createHttpWorkbenchDataSource(
  baseUrl: string,
  idempotencyKey: IdempotencySource = defaultIdempotencyKey,
): WorkbenchDataSource {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (response.status === 409) {
      const body = (await response.json().catch(() => null)) as
        | (ProblemDetails<unknown> & { details?: unknown })
        | null;
      if (body?.code === OPTIMISTIC_LOCK_CODE) {
        throw new WorkbenchConflictError(toConflictDetails(body.details ?? body));
      }
      throw new WorkbenchHttpError(409, body);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ProblemDetails<unknown> | null;
      throw new WorkbenchHttpError(response.status, body);
    }
    return (await response.json()) as T;
  }

  const base = `/api/v1/projects`;

  return {
    getProject(projectId: string): Promise<WorkbenchProject> {
      return request<WorkbenchProject>(`${base}/${projectId}`);
    },
    getStageProgress(projectId: string): Promise<WorkbenchStageProgress> {
      return request<WorkbenchStageProgress>(`${base}/${projectId}/stages`);
    },
    getDraft<K extends WorkbenchKind>(projectId: string, kind: K): Promise<WorkbenchDraft<K>> {
      return request<WorkbenchDraft<K>>(`${base}/${projectId}/workbench/${kind}`);
    },
    patchDraft<K extends WorkbenchKind>(
      projectId: string,
      kind: K,
      revision: number,
      content: WorkbenchContent<K>,
    ): Promise<WorkbenchDraft<K>> {
      return request<WorkbenchDraft<K>>(`${base}/${projectId}/workbench/${kind}`, {
        method: 'PATCH',
        headers: { 'If-Match': String(revision), 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify({ content }),
      });
    },
    createSnapshot<K extends WorkbenchKind>(
      projectId: string,
      kind: K,
      revision: number,
    ): Promise<WorkbenchSnapshot> {
      return request<WorkbenchSnapshot>(`${base}/${projectId}/workbench/${kind}/snapshots`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify({ revision }),
      });
    },
    preview(projectId: string, kind: PreviewableKind, revision: number): Promise<PreviewResult> {
      return request<PreviewResult>(`${base}/${projectId}/workbench/preview`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify({ kind, revision }),
      });
    },
    runSimulator(projectId: string, input: string, draftRevision: number): Promise<SimulatorRun> {
      return request<SimulatorRun>(`${base}/${projectId}/simulator-runs`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify({ input, draftRevision }),
      });
    },
    async getTutorSuggestions(): Promise<TutorSuggestion[]> {
      // Gap: no project-scoped suggestion endpoint is defined yet.
      return [];
    },
    async heartbeat(): Promise<boolean> {
      try {
        await fetch(`${baseUrl}/health`, { method: 'GET' });
        return true;
      } catch {
        return false;
      }
    },
  };
}
