import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuditService } from '../../common/audit';
import type { AuthService } from '../identity-auth/auth.service';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { ModelRegistryController } from './model-registry.controller';
import { ModelRegistryService } from './model-registry.service';

/**
 * `POST /admin/model-providers/models/probe` 的服务层行为验证。
 *
 * 该端点服务于「新建渠道尚未保存」时的模型发现：不依赖任何已保存的
 * Provider 状态，用表单当前值直接探测。与 `connection-test.test.ts` 相同，
 * 全部使用**本地 mock 上游**（`127.0.0.1`），服务用内存模式（`db === null`）。
 *
 * 重点：
 * - 成功：返回上游真实模型，且按协议拼装正确鉴权头；
 * - SSRF 拒绝：链路本地 / 云元数据地址返回 `ok=false`，不发请求；
 * - 上游非 200：`ok=false` 且错误带状态码；
 * - 密钥脱敏：任何失败响应都不含明文密钥；
 * - 只探测 `/v1/models`，不发起推理。
 */

function memoryService(): ModelRegistryService {
  return new ModelRegistryService(null, new AuditService(null));
}

interface UpstreamCall {
  url: string;
  headers: Record<string, string | string[] | undefined>;
}

interface Upstream {
  baseUrl: string;
  calls: UpstreamCall[];
  close: () => Promise<void>;
}

/** 启动一个只实现 `/v1/models` 的本地 mock 上游。 */
async function startUpstream(
  options: {
    models?: string[];
    /** 非 200 时直接返回该状态（用于验证失败语义）。 */
    status?: number;
    /** 要求匹配的请求头；不匹配返回 401。 */
    requireHeaders?: Record<string, string | undefined>;
  } = {},
): Promise<Upstream> {
  const calls: UpstreamCall[] = [];
  const server = createServer((req, res) => {
    calls.push({ url: req.url ?? '', headers: req.headers });
    if (!(req.url ?? '').endsWith('/v1/models')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    for (const [key, expected] of Object.entries(options.requireHeaders ?? {})) {
      if (expected !== undefined && req.headers[key] !== expected) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
    }
    const status = options.status ?? 200;
    if (status !== 200) {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream failure' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: (options.models ?? []).map((id) => ({ id })) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('mock 上游未能分配端口');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** 所有探测都必须只打到 `/v1/models`：probe 不发起推理。 */
function assertOnlyModelsProbe(calls: UpstreamCall[]): void {
  assert.ok(calls.length >= 1, '应至少探测一次上游');
  for (const call of calls) {
    assert.ok(call.url.endsWith('/v1/models'), `只应探测 /v1/models，实际：${call.url}`);
  }
}

test('probe：未保存供应商也能拉取上游真实模型（Bearer 鉴权头正确）', async () => {
  const upstream = await startUpstream({
    models: ['deepseek-chat', 'deepseek-reasoner'],
    requireHeaders: { authorization: 'Bearer sk-probe-secret-001' },
  });
  try {
    const service = memoryService();

    const result = await service.probeModels(
      {
        baseUrl: upstream.baseUrl,
        api: 'openai-completions',
        apiKey: 'sk-probe-secret-001',
        authHeader: true,
      },
      'admin-1',
    );

    assert.equal(result.ok, true);
    assert.equal(result.error, null);
    assert.deepEqual(
      result.models.map((model) => model.id),
      ['deepseek-chat', 'deepseek-reasoner'],
    );
    // 拉取来的模型保守声明为纯文本能力（见 fetch-models.ts）。
    assert.ok(result.models.every((model) => model.source === 'fetched'));
    assert.ok(result.models.every((model) => model.input.join() === 'text'));
    assertOnlyModelsProbe(upstream.calls);
    assert.equal(upstream.calls[0]!.headers.authorization, 'Bearer sk-probe-secret-001');
    // probe 不写任何 Provider 状态。
    assert.equal(service.listProviders().providers.length, 0);
  } finally {
    await upstream.close();
  }
});

test('probe：anthropic-messages 用 x-api-key，忽略 authHeader', async () => {
  const upstream = await startUpstream({
    models: ['claude-sonnet-4-5'],
    requireHeaders: { 'x-api-key': 'sk-ant-probe-001', 'anthropic-version': '2023-06-01' },
  });
  try {
    const service = memoryService();

    const result = await service.probeModels(
      {
        baseUrl: upstream.baseUrl,
        api: 'anthropic-messages',
        apiKey: 'sk-ant-probe-001',
        authHeader: false,
      },
      'admin-1',
    );

    assert.equal(result.ok, true);
    assert.equal(upstream.calls[0]!.headers['x-api-key'], 'sk-ant-probe-001');
    assert.equal(upstream.calls[0]!.headers['anthropic-version'], '2023-06-01');
    assertOnlyModelsProbe(upstream.calls);
  } finally {
    await upstream.close();
  }
});

test('probe：SSRF 拒绝链路本地 / 云元数据地址，且不发起请求', async () => {
  const service = memoryService();

  for (const baseUrl of [
    'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal',
    'ftp://example.com',
    'not-a-url',
  ]) {
    const result = await service.probeModels(
      { baseUrl, api: 'openai-completions', apiKey: 'sk-probe-secret-002' },
      'admin-1',
    );
    assert.equal(result.ok, false, `${baseUrl} 应被拒绝`);
    assert.deepEqual(result.models, []);
    assert.ok((result.error ?? '').length > 0);
    assert.doesNotMatch(JSON.stringify(result), /sk-probe-secret-002/);
  }
});

test('probe：上游非 200 返回 ok=false，错误带状态码且不含密钥', async () => {
  const upstream = await startUpstream({ status: 500 });
  try {
    const service = memoryService();

    const result = await service.probeModels(
      {
        baseUrl: upstream.baseUrl,
        api: 'openai-completions',
        apiKey: 'sk-probe-secret-003',
        authHeader: true,
      },
      'admin-1',
    );

    assert.equal(result.ok, false);
    assert.deepEqual(result.models, []);
    assert.match(result.error ?? '', /HTTP 500/);
    // 纵深防御：整个响应体（含脱敏后的 error）绝不出现明文密钥。
    assert.doesNotMatch(JSON.stringify(result), /sk-probe-secret-003/);
    assertOnlyModelsProbe(upstream.calls);
  } finally {
    await upstream.close();
  }
});

test('probe：上游鉴权失败（401）同样脱敏，绝不回填预设模型', async () => {
  const upstream = await startUpstream({ requireHeaders: { authorization: 'Bearer another-key' } });
  try {
    const service = memoryService();

    const result = await service.probeModels(
      {
        baseUrl: upstream.baseUrl,
        api: 'openai-completions',
        apiKey: 'sk-probe-secret-004',
        authHeader: true,
      },
      'admin-1',
    );

    assert.equal(result.ok, false);
    assert.deepEqual(result.models, [], '失败时必须返回空列表，而不是任何预设模型');
    assert.match(result.error ?? '', /HTTP 401/);
    assert.doesNotMatch(JSON.stringify(result), /sk-probe-secret-004/);
  } finally {
    await upstream.close();
  }
});

/* --------------------------- 控制器层（鉴权 + 白名单） --------------------------- */

/** 构造只用于 probe 的控制器：会话解析成可控的假 AuthService。 */
function probeController(
  role: 'admin' | 'teacher' | null,
): ModelRegistryController {
  const authService = {
    getSession: () => {
      if (role === null) throw new Error('no session');
      return { user: { id: 'user-1', role } };
    },
  } as unknown as AuthService;
  const idempotency = {} as IdempotencyStore;
  return new ModelRegistryController(memoryService(), authService, idempotency);
}

const ADMIN_COOKIE = 'qitu_session=test-token';

test('probe 端点：非 admin 被拒（401 / 403），不落任何请求', async () => {
  const controller = probeController('teacher');
  await assert.rejects(
    () =>
      controller.probeModels(ADMIN_COOKIE, {
        baseUrl: 'http://127.0.0.1:1',
        api: 'openai-completions',
      }),
    (error: unknown) => error instanceof ForbiddenException,
  );

  const anonymous = probeController(null);
  await assert.rejects(
    () =>
      anonymous.probeModels(undefined, {
        baseUrl: 'http://127.0.0.1:1',
        api: 'openai-completions',
      }),
    (error: unknown) => error instanceof UnauthorizedException,
  );
});

test('probe 端点：请求体白名单校验（baseUrl / api 形状错误 → 400）', async () => {
  const controller = probeController('admin');
  const cases: unknown[] = [
    undefined,
    {},
    { baseUrl: '', api: 'openai-completions' },
    { baseUrl: 'http://127.0.0.1:1', api: 'not-a-protocol' },
  ];
  for (const body of cases) {
    await assert.rejects(
      () => controller.probeModels(ADMIN_COOKIE, body as never),
      (error: unknown) => error instanceof BadRequestException,
      `应拒绝：${JSON.stringify(body)}`,
    );
  }
});

test('probe 端点：成功路径经由控制器返回 { data } 包裹的真实模型', async () => {
  const upstream = await startUpstream({ models: ['qwen-plus'] });
  try {
    const controller = probeController('admin');
    const response = await controller.probeModels(ADMIN_COOKIE, {
      baseUrl: upstream.baseUrl,
      api: 'openai-completions',
      apiKey: 'sk-probe-secret-005',
      authHeader: true,
      // 白名单外的字段应被丢弃，不影响探测。
      ...( { id: 'evil', enabled: false } as object ),
    });
    assert.equal(response.data.ok, true);
    assert.deepEqual(
      response.data.models.map((model) => model.id),
      ['qwen-plus'],
    );
    assert.doesNotMatch(JSON.stringify(response), /sk-probe-secret-005/);
  } finally {
    await upstream.close();
  }
});
