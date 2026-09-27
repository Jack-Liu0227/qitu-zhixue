import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit';
import { ModelRegistryService } from './model-registry.service';
import { CONNECTIVITY_DISCLAIMER, redactConnectionError } from './connection-test';

/**
 * 连接测试（Provider / Model / Usage）的行为验证。
 *
 * 全部使用**本地 mock 上游**（`127.0.0.1`），不触碰真实外网；服务用内存模式
 * （`db === null`）以覆盖控制器 / 服务语义而不依赖数据库。数据库持久化路径的
 * 回归在 `model-registry.integration.test.ts`（`DATABASE_URL` 门控）里验证。
 *
 * 重点：
 * - 三种协议各自用正确的鉴权头探测 `/v1/models`（含 `openai-responses`）；
 * - 失败返回 `ok=false` 且错误脱敏、不含密钥；
 * - Model 级确认已知 / 可拉取模型，未知 404；
 * - Usage 级先 resolve `fallbackTo`；
 * - 已停用 provider / model 明确不可用；
 * - 只探测 `/v1/models`，不发起推理。
 */

function memoryService(): ModelRegistryService {
  // 内存模式下 test 方法不写审计，但仍需要一个 AuditWriter 令牌。
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

/** 所有探测都必须只打到 `/v1/models`：连接测试不发起推理。 */
function assertOnlyModelsProbe(calls: UpstreamCall[]): void {
  assert.ok(calls.length >= 1, '应至少探测一次上游');
  for (const call of calls) {
    assert.ok(call.url.endsWith('/v1/models'), `只应探测 /v1/models，实际：${call.url}`);
  }
}

test('openai-responses：用 Bearer 探测 /v1/models，只回连通结论', async () => {
  const upstream = await startUpstream({
    models: ['gpt-4.1', 'gpt-realtime'],
    requireHeaders: { authorization: 'Bearer sk-responses-secret-987654' },
  });
  try {
    const service = memoryService();
    await service.upsertProvider(
      'openai',
      { baseUrl: upstream.baseUrl, apiKey: 'sk-responses-secret-987654' },
      'admin-1',
    );

    const result = await service.testProvider('openai', 'admin-1');

    assert.equal(result.ok, true);
    assert.equal(result.error, null);
    assert.equal(result.usageId, null);
    assert.equal(result.modelId, null);
    assert.equal(typeof result.latencyMs, 'number');
    assert.match(result.message ?? '', /2 个模型/);
    assert.match(result.message ?? '', new RegExp(CONNECTIVITY_DISCLAIMER));
    assertOnlyModelsProbe(upstream.calls);
    assert.equal(upstream.calls[0]!.headers.authorization, 'Bearer sk-responses-secret-987654');
    // 密钥绝不出现在对外响应里。
    assert.doesNotMatch(JSON.stringify(result), /sk-responses-secret-987654/);
  } finally {
    await upstream.close();
  }
});

test('openai-completions / anthropic-messages：各自使用正确鉴权头', async () => {
  const completions = await startUpstream({
    models: ['deepseek-chat'],
    requireHeaders: { authorization: 'Bearer sk-completions-secret-123456' },
  });
  const anthropic = await startUpstream({
    models: ['claude-sonnet-4-5'],
    requireHeaders: { 'x-api-key': 'sk-ant-secret-123456', 'anthropic-version': '2023-06-01' },
  });
  try {
    const service = memoryService();
    await service.upsertProvider(
      'deepseek',
      { baseUrl: completions.baseUrl, apiKey: 'sk-completions-secret-123456' },
      'admin-1',
    );
    await service.upsertProvider(
      'anthropic',
      { baseUrl: anthropic.baseUrl, apiKey: 'sk-ant-secret-123456' },
      'admin-1',
    );

    const completionsResult = await service.testProvider('deepseek', 'admin-1');
    const anthropicResult = await service.testProvider('anthropic', 'admin-1');

    assert.equal(completionsResult.ok, true);
    assert.equal(anthropicResult.ok, true);
    assert.equal(completions.calls[0]!.headers.authorization, 'Bearer sk-completions-secret-123456');
    assert.equal(anthropic.calls[0]!.headers['x-api-key'], 'sk-ant-secret-123456');
    assert.equal(anthropic.calls[0]!.headers['anthropic-version'], '2023-06-01');
    assertOnlyModelsProbe(completions.calls);
    assertOnlyModelsProbe(anthropic.calls);
  } finally {
    await completions.close();
    await anthropic.close();
  }
});

test('测试失败：返回 200 语义的 ok=false，错误脱敏且不含密钥', async () => {
  const upstream = await startUpstream({ status: 401 });
  try {
    const service = memoryService();
    await service.upsertProvider(
      'openai',
      { baseUrl: upstream.baseUrl, apiKey: 'sk-leaky-secret-999999' },
      'admin-1',
    );

    const result = await service.testProvider('openai', 'admin-1');

    assert.equal(result.ok, false);
    assert.equal(result.latencyMs, null);
    assert.equal(result.message, null);
    assert.match(result.error ?? '', /HTTP 401/);
    assert.doesNotMatch(result.error ?? '', /sk-leaky-secret-999999/);
    assertOnlyModelsProbe(upstream.calls);
  } finally {
    await upstream.close();
  }
});

test('Model 级：确认已知 / 可拉取模型，未知模型 404', async () => {
  const knownUpstream = await startUpstream({ models: ['deepseek-chat'] });
  const customUpstream = await startUpstream({ models: ['upstream-only-model'] });
  try {
    const service = memoryService();
    await service.upsertProvider('deepseek', { baseUrl: knownUpstream.baseUrl }, 'admin-1');
    await service.upsertProvider('custom-gw', { baseUrl: customUpstream.baseUrl }, 'admin-1');

    const known = await service.testModel('deepseek', 'deepseek-chat', 'admin-1');
    assert.equal(known.ok, true);
    assert.equal(known.modelId, 'deepseek-chat');
    assert.match(known.message ?? '', /手工模型|已知模型/);

    // 未登记但本次可拉取。
    const discovered = await service.testModel('custom-gw', 'upstream-only-model', 'admin-1');
    assert.equal(discovered.ok, true);
    assert.equal(discovered.modelId, 'upstream-only-model');
    assert.match(discovered.message ?? '', /可拉取/);

    await assert.rejects(
      () => service.testModel('custom-gw', 'ghost-model', 'admin-1'),
      NotFoundException,
    );
    await assert.rejects(
      () => service.testModel('no-such-provider', 'x', 'admin-1'),
      NotFoundException,
    );
  } finally {
    await knownUpstream.close();
    await customUpstream.close();
  }
});

test('Usage 级：先 resolve fallback，再测 provider/model', async () => {
  const upstream = await startUpstream({ models: ['qwen-plus'] });
  try {
    const service = memoryService();
    await service.upsertProvider('qwen-dashscope', { baseUrl: upstream.baseUrl }, 'admin-1');
    await service.bindUsage(
      'tutor.chat',
      { providerId: 'qwen-dashscope', modelId: 'qwen-plus' },
      'admin-1',
    );

    const direct = await service.testUsage('tutor.chat', 'admin-1');
    assert.equal(direct.ok, true);
    assert.equal(direct.usageId, 'tutor.chat');
    assert.equal(direct.modelId, 'qwen-plus');

    // tutor.live 未显式绑定，fallbackTo=tutor.chat。
    const fallback = await service.testUsage('tutor.live', 'admin-1');
    assert.equal(fallback.ok, true);
    assert.equal(fallback.usageId, 'tutor.live');
    assert.equal(fallback.modelId, 'qwen-plus');
    assert.match(fallback.message ?? '', /回落/);

    // 无绑定、无回落：返回 ok=false 而不是 404。
    const unbound = await service.testUsage('knowledge.embed', 'admin-1');
    assert.equal(unbound.ok, false);
    assert.equal(unbound.usageId, 'knowledge.embed');
    assert.match(unbound.error ?? '', /未绑定/);

    await assert.rejects(() => service.testUsage('no.such.usage', 'admin-1'), NotFoundException);
  } finally {
    await upstream.close();
  }
});

test('已停用供应商 / 模型返回明确不可用', async () => {
  const upstream = await startUpstream({ models: ['m1'] });
  try {
    const service = memoryService();
    await service.upsertProvider('custom-gw', { baseUrl: upstream.baseUrl }, 'admin-1');
    await service.createManualModel(
      'custom-gw',
      { modelId: 'm1', displayName: 'M1' },
      'admin-1',
      'test-scope:key',
    );

    // 直接改内部状态模拟「已停用」：正常写接口不允许停用已绑定模型，
    // 这里只验证测试端点的判定分支。
    const internals = service as unknown as {
      providers: Map<string, { enabled: boolean; manual: Map<string, { enabled: boolean }> }>;
    };
    const state = internals.providers.get('custom-gw')!;

    state.enabled = false;
    const disabledProvider = await service.testProvider('custom-gw', 'admin-1');
    assert.equal(disabledProvider.ok, false);
    assert.match(disabledProvider.error ?? '', /已停用/);

    state.enabled = true;
    state.manual.get('m1')!.enabled = false;
    const disabledModel = await service.testModel('custom-gw', 'm1', 'admin-1');
    assert.equal(disabledModel.ok, false);
    assert.match(disabledModel.error ?? '', /已停用/);
    // 停用模型不应再对外发请求。
    assert.equal(upstream.calls.length, 0);
  } finally {
    await upstream.close();
  }
});

test('redactConnectionError：替换已知密钥与常见令牌形态', () => {
  assert.equal(
    redactConnectionError('探测失败 sk-abcdefgh12345678', ['sk-abcdefgh12345678']),
    '探测失败 [已脱敏]',
  );
  assert.match(redactConnectionError('header Bearer sk-1234567890abcdef', []), /\[已脱敏\]/);
  assert.equal(redactConnectionError('普通错误', ['ab']), '普通错误');
});
