import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ModelApi } from '@qitu/contracts';
import { AuditService } from '../../common/audit';
import { ModelGateway, MODEL_RUNTIME_RESOLVER } from './model-gateway';
import { ModelGatewayError } from './model-gateway.errors';
import { ModelRegistryService } from './model-registry.service';
import type {
  ModelCompletionRequest,
  ModelRuntimeResolver,
  ModelRuntimeTarget,
} from './model-gateway.types';

/**
 * Runtime `ModelGateway` 的行为验证。
 *
 * 全部使用**本地 mock 上游**（`127.0.0.1`），不触碰真实外网。覆盖：
 * - 三种协议（openai-completions / openai-responses / anthropic-messages）的
 *   路径、鉴权头、请求体与文本解析，重点是 **OpenAI Responses 的 output text**；
 * - 统一错误：HTTP 错误脱敏（不含密钥）、超时、调用方取消、空文本；
 * - 原生 SSE 流式完成与错误，不保留旧的非流式协议分支；
 * - 解析层：真实 `ModelRegistryService` 内存模式下 usage fallback 与
 *   binding / secret 缺失时的明确不可用错误码。
 */

/* ----------------------------- mock 上游 ----------------------------- */


interface RecordedRequest {
  url: string;
  method: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

interface MockUpstream {
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

/** 启动一个本地 mock 上游；每个请求记录 URL / 头 / 解析后的 JSON body。 */
async function startUpstream(
  handler: (request: RecordedRequest, res: ServerResponse) => void,
): Promise<MockUpstream> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = null;
      try {
        body = raw.length > 0 ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      const recorded: RecordedRequest = {
        url: req.url ?? '',
        method: req.method ?? '',
        headers: req.headers,
        body,
      };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('mock 上游未能分配端口');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/* --------------------------- gateway 桩件 --------------------------- */

const SECRET = 'sk-test-secret-0123456789';

function fixedResolver(target: ModelRuntimeTarget): ModelRuntimeResolver {
  return { resolveRuntimeTarget: () => target };
}

function makeTarget(
  baseUrl: string,
  api: ModelApi,
  overrides: Partial<ModelRuntimeTarget> = {},
): ModelRuntimeTarget {
  return {
    providerId: 'test-provider',
    providerName: 'Test Provider',
    modelId: 'test-model',
    api,
    authHeader: true,
    credential: SECRET,
    baseUrl,
    ...overrides,
  };
}

function gatewayFor(target: ModelRuntimeTarget): ModelGateway {
  return new ModelGateway(fixedResolver(target));
}

const USER_MESSAGE: ModelCompletionRequest = {
  messages: [{ role: 'user', content: '你好' }],
};

/* ------------------------- 1. 三种协议适配 ------------------------- */

function sendEvents(res: ServerResponse, events: unknown[], named = false): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(events.map((event) => `${named && typeof event === 'object' && event && 'type' in event ? `event: ${event.type}\n` : ''}data: ${JSON.stringify(event)}\n\n`).join(''));
}

function sendChat(res: ServerResponse, text: string): void {
  sendEvents(res, [
    { id: 'chat-test', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
    { id: 'chat-test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } },
  ]);
}

test('native chat SSE preserves protocol path, credentials, messages and usage', async () => {
  const upstream = await startUpstream((_request, res) => sendChat(res, 'native answer'));
  try {
    const result = await gatewayFor(makeTarget(upstream.baseUrl, 'openai-completions')).complete('tutor.chat', USER_MESSAGE);
    assert.equal(result.text, 'native answer');
    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 5, totalTokens: 8 });
    const first = upstream.requests[0]!;
    assert.equal(first.url, '/v1/chat/completions');
    assert.equal(first.method, 'POST');
    assert.equal(first.headers.authorization, `Bearer ${SECRET}`);
    assert.ok(first.body && typeof first.body === 'object' && 'stream' in first.body && 'messages' in first.body);
    assert.equal(first.body.stream, true);
    assert.deepEqual(first.body.messages, USER_MESSAGE.messages);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  } finally { await upstream.close(); }
});

test('native Responses SSE preserves text, input and usage', async () => {
  const item = { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'response answer', annotations: [] }] };
  const upstream = await startUpstream((_request, res) => sendEvents(res, [
    { type: 'response.created', response: { id: 'resp_1' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'response answer' },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [item], usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } } },
  ]));
  try {
    const result = await gatewayFor(makeTarget(upstream.baseUrl, 'openai-responses')).complete('tutor.chat', { messages: [{ role: 'system', content: 'system instruction' }, ...USER_MESSAGE.messages] });
    assert.equal(result.text, 'response answer');
    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18 });
    const first = upstream.requests[0]!;
    assert.equal(first.url, '/v1/responses');
    assert.equal(first.headers.authorization, `Bearer ${SECRET}`);
    assert.ok(first.body && typeof first.body === 'object' && 'stream' in first.body && 'input' in first.body);
    assert.equal(first.body.stream, true);
    assert.match(JSON.stringify(first.body.input), /system instruction/);
    assert.match(JSON.stringify(first.body.input), /你好/);
  } finally { await upstream.close(); }
});

test('native runtime rejects legacy JSON completion instead of claiming streaming success', async () => {
  const upstream = await startUpstream((_request, res) => sendJson(res, 200, { output_text: 'not SSE' }));
  try {
    await assert.rejects(gatewayFor(makeTarget(upstream.baseUrl, 'openai-responses')).complete('tutor.chat', USER_MESSAGE),
      (error: unknown) => error instanceof ModelGatewayError && error.code === 'MODEL_RESPONSE_INVALID');
  } finally { await upstream.close(); }
});

test('native Anthropic SSE preserves path, x-api-key, system and usage', async () => {
  const upstream = await startUpstream((_request, res) => sendEvents(res, [
    { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'test-model', content: [], usage: { input_tokens: 9, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'anthropic answer' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
    { type: 'message_stop' },
  ], true));
  try {
    for (const baseUrl of [upstream.baseUrl, `${upstream.baseUrl}/v1`]) {
      const result = await gatewayFor(makeTarget(baseUrl, 'anthropic-messages')).complete('tutor.chat', { messages: [{ role: 'system', content: 'system instruction' }, ...USER_MESSAGE.messages] });
      assert.equal(result.text, 'anthropic answer');
      assert.equal(result.finishReason, 'stop');
      assert.deepEqual(result.usage, { inputTokens: 9, outputTokens: 4, totalTokens: 13 });
      const first = upstream.requests.at(-1)!;
      assert.equal(new URL(first.url, upstream.baseUrl).pathname, '/v1/messages');
      assert.equal(new URL(first.url, upstream.baseUrl).searchParams.get('beta'), 'true');
      assert.equal(first.headers['x-api-key'], SECRET);
      assert.equal(first.headers['anthropic-version'], '2023-06-01');
      assert.equal(first.headers.authorization, undefined);
      assert.ok(first.body && typeof first.body === 'object' && 'system' in first.body && 'stream' in first.body);
      assert.equal(first.body.stream, true);
      assert.match(JSON.stringify(first.body.system), /system instruction/);
    }
  } finally { await upstream.close(); }
});

test('native baseUrl containing /v1 is not duplicated', async () => {
  const upstream = await startUpstream((_request, res) => sendChat(res, 'ok'));
  try {
    await gatewayFor(makeTarget(`${upstream.baseUrl}/v1`, 'openai-completions')).complete('tutor.chat', USER_MESSAGE);
    assert.equal(upstream.requests[0]?.url, '/v1/chat/completions');
  } finally { await upstream.close(); }
});

/* --------------------------- 2. 错误与脱敏 --------------------------- */

test('上游非 2xx：错误码稳定，消息脱敏且不含密钥', async () => {
  const upstream = await startUpstream((_request, res) => {
    // 故意让上游把密钥回显到错误体里，验证网关不会把它带出去。
    sendJson(res, 401, { error: { message: `invalid key ${SECRET}` } });
  });
  try {
    const gateway = gatewayFor(makeTarget(upstream.baseUrl, 'openai-completions'));
    await assert.rejects(
      () => gateway.complete('tutor.chat', USER_MESSAGE),
      (error: unknown) => {
        assert.ok(error instanceof ModelGatewayError);
        assert.equal(error.code, 'MODEL_UPSTREAM_HTTP_ERROR');
        assert.equal(error.upstreamStatus, 401);
        assert.equal(error.retryable, false);
        assert.equal(error.message.includes(SECRET), false);
        assert.equal(JSON.stringify(error).includes(SECRET), false);
        return true;
      },
    );
  } finally {
    await upstream.close();
  }
});

test('超时：抛 MODEL_REQUEST_TIMEOUT 且可重试', async () => {
  const upstream = await startUpstream(() => {
    // 刻意不响应，触发客户端超时。
  });
  try {
    const gateway = gatewayFor(makeTarget(upstream.baseUrl, 'openai-completions'));
    await assert.rejects(
      () => gateway.complete('tutor.chat', { ...USER_MESSAGE, timeoutMs: 40 }),
      (error: unknown) => {
        assert.ok(error instanceof ModelGatewayError);
        assert.equal(error.code, 'MODEL_REQUEST_TIMEOUT');
        assert.equal(error.retryable, true);
        return true;
      },
    );
  } finally {
    await upstream.close();
  }
});

test('调用方 AbortSignal：抛 MODEL_REQUEST_ABORTED（不可重试）', async () => {
  const upstream = await startUpstream(() => {
    // 不应被真正触达；signal 已 abort。
  });
  try {
    const controller = new AbortController();
    controller.abort();
    const gateway = gatewayFor(makeTarget(upstream.baseUrl, 'openai-completions'));
    await assert.rejects(
      () => gateway.complete('tutor.chat', { ...USER_MESSAGE, signal: controller.signal }),
      (error: unknown) => {
        assert.ok(error instanceof ModelGatewayError);
        assert.equal(error.code, 'MODEL_REQUEST_ABORTED');
        assert.equal(error.retryable, false);
        return true;
      },
    );
  } finally {
    await upstream.close();
  }
});

test('空文本：抛 MODEL_EMPTY_RESPONSE；非法 JSON：抛 MODEL_RESPONSE_INVALID', async () => {
  const empty = await startUpstream((_request, res) => {
    sendChat(res, '');
  });
  const broken = await startUpstream((_request, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('not-json');
  });
  try {
    await assert.rejects(
      () => gatewayFor(makeTarget(empty.baseUrl, 'openai-completions')).complete('tutor.chat', USER_MESSAGE),
      (error: unknown) => error instanceof ModelGatewayError && error.code === 'MODEL_EMPTY_RESPONSE',
    );
    await assert.rejects(
      () => gatewayFor(makeTarget(broken.baseUrl, 'openai-completions')).complete('tutor.chat', USER_MESSAGE),
      (error: unknown) => error instanceof ModelGatewayError && error.code === 'MODEL_RESPONSE_INVALID',
    );
  } finally {
    await empty.close();
    await broken.close();
  }
});

test('native stream emits upstream deltas and one final result', async () => {
  const upstream = await startUpstream((_request, res) => sendChat(res, 'real upstream delta'));
  try {
    const events = [];
    for await (const event of gatewayFor(makeTarget(upstream.baseUrl, 'openai-completions')).stream('tutor.chat', USER_MESSAGE)) events.push(event);
    assert.deepEqual(events.filter((event) => event.type === 'text-delta').map((event) => event.text), ['real upstream delta']);
    assert.equal(events.filter((event) => event.type === 'done').length, 1);
    assert.equal(events.some((event) => event.type === 'error'), false);
  } finally { await upstream.close(); }
});

/* ------------------- 3. registry 解析 / fallback / 不可用 ------------------- */

function memoryRegistry(): ModelRegistryService {
  return new ModelRegistryService(null, new AuditService(null));
}

test('未绑定 usage：抛 MODEL_USAGE_NOT_BOUND；未知 usage：抛 MODEL_USAGE_UNKNOWN', () => {
  const registry = memoryRegistry();
  assert.throws(
    () => registry.resolveRuntimeTarget('tutor.chat'),
    (error: unknown) => error instanceof ModelGatewayError && error.code === 'MODEL_USAGE_NOT_BOUND',
  );
  assert.throws(
    () => registry.resolveRuntimeTarget('not.a.usage'),
    (error: unknown) => error instanceof ModelGatewayError && error.code === 'MODEL_USAGE_UNKNOWN',
  );
});

test('绑定后 resolveRuntimeTarget 返回解密凭证；结果只经 gateway 使用', async () => {
  const registry = memoryRegistry();
  await registry.upsertProvider(
    'openai',
    { baseUrl: 'http://127.0.0.1:9', api: 'openai-responses', apiKey: SECRET },
    'admin',
  );
  await registry.bindUsage('tutor.chat', { providerId: 'openai', modelId: 'gpt-4.1' }, 'admin');

  const target = registry.resolveRuntimeTarget('tutor.chat');
  assert.equal(target.providerId, 'openai');
  assert.equal(target.modelId, 'gpt-4.1');
  assert.equal(target.api, 'openai-responses');
  assert.equal(target.credential, SECRET);
});

test('Agent 直选模型不依赖旧用途绑定即可解析运行时目标', async () => {
  const registry = memoryRegistry();
  await registry.upsertProvider(
    'openai',
    { baseUrl: 'http://127.0.0.1:9', api: 'openai-responses', apiKey: SECRET },
    'admin',
  );

  const target = registry.resolveRuntimeTargetByModel({ providerId: 'openai', modelId: 'gpt-4.1' });
  assert.equal(target.providerId, 'openai');
  assert.equal(target.modelId, 'gpt-4.1');
  assert.equal(target.credential, SECRET);
});

test('usage fallback：tutor.live 未直接绑定，回落到 tutor.chat 的模型', async () => {
  const registry = memoryRegistry();
  await registry.upsertProvider(
    'openai',
    { baseUrl: 'http://127.0.0.1:9', api: 'openai-responses', apiKey: SECRET },
    'admin',
  );
  await registry.bindUsage('tutor.chat', { providerId: 'openai', modelId: 'gpt-4.1' }, 'admin');

  const target = registry.resolveRuntimeTarget('tutor.live');
  assert.equal(target.providerId, 'openai');
  assert.equal(target.modelId, 'gpt-4.1');
});

test('缺失凭证：绑定但供应商无密钥时抛 MODEL_CREDENTIAL_MISSING', async () => {
  const registry = memoryRegistry();
  await registry.upsertProvider(
    'deepseek',
    { baseUrl: 'http://127.0.0.1:9', api: 'openai-completions' },
    'admin',
  );
  await registry.bindUsage('knowledge.embed', { providerId: 'deepseek', modelId: 'deepseek-chat' }, 'admin');

  assert.throws(
    () => registry.resolveRuntimeTarget('knowledge.embed'),
    (error: unknown) => error instanceof ModelGatewayError && error.code === 'MODEL_CREDENTIAL_MISSING',
  );
});

test('缺失模型：已绑定模型被下线后抛 MODEL_NOT_FOUND', async () => {
  const registry = memoryRegistry();
  await registry.upsertProvider(
    'openai',
    { baseUrl: 'http://127.0.0.1:9', api: 'openai-responses', apiKey: SECRET },
    'admin',
  );
  await registry.bindUsage('tutor.chat', { providerId: 'openai', modelId: 'gpt-4.1' }, 'admin');
  // 内存实现停用后会从快照移除该模型，因此解析不到即「模型不存在」。
  await registry.updateManualModel('openai', 'gpt-4.1', { enabled: false }, 'admin', 'idem-key-1');

  assert.throws(
    () => registry.resolveRuntimeTarget('tutor.chat'),
    (error: unknown) => error instanceof ModelGatewayError && error.code === 'MODEL_NOT_FOUND',
  );
});

test('模块导出 ModelGateway 且注入令牌存在（接线自检）', () => {
  assert.equal(typeof ModelGateway, 'function');
  assert.equal(typeof MODEL_RUNTIME_RESOLVER, 'symbol');
});
