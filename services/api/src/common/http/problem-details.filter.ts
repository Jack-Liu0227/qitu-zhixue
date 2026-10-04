import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  PROBLEM_CONTENT_TYPE,
  buildProblemDetails,
  pathOnly,
  resolveTraceId,
  type ProblemDetails,
} from './problem-details';

/**
 * 全局异常过滤器：所有未捕获异常统一成 RFC 9457 Problem Details。
 *
 * 注册位置：`main.ts` 的 `app.useGlobalFilters(new ProblemDetailsFilter())`。
 *
 * 为什么需要它：Nest 默认过滤器对 `HttpException` 会透传响应体，导致
 * 同一个 API 的错误形态取决于「抛的人怎么写」，前端只能做兼容分支。
 * 这里统一一次，并且：
 *  - 保留业务方显式给出的 `code`（契约里的 `ApiErrorCode` 原样透出）；
 *  - 保留 `message` 作为 `detail` 的兼容别名；
 *  - 5xx 只回固定文案，真实异常进日志（含堆栈）；
 *  - 回写 `x-request-id`，让用户报障时能对上日志。
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();

    const traceId = resolveTraceId(request.headers?.['x-request-id'], () =>
      randomBytes(8).toString('hex'),
    );
    const instance = pathOnly(request.originalUrl ?? request.url);

    const problem: ProblemDetails = buildProblemDetails(exception, { instance, traceId });

    if (problem.status >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `${problem.status} ${problem.code} ${request.method} ${instance ?? '-'} traceId=${traceId}`,
        stack ?? String(exception),
      );
    } else {
      this.logger.warn(
        `${problem.status} ${problem.code} ${request.method} ${instance ?? '-'} traceId=${traceId}`,
      );
    }

    // 响应可能已部分写出（例如 SSE 中途失败）——此时再写头会抛
    // ERR_HTTP_HEADERS_SENT，把原始错误盖掉。
    if (response.headersSent) {
      return;
    }

    response.setHeader('x-request-id', traceId);
    response.setHeader('content-type', PROBLEM_CONTENT_TYPE);
    response.status(problem.status);
    response.json(problem);
  }
}
