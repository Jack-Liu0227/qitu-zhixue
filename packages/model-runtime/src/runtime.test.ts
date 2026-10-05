import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createModelRuntime, ModelRuntimeError } from './runtime.js';

async function withMockOpenAI(handler: (headers: Record<string, string | string[] | undefined>) => string, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createServer((request, response) => {
    const headers = request.headers as Record<string, string | string[] | undefined>;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(handler(headers));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('Qitu runtime calls a registry-resolved OpenAI compatible model', async () => {
  await withMockOpenAI((headers) => {
    assert.equal(headers.authorization, `Bearer ${'test'}-credential`);
    return [
      'data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"引导"},"finish_reason":null}]}',
      'data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"问题？"},"finish_reason":null}]}',
      'data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}',
      'data: [DONE]',
      '',
    ].join('\n\n');
  }, async (baseUrl) => {
    const runtime = createModelRuntime({
      resolveRuntimeTarget: () => ({
        providerId: 'test-provider',
        providerName: 'Test Provider',
        modelId: 'test-model',
        baseUrl,
        api: 'openai-completions',
        credential: 'test-credential',
      }),
    });
    const result = await runtime.complete({
      usageId: 'tutor.chat',
      messages: [{ role: 'user', content: '请引导我' }],
    });
    assert.equal(result.text, '引导问题？');
    assert.equal(result.providerId, 'test-provider');
  });
});

test('Qitu runtime fails closed when the credential is missing', async () => {
  const runtime = createModelRuntime({
    resolveRuntimeTarget: () => ({
      providerId: 'test-provider',
      providerName: 'Test Provider',
      modelId: 'test-model',
      baseUrl: 'https://example.invalid',
      api: 'openai-completions',
      credential: '',
    }),
  });
  await assert.rejects(
    runtime.complete({ usageId: 'tutor.chat', messages: [{ role: 'user', content: 'hi' }] }),
    (error: unknown) => error instanceof ModelRuntimeError && error.code === 'MODEL_CREDENTIAL_MISSING',
  );
});

test('Qitu runtime rejects a partial Agent model selection', async () => {
  const runtime = createModelRuntime({
    resolveRuntimeTarget: () => {
      throw new Error('usage fallback must not be used');
    },
    resolveRuntimeTargetByModel: () => {
      throw new Error('partial selection must be rejected before resolution');
    },
  });
  await assert.rejects(
    runtime.complete({
      usageId: 'agent.model',
      providerId: 'test-provider',
      messages: [{ role: 'user', content: 'hi' }],
    }),
    (error: unknown) => error instanceof ModelRuntimeError && error.code === 'MODEL_REQUEST_INVALID',
  );
});
