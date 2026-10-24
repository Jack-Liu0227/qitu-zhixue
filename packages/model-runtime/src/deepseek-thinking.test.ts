import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createModelRuntime } from './runtime.js';

for (const providerId of ['deepseek', 'other-provider']) {
  test(`${providerId}: disabled reasoning is serialized only for DeepSeek`, async () => {
    let payload: Record<string, unknown> | undefined;
    const server = createServer(async (request, response) => {
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      payload = JSON.parse(raw);
      const thinkingDisabled = (payload?.thinking as { type?: string } | undefined)?.type === 'disabled';
      const exhausted = providerId === 'deepseek' && !thinkingDisabled;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end([
        'data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0,
          delta: exhausted ? { reasoning_content: 'fixture reasoning' } : { content: '{"accepted":false}' },
          finish_reason: null }] }),
        'data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {},
          finish_reason: exhausted ? 'length' : 'stop' }] }),
        'data: [DONE]', '',
      ].join('\n\n'));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    try {
      const runtime = createModelRuntime({ resolveRuntimeTarget: () => ({ providerId, providerName: providerId,
        modelId: 'deepseek-flash', baseUrl: `http://127.0.0.1:${address.port}`,
        api: 'openai-completions', credential: 'isolated-fixture' }) });
      const result = await runtime.complete({ usageId: 'learning.evaluate',
        messages: [{ role: 'user', content: 'Return the evaluation JSON.' }] });
      assert.equal(result.text, '{"accepted":false}');
      assert.deepEqual(payload?.thinking, providerId === 'deepseek' ? { type: 'disabled' } : undefined);
      assert.equal(payload?.reasoning_effort, undefined);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}
