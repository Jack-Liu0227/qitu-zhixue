export class CompanyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function companyApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new CompanyApiError(
      typeof body?.detail === 'string'
        ? body.detail
        : typeof body?.message === 'string'
          ? body.message
          : '请求未完成，请重试',
      response.status,
    );
  return body.data as T;
}
export const money = (fen: number) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(fen / 100);
export const date = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
export const operationKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
