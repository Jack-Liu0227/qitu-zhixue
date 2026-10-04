import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  buildProblemDetails,
  defaultCodeFor,
  pathOnly,
  resolveTraceId,
  titleFor,
} from './problem-details';

/**
 * 错误信封是四端共同的契约面：一旦形态漂移，前端要么做兼容分支，要么把
 * 「服务器内部错误」原文直接展示给学生。这里把关键约定钉住：
 *  - 业务显式 `code` 必须原样透出（契约里的 `ApiErrorCode` 靠它）；
 *  - `message` 兼容别名必须等于 `detail`；
 *  - 5xx 绝不回传异常原文；
 *  - `instance` 丢掉 query。
 */

describe('buildProblemDetails', () => {
  it('字符串异常 → 默认 code + 原样 detail', () => {
    const problem = buildProblemDetails(new ForbiddenException('模型配置仅向管理员开放'));

    assert.equal(problem.status, 403);
    assert.equal(problem.type, 'about:blank');
    assert.equal(problem.title, 'Forbidden');
    assert.equal(problem.code, 'FORBIDDEN');
    assert.equal(problem.detail, '模型配置仅向管理员开放');
    assert.equal(problem.message, problem.detail);
  });

  it('业务显式给出的 code 必须原样保留，不被兜底码覆盖', () => {
    const problem = buildProblemDetails(
      new ServiceUnavailableException({ code: 'MEMORY_UNAVAILABLE', message: '记忆存储不可用' }),
    );

    assert.equal(problem.status, 503);
    assert.equal(problem.code, 'MEMORY_UNAVAILABLE');
    assert.equal(problem.detail, '记忆存储不可用');
    assert.equal(problem.message, '记忆存储不可用');
  });

  it('401 / 404 的兜底码与契约里的码一致', () => {
    assert.equal(buildProblemDetails(new UnauthorizedException()).code, 'UNAUTHENTICATED');
    assert.equal(buildProblemDetails(new NotFoundException()).code, 'NOT_FOUND');
    assert.equal(buildProblemDetails(new UnauthorizedException()).status, 401);
  });

  it('5xx 不回传异常原文，只给固定文案', () => {
    const leak = 'connect ECONNREFUSED postgresql://qitu:secret@10.0.0.5:5432/qitu_dev';
    const problem = buildProblemDetails(new Error(leak));

    assert.equal(problem.status, 500);
    assert.equal(problem.code, 'INTERNAL_ERROR');
    assert.equal(problem.detail.includes('secret'), false);
    assert.equal(problem.detail.includes('ECONNREFUSED'), false);
    assert.equal(JSON.stringify(problem).includes('postgresql://'), false);
  });

  it('5xx 的 HttpException 也不回传业务原文', () => {
    const problem = buildProblemDetails(
      new InternalServerErrorException({ code: 'X', message: 'pg_advisory_lock 失败：relation "users" 不存在' }),
    );

    assert.equal(problem.status, 500);
    assert.equal(problem.detail.includes('advisory_lock'), false);
    assert.equal(problem.detail.includes('relation'), false);
    // 状态仍是 500，但业务码保留，便于服务端日志与前端埋点对齐。
    assert.equal(problem.code, 'X');
  });

  it('ValidationPipe 的数组 message 转成字段级 errors', () => {
    const problem = buildProblemDetails(
      new BadRequestException({ message: ['provider 不能为空', 'modelId 过长'] }),
    );

    assert.equal(problem.status, 400);
    assert.equal(problem.detail, 'provider 不能为空');
    assert.equal(problem.errors?.length, 2);
    assert.equal(problem.errors?.[0]?.message, 'provider 不能为空');
  });

  it('保留 `details`：前端 workbench 靠它做乐观锁重放（读的是顶层 code）', () => {
    const problem = buildProblemDetails(
      new ConflictException({
        code: 'WORKBENCH_OPTIMISTIC_LOCK_CONFLICT',
        message: '内容已被其他会话修改',
        details: { currentRevision: 7, content: { title: '服务端版本' } },
      }),
    );

    assert.equal(problem.status, 409);
    assert.equal(problem.code, 'WORKBENCH_OPTIMISTIC_LOCK_CONFLICT');
    assert.deepEqual(problem.details, { currentRevision: 7, content: { title: '服务端版本' } });
  });

  it('5xx 连同 details 一起丢弃（不给内部状态外泄的通道）', () => {
    const problem = buildProblemDetails(
      new InternalServerErrorException({
        code: 'X',
        message: 'boom',
        details: { connectionString: 'postgresql://qitu:secret@10.0.0.5:5432/qitu_dev' },
      }),
    );

    assert.equal('details' in problem, false);
    assert.equal(JSON.stringify(problem).includes('secret'), false);
  });

  it('带上实例与 traceId（仅当调用方给出）', () => {
    const withContext = buildProblemDetails(new NotFoundException(), {
      instance: '/api/v1/projects/abc',
      traceId: 'abcdef0123456789',
    });
    assert.equal(withContext.instance, '/api/v1/projects/abc');
    assert.equal(withContext.traceId, 'abcdef0123456789');

    const withoutContext = buildProblemDetails(new NotFoundException());
    assert.equal('instance' in withoutContext, false);
    assert.equal('traceId' in withoutContext, false);
  });

  it('非 HttpException 一律按 500 处理', () => {
    assert.equal(buildProblemDetails('boom').status, 500);
    assert.equal(buildProblemDetails(null).status, 500);
    assert.equal(buildProblemDetails(undefined).status, 500);
  });

  it('自定义 HttpException 状态码也能映射出 title 与兜底码', () => {
    const problem = buildProblemDetails(new HttpException('teapot', 418));
    assert.equal(problem.status, 418);
    assert.equal(problem.code, 'REQUEST_FAILED');
    assert.equal(titleFor(418).length > 0, true);
  });

  it('兜底码与状态短语对未知状态码不抛错', () => {
    assert.equal(defaultCodeFor(599), 'INTERNAL_ERROR');
    assert.equal(defaultCodeFor(499), 'REQUEST_FAILED');
    assert.equal(titleFor(599), 'Server Error');
  });
});

describe('pathOnly', () => {
  it('丢掉 query 与 hash，避免把 token 写进响应和日志', () => {
    assert.equal(pathOnly('/api/v1/projects/abc?token=secret#x'), '/api/v1/projects/abc');
    assert.equal(pathOnly('/api/v1/health'), '/api/v1/health');
    assert.equal(pathOnly(undefined), undefined);
    assert.equal(pathOnly(''), undefined);
  });
});

describe('resolveTraceId', () => {
  const generate = (): string => 'generated-trace-id';

  it('接受合法的传入 id，便于跨服务串联', () => {
    assert.equal(resolveTraceId('abcdef0123456789', generate), 'abcdef0123456789');
    assert.equal(resolveTraceId(['abcdef0123456789'], generate), 'abcdef0123456789');
    assert.equal(resolveTraceId('  0123456789abcdef  ', generate), '0123456789abcdef');
  });

  it('拒绝过短、超长与含非法字符的值（防响应头 / 日志注入）', () => {
    assert.equal(resolveTraceId('short', generate), 'generated-trace-id');
    assert.equal(resolveTraceId('x'.repeat(65), generate), 'generated-trace-id');
    assert.equal(resolveTraceId('abc\r\nX-Injected: 1', generate), 'generated-trace-id');
    assert.equal(resolveTraceId(undefined, generate), 'generated-trace-id');
    assert.equal(resolveTraceId(42, generate), 'generated-trace-id');
  });
});
