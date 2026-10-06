import { ApiError, createApiClient } from '@qitu/api-client';
import type {
  TeacherRosterPageData,
  TeacherStudentDetail,
  TeacherInterventionListPageData,
  TeacherInterventionDetail,
  TeacherInterventionActionRequest,
  TeacherInterventionActionResponse,
  TeacherStatisticsPageData,
} from '@qitu/contracts';
import type { TeamActivityItem, TeamRunNode } from '@qitu/ui';

export class TeacherOfflineError extends Error {}
export class TeacherPermissionError extends Error {}

export interface TeacherAgentRunProjection {
  runId: string | null;
  status: TeamRunNode['status'] | 'idle';
  nodes: TeamRunNode[];
  activity: TeamActivityItem[];
  generatedAt: string | null;
}

const client = createApiClient('');

async function get<T>(path: string): Promise<T> {
  try {
    return await client.get<T>(path);
  } catch (error) {
    const status = readErrorStatus(error);
    if (status === 401 || status === 403)
      throw new TeacherPermissionError();
    if (status === 0 || error instanceof TypeError)
      throw new TeacherOfflineError();
    throw error;
  }
}

async function post<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof TypeError) throw new TeacherOfflineError();
    throw error;
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new TeacherPermissionError();
    if (response.status === 0) throw new TeacherOfflineError();
    const errorBody = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    const error = new ApiError(
      errorBody?.error?.message ?? '请求失败',
      response.status,
      errorBody?.error?.code,
    );
    throw error;
  }
  return (await response.json()) as T;
}

function readErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export const teacherApi = {
  roster: () => get<{ data: TeacherRosterPageData }>('/api/v1/teacher/roster'),
  studentDetail: (studentId: string) =>
    get<{ data: TeacherStudentDetail }>(
      `/api/v1/teacher/students/${encodeURIComponent(studentId)}`,
    ),
  interventions: () =>
    get<{ data: TeacherInterventionListPageData }>('/api/v1/teacher/interventions'),
  interventionDetail: (id: string) =>
    get<{ data: TeacherInterventionDetail }>(
      `/api/v1/teacher/interventions/${encodeURIComponent(id)}`,
    ),
  interventionAction: (id: string, body: TeacherInterventionActionRequest, idempotencyKey: string) =>
    post<{ data: TeacherInterventionActionResponse }>(
      `/api/v1/teacher/interventions/${encodeURIComponent(id)}/actions`,
      body,
      idempotencyKey,
    ),
  statistics: () => get<{ data: TeacherStatisticsPageData }>('/api/v1/teacher/statistics'),
  agentRuns: (studentId: string) =>
    get<{ data: TeacherAgentRunProjection }>(
      `/api/v1/teacher/students/${encodeURIComponent(studentId)}/agent-runs`,
    ),
};

export type {
  TeacherRosterPageData,
  TeacherStudentRow,
  TeacherStudentDetail,
  TeacherInterventionListPageData,
  TeacherInterventionRow,
  TeacherInterventionDetail,
  TeacherInterventionActionRequest,
  TeacherInterventionActionResponse,
  TeacherStatisticsPageData,
} from '@qitu/contracts';
