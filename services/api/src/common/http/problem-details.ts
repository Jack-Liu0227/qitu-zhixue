import { HttpException, HttpStatus } from '@nestjs/common';
import type { ProblemDetails, ProblemFieldError } from '@qitu/contracts';

/**
 * 统一的 HTTP 错误信封（RFC 9457 Problem Details）。
 *
 * 信封的**类型定义**在 `@qitu/contracts`（`ProblemDetails`），这里只负责
 * 把任意异常映射成它。前端契约与后端实现共用同一个类型，不会各写一套。
 *
 * 背景：此前错误响应有两种互不兼容的形态 ——
 *  - `new BadRequestException('...')` → Nest 默认的 `{ statusCode, message, error }`；
 *  - `new BadRequestException({ code: 'XXX', message })` → 原样透传的 `{ code, message }`。
 * 于是前端只能靠猜，机器可读的 `code` 时有时无（归档为 Issue #23）。
 *
 * 已核实的既有前端读取面（不能改坏）：
 *  - `apps/student-center/features/workbench/api/workbenchApi.ts` 读顶层 `code`
 *    与可选的 `details`；
 *  - `apps/admin-console/lib/api/settings.ts` 读顶层 `message`。
 * 两者本过滤器都保留。
 *
 * 内容协商：响应 `Content-Type: application/problem+json`（RFC 9457 §3）。
 *
 * 安全约定：
 *  - 5xx **绝不**回传异常原文 —— 数据库连接串、内网地址、堆栈都可能藏在里面。
 *    真实原因只进服务端日志。
 *  - `instance` 只保留 path，丢掉 query，避免把带 token 的查询串写进响应体与日志。
 */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export type { ProblemDetails, ProblemFieldError };

/** HTTP 状态短语（RFC 9457 要求 `title` 在 `about:blank` 时为状态短语）。 */
export const HTTP_TITLES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/**
 * 业务代码未显式给出 `code` 时的兜底码。
 *
 * 只在这里集中定义，保证「同一个 HTTP 状态 → 同一个兜底码」，
 * 不让每个控制器各写一套。
 */
export const DEFAULT_ERROR_CODES: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  408: 'REQUEST_TIMEOUT',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

export function titleFor(status: number): string {
  return HTTP_TITLES[status] ?? (status >= 500 ? 'Server Error' : 'Request Error');
}

export function defaultCodeFor(status: number): string {
  return DEFAULT_ERROR_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED');
}

export interface ProblemContext {
  /** 出错路径（调用方需已去掉 query）。 */
  instance?: string;
  traceId?: string;
}

interface RawProblem {
  /** 业务代码显式给出的 `code`，没有则 undefined。 */
  code?: string;
  /** 业务代码显式给出的 `detail` / `message`（可能是数组）。 */
  detail?: string;
  errors?: ProblemFieldError[];
  /** 码专属上下文（如 `WorkbenchConflictDetails`）。 */
  details?: unknown;
}

/** 从 Nest 的 `getResponse()` 结果里提取 `code` / `message` / `errors` / `details`。 */
function readRawProblem(payload: unknown): RawProblem {
  if (typeof payload === 'string') {
    const detail = payload.trim();
    return detail === '' ? {} : { detail };
  }
  if (payload === null || typeof payload !== 'object') {
    return {};
  }

  const record = payload as Record<string, unknown>;
  const code = typeof record.code === 'string' && record.code.trim() !== '' ? record.code.trim() : undefined;

  // Nest ValidationPipe 会给出 `message: string[]`。
  const errors: ProblemFieldError[] = [];
  const rawErrors = record.errors;
  if (Array.isArray(rawErrors)) {
    for (const item of rawErrors) {
      if (typeof item === 'string') {
        errors.push({ message: item });
      } else if (item !== null && typeof item === 'object') {
        const entry = item as Record<string, unknown>;
        errors.push({
          path: typeof entry.path === 'string' ? entry.path : undefined,
          message: typeof entry.message === 'string' ? entry.message : '字段不合法',
        });
      }
    }
  }

  const messages: string[] = [];
  if (Array.isArray(record.message)) {
    for (const item of record.message) {
      if (typeof item === 'string' && item.trim() !== '') messages.push(item.trim());
    }
    for (const item of messages) errors.push({ message: item });
  } else if (typeof record.message === 'string' && record.message.trim() !== '') {
    messages.push(record.message.trim());
  }
  if (typeof record.detail === 'string' && record.detail.trim() !== '') {
    messages.push(record.detail.trim());
  }

  return {
    code,
    detail: messages[0],
    errors: errors.length > 0 ? errors : undefined,
    details: record.details,
  };
}

/** 兜底 detail：5xx 一律给固定文案，避免把内部实现细节漏出去。 */
function fallbackDetail(status: number): string {
  if (status >= 500) return '服务器暂时无法完成该请求，请稍后重试。';
  if (status === 404) return '请求的资源不存在。';
  if (status === 401) return '未登录或会话已失效。';
  if (status === 403) return '当前账号无权执行该操作。';
  return titleFor(status);
}

/**
 * 纯函数：把任意异常转成统一的 Problem Details。
 *
 * 不依赖任何 Nest 运行时（不碰 request/response），因此可以直接单测。
 */
export function buildProblemDetails(exception: unknown, context: ProblemContext = {}): ProblemDetails {
  const isHttpException = exception instanceof HttpException;
  const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
  const raw = readRawProblem(isHttpException ? safeGetResponse(exception) : undefined);

  // 5xx 不回传业务侧的原文（可能是 SQL 片段、连接串、外部服务响应）。
  const detail = status >= 500 ? fallbackDetail(status) : (raw.detail ?? fallbackDetail(status));

  return {
    type: 'about:blank',
    title: titleFor(status),
    status,
    detail,
    ...(context.instance === undefined ? {} : { instance: context.instance }),
    code: raw.code ?? defaultCodeFor(status),
    ...(context.traceId === undefined ? {} : { traceId: context.traceId }),
    ...(status >= 500 || raw.errors === undefined ? {} : { errors: raw.errors }),
    ...(status >= 500 || raw.details === undefined ? {} : { details: raw.details }),
    message: detail,
  };
}

/** `getResponse()` 在极少数自定义异常里可能抛错，不能让错误处理本身再崩一次。 */
function safeGetResponse(exception: HttpException): unknown {
  try {
    return exception.getResponse();
  } catch {
    return undefined;
  }
}

/**
 * 从请求头里取 `x-request-id`，非法则新建。
 *
 * 入参必须做字符集校验：直接回显任意请求头会变成响应头注入 / 日志注入。
 */
export function resolveTraceId(incoming: unknown, generate: () => string): string {
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  if (typeof value === 'string' && /^[A-Za-z0-9._:-]{8,64}$/.test(value.trim())) {
    return value.trim();
  }
  return generate();
}

/** 只保留 path：query 里可能有 token / 邀请码，不该出现在响应体或日志里。 */
export function pathOnly(url: string | undefined): string | undefined {
  if (url === undefined || url === '') return undefined;
  const queryIndex = url.search(/[?#]/);
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}
