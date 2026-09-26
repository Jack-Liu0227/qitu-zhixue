import { ApiError, createApiClient } from '@qitu/api-client';
import {
  ParentGrowthOfflineError,
  ParentGrowthPermissionError,
  type ParentGrowthDataSource,
} from './data/parentGrowthDataSource';
import type { ChildRef, ParentGrowthPageData, StudentGrowthQuery } from './types';

interface DataEnvelope<T> {
  data: T;
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

/**
 * 真实只读 API 实现。
 *
 * 端点（同一份服务端成长记录的另一投影）：
 *  - GET /api/v1/parent/children
 *  - GET /api/v1/parent/children/:childId/growth?cursor=…&limit=…
 *
 * 全部使用**同源相对路径**（nginx 转发）并携带 `credentials: 'include'`，
 * 会话是 httpOnly cookie，跨源 baseUrl 会静默丢掉 cookie 导致 401。
 */
export function createParentGrowthApiDataSource(baseUrl: string): ParentGrowthDataSource {
  const transport = createApiClient(baseUrl);

  /**
   * 在 HTTP 边界把传输失败翻译成模块错误分类，使五个页面状态都可达：
   *  - 401 / 403 → `ParentGrowthPermissionError`（权限不足）
   *  - status 0 或 fetch 的 `TypeError`（断网 / 拒绝连接）→
   *    `ParentGrowthOfflineError`
   *  - 其他状态或错误原样抛出 → 通用错误
   */
  const client = {
    async get<T>(path: string): Promise<T> {
      try {
        return await transport.get<T>(path);
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 401 || error.status === 403) {
            throw new ParentGrowthPermissionError();
          }
          if (error.status === 0) {
            throw new ParentGrowthOfflineError(null);
          }
          throw error;
        }
        if (error instanceof TypeError) {
          throw new ParentGrowthOfflineError(null);
        }
        throw error;
      }
    },
  };

  return {
    async getChildren(): Promise<ChildRef[]> {
      const response = await client.get<DataEnvelope<ChildRef[]>>('/api/v1/parent/children');
      return response.data;
    },

    async getGrowthPage(childId: string, query: StudentGrowthQuery): Promise<ParentGrowthPageData> {
      const response = await client.get<DataEnvelope<ParentGrowthPageData>>(
        `/api/v1/parent/children/${encodeURIComponent(childId)}/growth?${toQueryString(query)}`,
      );
      return response.data;
    },
  };
}
