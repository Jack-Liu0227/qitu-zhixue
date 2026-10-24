import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createModelRuntime, ModelRuntimeError } from './runtime.js';

for (const final of ['text', 'empty', 'tool'] as const) {
  test(`empty narration after a saved activity recovers once without replaying tools: ${final}`, async () => {
    let requests = 0, executions = 0;
    const server = createServer(async (request, response) => {
      let raw = ''; for await (const chunk of request) raw += String(chunk);
      const body = JSON.parse(raw);
      requests++;
      if (requests === 3) {
        assert.equal(body.tools?.length ?? 0, 0, 'Recovery must not expose write tools');
        assert.ok(body.messages.some((message: { role: string; content: string }) =>
          message.role === 'tool' && message.content === 'Activity saved: fixture-receipt'));
      }
      const call = requests === 1 || requests === 3 && final === 'tool';
      const delta = call ? { tool_calls: [{ index: 0, id: `call-${requests}`, type: 'function',
        function: { name: 'save_activity', arguments: '{}' } }] }
        : { content: requests === 3 && final === 'text' ? 'The saved activity is ready to view.' : '' };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(['data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] }),
        'data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] }),
        'data: [DONE]', ''].join('\n\n'));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    try {
      const runtime = createModelRuntime({ resolveRuntimeTarget: () => ({ providerId: 'fixture', providerName: 'Fixture', modelId: 'fixture',
        baseUrl: `http://127.0.0.1:${address.port}`, api: 'openai-completions', credential: 'synthetic' }) });
      const result = runtime.complete({ usageId: 'fixture', messages: [{ role: 'user', content: 'Prepare an activity' }], tools: [{
        name: 'save_activity', description: 'Save', inputSchema: { type: 'object' },
        execute: async () => { executions++; return { text: 'Activity saved: fixture-receipt' }; },
      }] });
      if (final === 'text') assert.match((await result).text, /ready to view/);
      else await assert.rejects(result, (error: unknown) => error instanceof ModelRuntimeError
        && error.code === (final === 'empty' ? 'MODEL_EMPTY_RESPONSE' : 'MODEL_REQUEST_INVALID'));
      assert.equal(requests, 3, 'Only one recovery request is allowed');
      assert.equal(executions, 1, 'Persisted activity must not be duplicated');
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
}
