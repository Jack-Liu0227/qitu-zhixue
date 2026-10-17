import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ModelApi } from '@qitu/contracts';
import { AuditService } from '../../common/audit';
import type { AuthService } from '../identity-auth/auth.service';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { ModelRegistryController } from './model-registry.controller';
import { ModelRegistryService } from './model-registry.service';
import { ModelFetchError, fetchProviderModels, geminiApiRoot, providerAuthHeaders } from './fetch-models';
import { adapterFor } from './model-gateway.adapters';
import { MODEL_APIS } from './manual-model.validation';

const ADMIN_COOKIE = 'qitu_session=test-token';

/**
 * 四种协议的**发现 + 推理请求形状**验证。
 *
 * 背景：`google-gemini` 曾经被当成 OpenAI 兼容协议（适配器直接展开
 * `openaiCompletions`），而 `/models` 发现又统一走 `/v1/models` + Bearer；
 * 同时手工模型白名单 `MODEL_APIS` 缺 `google-gemini`，控制器
 * `sanitiseProvider` 也静默丢弃它。这一组测试把四条协议钉死成
 * 「契约 = 4 个值 = 4 种真实线协议」。
 *
 * 全部使用本地 mock 上游，不发真实网络请求，不含任何真实密钥。
 */

interface CapturedCall {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface Upstream {
  baseUrl: string;
  calls: CapturedCall[];
  close: () => Promise<void>;
}

/**
 * 本地 mock 上游：
 * - `GET /v1/models` → OpenAI 风格 `{ data: [...] }`
 * - `GET /v1beta/models` → Gemini 原生 `{ models: [...] }`
 * - 其他路径 404（用来证明没有多发请求）
 */
async function startUpstream(payload: unknown): Promise<Upstream> {
  const calls: CapturedCall[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      calls.push({ url: req.url ?? '', headers: req.headers, body });
      const url = req.url ?? '';
      if (url.endsWith('/v1/models') || url.endsWith('/v1beta/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('mock 上游未能分配端口');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('协议白名单：MODEL_APIS 就是契约的四个协议值，且不含厂商别名', () => {
  assert.deepEqual(
    [...MODEL_APIS].sort(),
    ['anthropic-messages', 'google-gemini', 'openai-completions', 'openai-responses'],
  );
});

test('geminiApiRoot：剔掉已写的版本段与 /models，只留 API 根', () => {
  assert.equal(geminiApiRoot('https://generativelanguage.googleapis.com'), 'https://generativelanguage.googleapis.com');
  assert.equal(geminiApiRoot('https://generativelanguage.googleapis.com/'), 'https://generativelanguage.googleapis.com');
  assert.equal(geminiApiRoot('https://generativelanguage.googleapis.com/v1beta'), 'https://generativelanguage.googleapis.com');
  assert.equal(geminiApiRoot('https://gw.example.com/v1'), 'https://gw.example.com');
  assert.equal(geminiApiRoot('https://gw.example.com/v1beta/models'), 'https://gw.example.com');
  assert.equal(geminiApiRoot('https://gw.example.com/api/ai'), 'https://gw.example.com/api/ai');
});

test('鉴权头：gemini 用 x-goog-api-key，anthropic 用 x-api-key，OpenAI 用 Bearer', () => {
  assert.deepEqual(providerAuthHeaders('google-gemini', 'k', true), { 'x-goog-api-key': 'k' });
  assert.deepEqual(providerAuthHeaders('google-gemini', 'k', false), { 'x-goog-api-key': 'k' });
  assert.deepEqual(providerAuthHeaders('anthropic-messages', 'k', false), {
    'x-api-key': 'k',
    'anthropic-version': '2023-06-01',
  });
  assert.deepEqual(providerAuthHeaders('openai-completions', 'k', true), { authorization: 'Bearer k' });
  assert.deepEqual(providerAuthHeaders('openai-responses', 'k', true), { authorization: 'Bearer k' });
  assert.deepEqual(providerAuthHeaders('openai-completions', 'k', false), {});
});

test('发现：google-gemini 走原生 /v1beta/models + x-goog-api-key，并解析原生字段', async () => {
  const upstream = await startUpstream({
    models: [
      {
        name: 'models/gemini-3.5-flash',
        displayName: 'Gemini 3.5 Flash',
        inputTokenLimit: 1048576,
        outputTokenLimit: 65536,
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
      },
      {
        name: 'models/text-embedding-004',
        supportedGenerationMethods: ['embedContent'],
      },
      { name: 'models/broken' },
    ],
  });
  try {
    // baseUrl 故意带 /v1beta，验证不会拼成 /v1beta/v1beta。
    const models = await fetchProviderModels({
      baseUrl: `${upstream.baseUrl}/v1beta`,
      api: 'google-gemini',
      apiKey: 'gk-discover',
      authHeader: true,
    });

    assert.equal(upstream.calls.length, 1);
    assert.equal(upstream.calls[0]!.url, '/v1beta/models');
    assert.equal(upstream.calls[0]!.headers['x-goog-api-key'], 'gk-discover');
    assert.equal(upstream.calls[0]!.headers.authorization, undefined, 'Gemini 不发 Bearer');
    assert.doesNotMatch(upstream.calls[0]!.url, /key=/, '密钥绝不进 URL query');

    // 只做对话生成的模型才收录；embedContent 与无 displayName 的行按规则处理。
    assert.deepEqual(models.map((model) => model.id), ['gemini-3.5-flash', 'broken']);
    assert.equal(models[0]!.name, 'Gemini 3.5 Flash');
    assert.equal(models[0]!.contextWindow, 1048576);
    assert.equal(models[0]!.maxTokens, 65536);
    assert.equal(models[0]!.api, 'google-gemini');
    assert.deepEqual(models[0]!.input, ['text'], '上游不说模态时保守声明 text');
    assert.equal(models[1]!.name, 'broken', '缺 displayName 回落成 id');
    assert.equal(models[1]!.contextWindow, null);
  } finally {
    await upstream.close();
  }
});

test('发现：OpenAI 两协议与 Anthropic 各自的路径与鉴权头', async () => {
  const cases: Array<{ api: ModelApi; header: [string, string]; url: string }> = [
    { api: 'openai-completions', header: ['authorization', 'Bearer pk'], url: '/v1/models' },
    { api: 'openai-responses', header: ['authorization', 'Bearer pk'], url: '/v1/models' },
    { api: 'anthropic-messages', header: ['x-api-key', 'pk'], url: '/v1/models' },
  ];
  for (const item of cases) {
    const upstream = await startUpstream({ data: [{ id: 'm-1' }] });
    try {
      const models = await fetchProviderModels({
        baseUrl: upstream.baseUrl,
        api: item.api,
        apiKey: 'pk',
        authHeader: true,
      });
      assert.equal(upstream.calls[0]!.url, item.url, `${item.api} 路径`);
      assert.equal(upstream.calls[0]!.headers[item.header[0]], item.header[1], `${item.api} 鉴权头`);
      assert.deepEqual(models.map((model) => model.id), ['m-1']);
      assert.equal(models[0]!.api, item.api);
    } finally {
      await upstream.close();
    }
  }
});

test('发现：Gemini 返回无法识别的结构时报错，绝不回退预设模型', async () => {
  const upstream = await startUpstream({ unexpected: true });
  try {
    await assert.rejects(
      () =>
        fetchProviderModels({
          baseUrl: upstream.baseUrl,
          api: 'google-gemini',
          apiKey: 'gk',
          authHeader: true,
        }),
      (error: unknown) => error instanceof ModelFetchError && /Gemini/.test(error.message),
    );
  } finally {
    await upstream.close();
  }
});

test('推理适配器：google-gemini 用原生 :generateContent 请求体与响应解析', () => {
  const adapter = adapterFor('google-gemini');
  const built = adapter.build(
    {
      providerId: 'p',
      providerName: 'P',
      modelId: 'gemini-3.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      api: 'google-gemini',
      authHeader: true,
      credential: 'gk-secret',
    },
    {
      messages: [
        { role: 'system', content: '你是导师' },
        { role: 'user', content: '' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      temperature: 0.3,
      maxTokens: 64,
    },
  );

  assert.equal(built.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
  assert.equal(built.headers['x-goog-api-key'], 'gk-secret');
  assert.equal(built.headers.authorization, undefined);
  assert.doesNotMatch(built.url, /key=/);
  const body = JSON.parse(built.body) as Record<string, unknown>;
  assert.deepEqual(body.systemInstruction, { parts: [{ text: '你是导师' }] });
  assert.deepEqual(body.contents, [
    { role: 'user', parts: [{ text: 'hi' }] },
    { role: 'model', parts: [{ text: 'hello' }] },
  ], '空文本消息不得提交，assistant 归一为 model');
  assert.deepEqual(body.generationConfig, { temperature: 0.3, maxOutputTokens: 64 });

  const parsed = adapter.parse({
    candidates: [
      { content: { parts: [{ text: 'A' }, { text: 'B' }] }, finishReason: 'MAX_TOKENS' },
      { content: { parts: [{ text: 'ignored' }] } },
    ],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 },
  });
  assert.equal(parsed.text, 'AB');
  assert.equal(parsed.finishReason, 'MAX_TOKENS');
  assert.deepEqual(parsed.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18 });

  // 上游没给 totalTokenCount 时按输入+输出求和；完全没给用量时是 null。
  const noTotal = adapter.parse({
    candidates: [{ content: { parts: [{ text: 'x' }] } }],
    usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 },
  });
  assert.deepEqual(noTotal.usage, { inputTokens: 2, outputTokens: 3, totalTokens: 5 });
  assert.equal(adapter.parse({ candidates: [] }).usage, null);
});

test('只读发现端点不写任何状态：discoverModels 后 provider 与时间戳不变', async () => {
  const upstream = await startUpstream({ data: [{ id: 'idle-model' }] });
  try {
    const service = new ModelRegistryService(null, new AuditService(null));
    const saved = await service.upsertProvider(
      'openai-like',
      { name: '网关', baseUrl: upstream.baseUrl, api: 'openai-completions', apiKey: 'sk-[REDACTED]' },
      'admin-1',
    );
    assert.deepEqual(saved.models, [], '新建供应商不自带上游模型');

    const found = await service.discoverModels('openai-like', 'admin-1');
    assert.equal(found.ok, true);
    assert.deepEqual(found.models.map((model) => model.id), ['idle-model']);
    assert.deepEqual(found.mountedIds, []);

    const after = service.listProviders().providers.find((provider) => provider.id === 'openai-like')!;
    assert.deepEqual(after.models, [], '发现不得挂载模型');
    assert.equal(after.modelsFetchedAt, null, '发现不得写 modelsFetchedAt');
    assert.equal(after.lastError, null);
  } finally {
    await upstream.close();
  }
});

test('discover：密钥缺失时依然只用已保存凭证，且错误里不含明文密钥', async () => {
  const service = new ModelRegistryService(null, new AuditService(null));
  await service.upsertProvider(
    'dead-gateway',
    { name: '不可达', baseUrl: 'http://127.0.0.1:1', api: 'google-gemini', apiKey: 'gk-plain-secret' },
    'admin-1',
  );

  const result = await service.discoverModels('dead-gateway', 'admin-1');
  assert.equal(result.ok, false);
  assert.deepEqual(result.models, []);
  assert.doesNotMatch(JSON.stringify(result), /gk-plain-secret/);
});

test('PUT :id/models 走服务层集合语义：空集合清空、非数组 400', async () => {
  const service = new ModelRegistryService(null, new AuditService(null));
  await service.upsertProvider('mem', { name: '内存', baseUrl: 'https://x.example.com' }, 'admin-1');
  await service.setProviderModels('mem', [{ modelId: 'a' }, { modelId: 'b' }], 'admin-1', 'k1');

  const listed = service.listProviders().providers.find((provider) => provider.id === 'mem')!;
  assert.deepEqual(listed.models.map((model) => model.id).sort(), ['a', 'b']);

  const cleared = await service.setProviderModels('mem', [], 'admin-1', 'k2');
  assert.deepEqual(cleared.removed.slice().sort(), ['a', 'b']);
  assert.deepEqual(
    service.listProviders().providers.find((provider) => provider.id === 'mem')!.models,
    [],
  );

  await assert.rejects(
    () => service.setProviderModels('mem', [{ modelId: 'x' }, { modelId: 'x' }], 'admin-1', 'k3'),
    (error: unknown) => error instanceof BadRequestException,
  );
});

/* --------------------------------- 控制器层 --------------------------------- */

function controllerWith(
  role: 'admin' | 'teacher' | null,
  service: ModelRegistryService,
  idempotency: IdempotencyStore,
): ModelRegistryController {
  const authService = {
    getSession: () => {
      if (role === null) throw new Error('no session');
      return { user: { id: 'user-1', role } };
    },
  } as unknown as AuthService;
  return new ModelRegistryController(service, authService, idempotency);
}

function replayingIdempotency(): IdempotencyStore {
  return {
    execute: async (_scope: string, _key: string, _hash: string, work: () => Promise<{ body: unknown }>) =>
      (await work()) as never,
  } as unknown as IdempotencyStore;
}

test('控制器：PUT :id/models 需要 admin 与 Idempotency-Key，且 body 只收白名单字段', async () => {
  const service = new ModelRegistryService(null, new AuditService(null));
  await service.upsertProvider('gate', { name: '网关', baseUrl: 'https://x.example.com' }, 'admin-1');
  const controller = controllerWith('admin', service, replayingIdempotency());

  await assert.rejects(
    () =>
      controller.setProviderModels(ADMIN_COOKIE, '  ', 'gate', {
        models: [{ modelId: 'a', source: 'remote' }],
      } as never),
    (error: unknown) => error instanceof UnauthorizedException || error instanceof BadRequestException,
    '缺幂等键必须拒绝，绝不静默执行',
  );

  const updated = await controller.setProviderModels(
    ADMIN_COOKIE,
    'set-key-1',
    'gate',
    // 携带未知字段（api / enabled / id）必须被白名单丢掉。
    { models: [{ modelId: 'a', api: 'evil', enabled: false, source: 'remote' } as never] } as never,
  );
  assert.deepEqual(updated.data.created, ['a']);
  const provider = service.listProviders().providers.find((item) => item.id === 'gate')!;
  assert.deepEqual(provider.models.map((model) => model.id), ['a']);
  assert.equal(provider.api, 'openai-completions', '集合保存不得改协议');

  const readerOnly = controllerWith('teacher', service, replayingIdempotency());
  await assert.rejects(
    () => readerOnly.discoverProviderModels(ADMIN_COOKIE, 'gate'),
    (error: unknown) => error instanceof ForbiddenException,
    '非 admin 不得触发上游发现',
  );

  const anon = controllerWith(null, service, replayingIdempotency());
  await assert.rejects(
    () => anon.setProviderModels(undefined, 'set-key-2', 'gate', { models: [] } as never),
    (error: unknown) => error instanceof UnauthorizedException,
  );
});

test('控制器：PUT :id/models 缺 models 字段直接 400（不能当作「清空」执行）', async () => {
  const service = new ModelRegistryService(null, new AuditService(null));
  await service.upsertProvider('gate2', { name: '网关', baseUrl: 'https://x.example.com' }, 'admin-1');
  await service.setProviderModels('gate2', [{ modelId: 'keep' }], 'admin-1', 'seed');
  const controller = controllerWith('admin', service, replayingIdempotency());

  for (const body of [undefined, null, {}, { models: 'nope' }, { models: [{ nope: 1 }] }]) {
    await assert.rejects(
      () => controller.setProviderModels(ADMIN_COOKIE, 'k', 'gate2', body as never),
      (error: unknown) => error instanceof BadRequestException,
      `${JSON.stringify(body)} 必须被拒`,
    );
  }
  const provider = service.listProviders().providers.find((item) => item.id === 'gate2')!;
  assert.deepEqual(provider.models.map((model) => model.id), ['keep'], '拒收的请求不得改变挂载集合');
});
