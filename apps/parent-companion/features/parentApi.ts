import { ApiError, createApiClient, createIdempotencyKey } from '@qitu/api-client';
import type {
  ChildRef,
  ParentHomePageData,
  ParentMessagesPageData,
  ParentProgressPageData,
  SendEncouragementResponse,
  ParentMessageAckResponse,
  SubmitParentFeedbackResponse,
  ParentFeedbackDetailResponse,
} from '@qitu/contracts';
import type { ParentGrowthPageData } from './growth/types';

export type DataSource = 'demo' | 'live';
export type ParentPageData<T> = T & { dataSource?: DataSource };
export class ParentOfflineError extends Error {}
export class ParentPermissionError extends Error {}

const client = createApiClient('');
async function get<T>(path: string): Promise<T> {
  try {
    return await client.get<T>(path);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403))
      throw new ParentPermissionError();
    if ((error instanceof ApiError && error.status === 0) || error instanceof TypeError)
      throw new ParentOfflineError();
    throw error;
  }
}
export const parentApi = {
  feedbackDetail: (id: string) => get<{ data: ParentFeedbackDetailResponse }>(`/api/v1/parent/feedback/${encodeURIComponent(id)}`),
  children: () => get<{ data: ChildRef[] }>('/api/v1/parent/children'),
  home: (id: string) =>
    get<{ data: ParentPageData<ParentHomePageData> }>(
      `/api/v1/parent/children/${encodeURIComponent(id)}/dashboard`,
    ),
  progress: (id: string, artifactRef?: string) =>
    get<{ data: ParentPageData<ParentProgressPageData> }>(
      `/api/v1/parent/children/${encodeURIComponent(id)}/progress${artifactRef ? `?artifactRef=${encodeURIComponent(artifactRef)}` : ''}`,
    ),
  messages: (id: string) =>
    get<{ data: ParentPageData<ParentMessagesPageData> }>(
      `/api/v1/parent/children/${encodeURIComponent(id)}/messages`,
    ),
  growth: (id: string) =>
    get<{ data: ParentGrowthPageData }>(
      `/api/v1/parent/children/${encodeURIComponent(id)}/growth?limit=20`,
    ),
  async post<T>(
    path: string,
    body: unknown,
    options?: { idempotencyKey?: string },
  ): Promise<T> {
    let response: Response;
    try { response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        // 复用调用方传入的幂等键：网络失败重试时不得生成新的键，否则会重复建单。
        'Idempotency-Key': options?.idempotencyKey ?? createIdempotencyKey(),
      },
      body: JSON.stringify(body),
    }); } catch (error) {
      if (error instanceof TypeError) throw new ParentOfflineError();
      throw error;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ParentPermissionError();
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
  },
};
export type {
  ChildRef,
  ParentHomePageData,
  ParentMessagesPageData,
  ParentProgressPageData,
  SendEncouragementResponse,
  ParentMessageAckResponse,
  SubmitParentFeedbackResponse,
};
