import { ApiError, createApiClient } from '@qitu/api-client';
import {
  GrowthOfflineError,
  GrowthPermissionError,
  type GrowthDataSource,
} from './data/growthDataSource';
import type {
  GrowthProjectOption,
  StudentGrowthEntry,
  StudentGrowthPageData,
  StudentGrowthQuery,
  StudentGrowthSummary,
  StudentGrowthTimeline,
} from './types';

/**
 * Read-only API-backed implementation of `GrowthDataSource`.
 *
 * It exposes GET only (the shared `createApiClient` has no write helper), which
 * mirrors the server rule that growth records, metrics and milestones have no
 * client write path (growth-spec.md §8, acceptance criterion 2, 14).
 *
 * Endpoints are spec-proposed and currently a contract gap (spec §8 C1/C2):
 *  - GET /api/v1/students/me/growth/summary
 *  - GET /api/v1/students/me/growth?cursor=…&limit=…&type=…&projectId=…&from=…&to=…
 */

interface GrowthEnvelope<T> {
  data: T;
  meta?: {
    nextCursor?: string | null;
    hasNext?: boolean;
  };
  requestId?: string;
}

function toQueryString(query: StudentGrowthQuery): string {
  const params = new URLSearchParams();
  if (query.type !== 'all') {
    params.set('type', query.type);
  }
  if (query.projectId !== null) {
    params.set('projectId', query.projectId);
  }
  if (query.from !== null) {
    params.set('from', query.from);
  }
  if (query.to !== null) {
    params.set('to', query.to);
  }
  if (query.cursor !== null) {
    params.set('cursor', query.cursor);
  }
  params.set('limit', String(query.limit));
  return params.toString();
}

export function createGrowthApiDataSource(baseUrl: string): GrowthDataSource {
  const transport = createApiClient(baseUrl);

  /**
   * Translate transport failures into this module's error taxonomy at the HTTP
   * boundary, so all five page states are reachable through the real API:
   *  - 401 / 403 → `GrowthPermissionError` (permission-denied)
   *  - status 0, or fetch's `TypeError` (DNS/refused/devtools offline) →
   *    `GrowthOfflineError`
   *  - any other status or error (e.g. 500, malformed payload) is rethrown
   *    unchanged → generic error
   *
   * The mapping is intentionally narrow: only auth failures and loss of
   * connectivity become non-generic errors.
   */
  const client = {
    async get<T>(path: string): Promise<T> {
      try {
        return await transport.get<T>(path);
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 401 || error.status === 403) {
            throw new GrowthPermissionError();
          }
          if (error.status === 0) {
            throw new GrowthOfflineError(null);
          }
          throw error;
        }
        if (error instanceof TypeError) {
          throw new GrowthOfflineError(null);
        }
        throw error;
      }
    },
  };

  async function loadTimeline(query: StudentGrowthQuery): Promise<StudentGrowthTimeline> {
    const response = await client.get<GrowthEnvelope<{ items: StudentGrowthEntry[] }>>(
      `/api/v1/students/me/growth?${toQueryString(query)}`,
    );
    const items = response.data.items;
    return {
      items,
      nextCursor: response.meta?.nextCursor ?? null,
      hasNext: response.meta?.hasNext ?? false,
    };
  }

  return {
    async loadGrowthPage(query: StudentGrowthQuery): Promise<StudentGrowthPageData> {
      const [summary, timeline, projects] = await Promise.all([
        client.get<GrowthEnvelope<StudentGrowthSummary>>('/api/v1/students/me/growth/summary'),
        loadTimeline(query),
        client.get<GrowthEnvelope<GrowthProjectOption[]>>('/api/v1/students/me/projects/summaries'),
      ]);
      return {
        summary: summary.data,
        timeline,
        projects: projects.data,
        hasAnyProject: projects.data.length > 0,
      };
    },
    async getSummary(): Promise<StudentGrowthSummary> {
      const response = await client.get<GrowthEnvelope<StudentGrowthSummary>>(
        '/api/v1/students/me/growth/summary',
      );
      return response.data;
    },
    getTimeline: loadTimeline,
    async getProjectOptions(): Promise<GrowthProjectOption[]> {
      const response = await client.get<GrowthEnvelope<GrowthProjectOption[]>>(
        '/api/v1/students/me/projects/summaries',
      );
      return response.data;
    },
  };
}
