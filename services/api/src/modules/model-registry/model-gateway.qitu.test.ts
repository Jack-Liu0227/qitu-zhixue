import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { ModelGateway } from './model-gateway.js';
import type { ModelRuntimeResolver, ModelRuntimeTarget } from './model-gateway.types.js';

const SECRET = 'qitu-runtime-test-credential';

async function startSseMock(): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end([
      'data: {"id":"qitu-test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"引导问题？"},"finish_reason":null}]}',
      'data: {"id":"qitu-test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}',
      'data: [DONE]',
      '',
    ].join('\n\n'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('ModelGateway qitu engine consumes Pi SSE and preserves the gateway result contract', async () => {
  const previous = process.env.QITU_MODEL_RUNTIME_ENGINE;
  const upstream = await startSseMock();
  process.env.QITU_MODEL_RUNTIME_ENGINE = 'qitu';
  const target: ModelRuntimeTarget = {
    providerId: 'qitu-test-provider',
    providerName: 'Qitu Test Provider',
    modelId: 'qitu-test-model',
    baseUrl: upstream.baseUrl,
    api: 'openai-completions',
    authHeader: true,
    credential: SECRET,
  };
  const resolver: ModelRuntimeResolver = { resolveRuntimeTarget: () => target };
  try {
    const result = await new ModelGateway(resolver).complete('tutor.chat', {
      messages: [{ role: 'user', content: '请引导我' }],
    });
    assert.equal(result.text, '引导问题？');
    assert.equal(result.providerId, target.providerId);
    assert.deepEqual(result.usage, { inputTokens: 2, outputTokens: 3, totalTokens: 5 });
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  } finally {
    if (previous === undefined) delete process.env.QITU_MODEL_RUNTIME_ENGINE;
    else process.env.QITU_MODEL_RUNTIME_ENGINE = previous;
    await upstream.close();
  }
});
