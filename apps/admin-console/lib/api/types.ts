/**
 * 管理后台 API 层类型与错误分类。
 *
 * 约定（AGENTS.md 硬约束的前端落点）：
 * - 所有响应统一走 `{ data: ... }` 信封；错误统一走 RFC 9457
 *   `application/problem+json`（见 `@qitu/contracts` 的 `ProblemDetails`）。
 * - 请求失败**必须抛出**并渲染成可见的 error / offline / permission 状态，
 *   禁止任何「静默回退到内置假数据」的写法。
 * - 前端权限只负责显示：401/403 一律按服务端结果渲染，不在前端做对象级
 *   权限的最终判断。
 * - 写操作（POST/PATCH）必须携带 `Idempotency-Key` HTTP 头；同一次未确认
 *   的重试必须复用同一个键（见 `createIdempotentRetryKey`）。
 */
import type { ProblemCode, ProblemDetails, ProblemFieldError } from '@qitu/contracts';
import { IDEMPOTENCY_KEY_HEADER } from '@qitu/contracts';

export class AdminOfflineError extends Error {
  constructor() {
    super('无法连接服务器');
    this.name = 'AdminOfflineError';
  }
}

export class AdminPermissionError extends Error {
  constructor(message?: string) {
    super(message ?? '当前账号没有访问该资源的权限');
    this.name = 'AdminPermissionError';
  }
}

/**
 * 服务端返回的业务失败（携带稳定错误码与字段级校验错误）。
 *
 * 页面必须把 `code` 与 `message` 原样呈现（例如空 PATCH、
 * `leaderAssistantId` 不在成员列表、`theoryMasteredGate=false` 之类的
 * 服务端校验失败），不允许吞掉或替换成笼统提示。
 */
export class AdminApiError extends Error {
  readonly status: number;
  readonly code: ProblemCode;
  readonly fieldErrors: readonly ProblemFieldError[];
  readonly traceId: string | null;

  constructor(init: {
    status: number;
    code: ProblemCode;
    message: string;
    fieldErrors?: readonly ProblemFieldError[];
    traceId?: string | null;
  }) {
    super(init.message);
    this.name = 'AdminApiError';
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors ?? [];
    this.traceId = init.traceId ?? null;
  }
}

export interface DataEnvelope<T> {
  data: T;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

/**
 * 生成写操作幂等键。优先 `crypto.randomUUID`；不可用时回退到
 * 时间戳 + 随机数（仍是短生命周期、仅存在于内存的重试键）。
 */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const random = Math.random().toString(36).slice(2);
  return `admin-${Date.now().toString(36)}-${random}`;
}

/**
 * 「同一操作失败重试复用同一幂等键」的极简实现：
 * 以操作的确定性签名（资源 id + 载荷 JSON）为界——签名不变就复用旧键，
 * 签名变化（用户又改了字段）才换新键；服务端确认后由调用方清除。
 */
export function createIdempotentRetryKey(): {
  keyFor: (signature: string) => string;
  acknowledge: () => void;
} {
  let pending: { signature: string; key: string } | null = null;
  return {
    keyFor(signature: string): string {
      if (pending === null || pending.signature !== signature) {
        pending = { signature, key: newIdempotencyKey() };
      }
      return pending.key;
    },
    acknowledge(): void {
      pending = null;
    },
  };
}

export interface AdminEnvelopeRequestOptions {
  path: string;
  method: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  /** 仅写请求（POST/PATCH）允许且必须携带；GET 携带会被忽略。 */
  idempotencyKey?: string;
}

/**
 * 统一的 `{ data: ... }` 信封请求。
 *
 * 失败分类（全部以异常抛出，绝不静默）：
 * - fetch 抛 TypeError / 状态 0 → `AdminOfflineError`（断网）；
 * - 401/403 → `AdminPermissionError`（按服务端结果渲染，不在前端预判）；
 * - 其余非 2xx → `AdminApiError`，尽量解析 ProblemDetails 的
 *   `code`/`detail`/`errors`/`traceId` 原样上抛。
 */
export async function adminEnvelopeRequest<T>(options: AdminEnvelopeRequestOptions): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (
    options.idempotencyKey !== undefined &&
    options.idempotencyKey.length > 0 &&
    options.method !== 'GET'
  ) {
    headers[IDEMPOTENCY_KEY_HEADER] = options.idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(options.path, {
      method: options.method,
      credentials: 'include',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    // fetch 直接抛错（DNS 失败、断网、进程拒绝连接）——这是「断网」，不是「有数据」。
    throw new AdminOfflineError();
  }

  if (response.status === 0) throw new AdminOfflineError();

  if (!response.ok) {
    const problem = await readProblemDetails(response);
    if (response.status === 401 || response.status === 403) {
      throw new AdminPermissionError(
        problem?.detail ?? problem?.message ?? `权限校验失败（HTTP ${response.status}）`,
      );
    }
    throw new AdminApiError({
      status: response.status,
      code: problem?.code ?? `HTTP_${response.status}`,
      message:
        problem?.detail ??
        problem?.message ??
        `请求失败（HTTP ${response.status}），请稍后重试`,
      fieldErrors: problem?.errors ?? [],
      traceId: problem?.traceId ?? response.headers.get('x-request-id') ?? null,
    });
  }

  const payload = (await response.json().catch(() => null)) as DataEnvelope<T> | null;
  if (payload === null || !('data' in payload)) {
    throw new AdminApiError({
      status: response.status,
      code: 'ENVELOPE_MISSING_DATA',
      message: '服务端返回了缺少 data 信封的响应，已按失败处理。',
    });
  }
  return payload.data;
}

/**
 * 尽力把错误响应体解析为 `ProblemDetails`；兼容旧形态
 * `{ code, message }` 与 Nest 默认 `{ statusCode, message, error }`。
 * 解析不出来（非 JSON）返回 null，由调用方兜底。
 */
async function readProblemDetails(response: Response): Promise<ProblemDetails | null> {
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (body === null) return null;
  const nested =
    typeof body['error'] === 'object' && body['error'] !== null
      ? (body['error'] as Record<string, unknown>)
      : null;
  const detail = typeof body['detail'] === 'string' ? body['detail'] : null;
  const message =
    typeof body['message'] === 'string'
      ? body['message']
      : nested !== null && typeof nested['message'] === 'string'
        ? nested['message']
        : null;
  const text = detail ?? message ?? null;
  if (text === null) return null;
  const code =
    typeof body['code'] === 'string'
      ? (body['code'] as ProblemCode)
      : nested !== null && typeof nested['code'] === 'string'
        ? (nested['code'] as ProblemCode)
        : `HTTP_${response.status}`;
  const errorsRaw = body['errors'];
  const fieldErrors: ProblemFieldError[] = Array.isArray(errorsRaw)
    ? errorsRaw.filter(
        (item): item is ProblemFieldError =>
          typeof item === 'object' && item !== null && typeof (item as { message?: unknown }).message === 'string',
      )
    : [];
  return {
    type: typeof body['type'] === 'string' ? body['type'] : 'about:blank',
    title: typeof body['title'] === 'string' ? body['title'] : response.statusText,
    status: typeof body['status'] === 'number' ? body['status'] : response.status,
    detail: text,
    message: text,
    code,
    errors: fieldErrors,
    traceId: typeof body['traceId'] === 'string' ? body['traceId'] : undefined,
  };
}
