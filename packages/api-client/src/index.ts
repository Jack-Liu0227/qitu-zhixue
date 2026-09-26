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

export function createApiClient(baseUrl: string) {
  return {
    async get<T>(path: string): Promise<T> {
      // `credentials: 'include'` 是必须的：会话是 httpOnly cookie，不带它
      // 跨源时（例如开发期直连 :4112）浏览器会直接丢掉 cookie，接口全是 401。
      // 同源相对路径下这是无副作用的。
      const response = await fetch(`${baseUrl}${path}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) throw new ApiError('API request failed', response.status);
      return (await response.json()) as T;
    },
  };
}
