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
 * - 未接线：`stream` 明确抛 `MODEL_STREAM_NOT_IMPLEMENTED`；
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

test('openai-completions：走 /v1/chat/completions，Bearer 鉴权，解析文本与 usage', async () => {
  const upstream = await startUpstream((_request, res) => {
    sendJson(res, 200, {
      choices: [{ message: { role: 'assistant', content: '回答文本' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
    });
  });
  try {
    const result = await gatewayFor(makeTarget(upstream.baseUrl, 'openai-completions')).complete(
      'tutor.chat',
      USER_MESSAGE,
    );
    assert.equal(result.text, '回答文本');
    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 5, totalTokens: 8 });
    assert.equal(result.api, 'openai-completions');

    const first = upstream.requests[0];
    assert.ok(first);
    assert.equal(first.url, '/v1/chat/completions');
    assert.equal(first.method, 'POST');
    assert.equal(first.headers['authorization'], `Bearer ${SECRET}`);
    const body = first.body as Record<string, unknown>;
    assert.equal(body.model, 'test-model');
    assert.equal(body.stream, false);
    assert.deepEqual(body.messages, [{ role: 'user', content: '你好' }]);
    // 结果里绝不回带凭证。
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  } finally {
    await upstream.close();
  }
});

test('openai-responses：走 /v1/responses，解析 output[] 的 output_text（跳过 reasoning）', async () => {
  const upstream = await startUpstream((_request, res) => {
    sendJson(res, 200, {
      id: 'resp_1',
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [] },
        {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: '第一段', annotations: [] },
            { type: 'output_text', text: '，第二段', annotations: [] },
          ],
        },
      ],
      usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
    });
  });
  try {
    const result = await gatewayFor(makeTarget(upstream.baseUrl, 'openai-responses')).complete(
      'tutor.chat',
      { messages: [{ role: 'system', content: '系统提示' }, ...USER_MESSAGE.messages] },
    );
    assert.equal(result.text, '第一段，第二段');
    assert.equal(result.finishReason, 'completed');
    assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7, totalTokens: 18 });

    const first = upstream.requests[0];
    assert.ok(first);
    assert.equal(first.url, '/v1/responses');
    assert.equal(first.headers['authorization'], `Bearer ${SECRET}`);
    const body = first.body as Record<string, unknown>;
    // Responses 用 instructions 承载 system，input 只放非 system。
    assert.equal(body.instructions, '系统提示');
    assert.deepEqual(body.input, [{ role: 'user', content: '你好' }]);
    assert.equal(body.stream, false);
  } finally {
    await upstream.close();
  }
});

test('openai-responses：顶层 output_text 兜底也能解析', async () => {
  const upstream = await startUpstream((_request, res) => {
    sendJson(res, 200, { status: 'completed', output_text: '直接给出的文本' });
  });
  try {
    const result = await gatewayFor(makeTarget(upstream.baseUrl, 'openai-responses')).complete(
      'tutor.chat',
      USER_MESSAGE,
    );
    assert.equal(result.text, '直接给出的文本');
  } finally {
    await upstream.close();
  }
});

test('anthropic-messages：走 /v1/messages，x-api-key + anthropic-version，system 独立字段', async () => {
  const upstream = await startUpstream((_request, res) => {
    sendJson(res, 200, {
      content: [
        { type: 'text', text: '安' },
        { type: 'text', text: '回答' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 9, output_tokens: 4 },
    });
  });
  try {
    const result = await gatewayFor(makeTarget(upstream.baseUrl, 'anthropic-messages')).complete(
      'tutor.chat',
      { messages: [{ role: 'system', content: '你是老师' }, ...USER_MESSAGE.messages] },
    );
    assert.equal(result.text, '安回答');
    assert.equal(result.finishReason, 'end_turn');
    assert.deepEqual(result.usage, { inputTokens: 9, outputTokens: 4, totalTokens: 13 });

    const first = upstream.requests[0];
    assert.ok(first);
    assert.equal(first.url, '/v1/messages');
    assert.equal(first.headers['x-api-key'], SECRET);
    assert.equal(first.headers['anthropic-version'], '2023-06-01');
    assert.equal(first.headers['authorization'], undefined);
    const body = first.body as Record<string, unknown>;
    assert.equal(body.system, '你是老师');
    // Anthropic 的 max_tokens 必填，未指定时用保守默认。
    assert.equal(typeof body.max_tokens, 'number');
    assert.deepEqual(body.messages, [{ role: 'user', content: '你好' }]);
  } finally {
    await upstream.close();
  }
});

test('baseUrl 已含 /v1 时不重复拼接', async () => {
  const upstream = await startUpstream((_request, res) => {
    sendJson(res, 200, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
  });
  try {
    const target = makeTarget(`${upstream.baseUrl}/v1`, 'openai-completions');
    await gatewayFor(target).complete('tutor.chat', USER_MESSAGE);
    const first = upstream.requests[0];
    assert.ok(first);
    assert.equal(first.url, '/v1/chat/completions');
    assert.equal(first.url.includes('/v1/v1/'), false);
  } finally {
    await upstream.close();
  }
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
    sendJson(res, 200, { choices: [{ message: { content: '' }, finish_reason: 'stop' }] });
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

test('stream seam 未接线：明确抛 MODEL_STREAM_NOT_IMPLEMENTED', async () => {
  const gateway = gatewayFor(makeTarget('http://127.0.0.1:9', 'openai-completions'));
  await assert.rejects(
    async () => {
      for await (const _event of gateway.stream('tutor.chat', USER_MESSAGE)) {
        void _event;
      }
    },
    (error: unknown) =>
      error instanceof ModelGatewayError && error.code === 'MODEL_STREAM_NOT_IMPLEMENTED',
  );
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
