import { ApiError, createApiClient } from '@qitu/api-client';
import type {
  LessonQualityQueueItem, LessonQualityDecision, LessonQualityStatus,
  TeacherRosterPageData,
  TeacherStudentDetail,
  TeacherInterventionListPageData,
  TeacherInterventionDetail,
  TeacherInterventionActionRequest,
  TeacherInterventionActionResponse,
  TeacherStatisticsPageData,
  TeacherArtifactReviewPage,
  TeacherArtifactVersionView,
  TeacherReviewDecisionRequest,
  TeacherReviewDecisionResponse,
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
      detail?: string; message?: string; code?: string;
    } | null;
    const error = new ApiError(
      errorBody?.detail ?? errorBody?.message ?? errorBody?.error?.message ?? '请求失败',
      response.status,
      errorBody?.code ?? errorBody?.error?.code,
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
  lessonQuality: (studentId: string,cursor?:string) => get<{ data: { items: LessonQualityQueueItem[]; hasMore: boolean; nextCursor:string|null; unavailablePlans: number } }>(
    `/api/v1/teacher/students/${encodeURIComponent(studentId)}/lesson-quality${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  reviewLessonQuality: (planId: string, sessionId: string, body: LessonQualityDecision, key: string) =>
    post<{ data: { quality: LessonQualityStatus; replayed: boolean } }>(
      `/api/v1/learning-plans/${encodeURIComponent(planId)}/sessions/${encodeURIComponent(sessionId)}/quality-reviews`, body, key),
  artifactReviews: (studentId: string, offset = 0) =>
    get<{ data: TeacherArtifactReviewPage }>(`/api/v1/teacher/students/${encodeURIComponent(studentId)}/reviews?offset=${offset}&limit=20`),
  artifactVersions: (artifactId: string) =>
    get<{ data: TeacherArtifactVersionView[] }>(`/api/v1/artifacts/${encodeURIComponent(artifactId)}/versions`),
  decideArtifactReview: (reviewId: string, request: TeacherReviewDecisionRequest, idempotencyKey: string) =>
    post<{ data: TeacherReviewDecisionResponse }>(`/api/v1/teacher/reviews/${encodeURIComponent(reviewId)}/decision`, request, idempotencyKey),
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
