/** Credentialed business transport. Request ids are supplied by the caller and kept across retries. */
export class BusinessApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

export async function businessRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH';
    body?: unknown;
    key?: string;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    throw new BusinessApiError('网络已断开，请恢复连接后重试', 0);
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: options.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.key ? { 'Idempotency-Key': options.key } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new BusinessApiError('无法连接服务，请检查网络后重试', 0);
  }
  if (!response.ok) {
    let message =
      response.status === 401 || response.status === 403
        ? '当前账号没有此操作权限，请重新登录或核对授权'
        : '请求未完成，请稍后重试';
    let code: string | null = null;
    const detail: unknown = await response.json().catch(() => null);
    if (detail && typeof detail === 'object') {
      if ('detail' in detail && typeof detail.detail === 'string') message = detail.detail;
      else if ('message' in detail && typeof detail.message === 'string') message = detail.message;
      if ('code' in detail && typeof detail.code === 'string') code = detail.code;
    }
    throw new BusinessApiError(message, response.status, code);
  }
  const envelope: { data: T } = await response.json();
  return envelope.data;
}
/** The deployed HTTP entry supports getRandomValues even when randomUUID is unavailable. */
export function businessIdempotencyKey(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}
