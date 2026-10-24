import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createModelRuntime } from '@qitu/model-runtime';
import { coursewareToolSchema, COURSEWARE_TOOL_INSTRUCTIONS } from './courseware-tool-schema';

test('model-facing courseware schema rejects mixed fields, plan IDs and caption-only steps before owner execution', async () => {
  const board = { kind: 'board', title: '示意波', objectiveRefs: ['stable-objective'], sourceRefs: ['knowledge-read:fixture'],
    steps: [{ caption: '同方向叠加', tex: '1+1=2' }] };
  const invalid = [{ ...board, use: 'explain' }, { ...board, summary: 'extra' }, { ...board, objectiveRefs: ['plan:stable-objective'] },
    { ...board, steps: [{ caption: 'missing diagram' }] }, { kind: 'find_courseware', use: 'explain', steps: board.steps }];
  let requests = 0, executed = 0;
  const failures: string[] = [];
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain request body. */ }
    const first = requests++ === 0;
    const delta = first ? { tool_calls: [...invalid, board, { ...board, steps: [...board.steps, { caption: 'Now predict the result.' }] }, { kind: 'find_courseware', use: 'explain' }].map((args, index) => ({ index,
      id: `schema-${index}`, type: 'function', function: { name: 'lesson', arguments: JSON.stringify(args) } })) } : { content: 'Accepted valid proposals.' };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(['data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] }),
      'data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: first ? 'tool_calls' : 'stop' }] }),
      'data: [DONE]', ''].join('\n\n'));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const runtime = createModelRuntime({ resolveRuntimeTarget: () => ({ providerId: 'fixture', providerName: 'Fixture', modelId: 'fixture',
      baseUrl: `http://127.0.0.1:${address.port}`, api: 'openai-completions', credential: 'synthetic' }) });
    await runtime.complete({ usageId: 'fixture', messages: [{ role: 'user', content: 'fixture' }], tools: [{ name: 'lesson',
      description: COURSEWARE_TOOL_INSTRUCTIONS, inputSchema: coursewareToolSchema(['stable-objective']), execute: async () => { executed++; return { text: 'Accepted' }; } }],
      onToolEvent: event => { if (event.type === 'result' && event.isError) failures.push(event.errorCode ?? 'missing'); } });
    assert.equal(executed, 3);
    assert.deepEqual(failures, invalid.map(() => 'TOOL_ARGUMENT_INVALID'));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  assert.match(COURSEWARE_TOOL_INSTRUCTIONS, /newly generated board still requires verified sources/);
});
