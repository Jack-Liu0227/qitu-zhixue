import type { MasteryReadPort } from '@qitu/contracts';
import { createMasteryReadPort } from './mastery';

export { createQituReadSDK } from './qitu-sdk';
export type { QituReadSDK } from './qitu-sdk';
export { createMasteryReadPort } from './mastery';
export type { MasteryTransport } from './mastery';

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(
    path: string,
    body?: unknown,
    options?: { headers?: Record<string, string> },
  ): Promise<T>;
  patch<T>(
    path: string,
    body?: unknown,
    options?: { headers?: Record<string, string> },
  ): Promise<T>;
  mastery: MasteryReadPort;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function createApiClient(baseUrl: string): ApiClient {
  // 先构造传输层，掌握度只读 facade 只拿到其中的 `get<T>`（见 mastery.ts），
  // 所以浏览器侧不存在通过 facade 写掌握状态的入口。
  const transport = {
    async get<T>(path: string): Promise<T> {
      // `credentials: 'include'` 是必须的：会话是 httpOnly cookie，不带它
      // 跨源时（例如开发期直连 :4100）浏览器会直接丢掉 cookie，接口全是 401。
      // 同源相对路径下这是无副作用的。
      const response = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) throw new ApiError('API request failed', response.status);
      return (await response.json()) as T;
    },

    async post<T>(
      path: string,
      body?: unknown,
      options?: { headers?: Record<string, string> },
    ): Promise<T> {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new ApiError('API request failed', response.status);
      return (await response.json()) as T;
    },

    async patch<T>(
      path: string,
      body?: unknown,
      options?: { headers?: Record<string, string> },
    ): Promise<T> {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'PATCH',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new ApiError('API request failed', response.status);
      return (await response.json()) as T;
    },
  };

  return {
    ...transport,
    mastery: createMasteryReadPort(transport),
  };
}
