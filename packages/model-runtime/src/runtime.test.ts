import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createModelRuntime, ModelRuntimeError } from './runtime.js';

test('native tool loop returns actual tool output to the model and denies unregistered tools', async () => {
  let requests = 0;
  let executions = 0;
  const events: string[] = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const body = JSON.parse(raw);
    requests++;
    if (requests === 1) {
      assert.equal(body.tools[0].function.name, 'ima_read_document');
      assert.equal(raw.includes('execute'), false);
    } else {
      assert.ok(body.messages.some((m: { role: string; content: string }) => m.role === 'tool' && m.content === '教材第10页：集合的含义'));
      assert.ok(body.messages.some((m: { role: string; content: string }) => m.role === 'tool' && m.content === 'TOOL_NOT_ALLOWED'));
    }
    const delta = requests === 1 ? { tool_calls: [
      { index: 0, id: 'read-1', type: 'function', function: { name: 'ima_read_document', arguments: '{"start_page":10}' } },
      { index: 1, id: 'bad-1', type: 'function', function: { name: 'delete_all', arguments: '{}' } },
    ] } : { content: '根据教材第10页，你能举出集合的例子吗？' };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end([
      'data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] }),
      'data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: requests === 1 ? 'tool_calls' : 'stop' }] }),
      'data: [DONE]', '',
    ].join('\n\n'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const runtime = createModelRuntime({ resolveRuntimeTarget: () => ({ providerId: 'test', providerName: 'Test', modelId: 'test-model',
      baseUrl: `http://127.0.0.1:${address.port}`, api: 'openai-completions', credential: 'test-key' }) });
    const result = await runtime.complete({ usageId: 'tutor.chat', messages: [{ role: 'user', content: '查教材' }], tools: [{
      name: 'ima_read_document', description: 'read authorized document', inputSchema: { type: 'object', properties: { start_page: { type: 'integer' } } },
      execute: async (args) => { assert.equal(args.start_page, 10); executions++; return { text: '教材第10页：集合的含义' }; },
    }], onToolEvent: (event) => events.push(event.type) });
    assert.match(result.text, /教材第10页/);
    assert.equal(executions, 1);
    assert.equal(requests, 2);
    assert.deepEqual(events, ['call', 'result']);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

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

test('native tool loop stops repeated requests after eight executions', async () => {
  let executions = 0;
  const chunk = { id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { tool_calls: [
    { index: 0, id: 'repeat', type: 'function', function: { name: 'read', arguments: '{}' } },
  ] }, finish_reason: null }] };
  await withMockOpenAI(() => [
    'data: ' + JSON.stringify(chunk),
    'data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
    'data: [DONE]', '',
  ].join('\n\n'), async (baseUrl) => {
    const runtime = createModelRuntime({ resolveRuntimeTarget: () => ({ providerId: 'test', providerName: 'Test', modelId: 'test', baseUrl,
      api: 'openai-completions', credential: 'test-key' }) });
    await assert.rejects(runtime.complete({ usageId: 'test', messages: [{ role: 'user', content: 'read' }], tools: [{ name: 'read', description: 'read',
      inputSchema: { type: 'object' }, execute: async () => { executions++; return { text: 'result' }; } }] }),
    (error: unknown) => error instanceof ModelRuntimeError && error.code === 'MODEL_REQUEST_INVALID');
    assert.equal(executions, 8);
  });
});

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

test('Qitu runtime preserves authHeader=false for OpenAI-compatible providers', async () => {
  await withMockOpenAI((headers) => {
    assert.equal(headers.authorization, undefined);
    return [
      'data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}',
      'data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: [DONE]',
      '',
    ].join('\n\n');
  }, async (baseUrl) => {
    const runtime = createModelRuntime({
      resolveRuntimeTarget: () => ({
        providerId: 'custom-gateway',
        providerName: 'Custom Gateway',
        modelId: 'custom-model',
        baseUrl,
        api: 'openai-completions',
        authHeader: false,
        // A gateway with authHeader=false is allowed to run without a model
        // credential. The runtime must not manufacture a Bearer header.
        credential: null,
      }),
    });
    const result = await runtime.complete({
      usageId: 'agent.custom',
      messages: [{ role: 'user', content: 'hello' }],
    });
    assert.equal(result.text, 'ok');
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

test('Qitu runtime requires an Anthropic credential even when authHeader is false', async () => {
  const runtime = createModelRuntime({
    resolveRuntimeTarget: () => ({
      providerId: 'anthropic-provider',
      providerName: 'Anthropic',
      modelId: 'claude-test',
      baseUrl: 'https://example.invalid',
      api: 'anthropic-messages',
      authHeader: false,
      credential: null,
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

test('Qitu runtime rejects credential-bearing model gateway URLs', async () => {
  const runtime = createModelRuntime({
    resolveRuntimeTarget: () => ({
      providerId: 'test-provider',
      providerName: 'Test Provider',
      modelId: 'test-model',
      baseUrl: 'https://user:secret@example.invalid/v1?api_key=leak',
      api: 'openai-completions',
      credential: 'test-credential',
    }),
  });
  await assert.rejects(
    runtime.complete({ usageId: 'tutor.chat', messages: [{ role: 'user', content: 'hi' }] }),
    (error: unknown) => error instanceof ModelRuntimeError && error.code === 'MODEL_REQUEST_INVALID',
  );
});
