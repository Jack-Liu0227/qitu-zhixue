import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RealtimeServerEvent, TutorReplyBlock } from '@qitu/contracts';
import { isTutorReplyBlock } from '../state';
import { openTutorStream } from './tutorStream';

test('server boards survive SSE and history validation with combined visuals and a prediction-only step', async () => {
  const board: TutorReplyBlock = { kind: 'board', boardId: 'delivery-fixture', steps: [
    { caption: 'Position changes every frame', mermaid: 'flowchart LR\nA[Input] --> B[Position]', tex: 'x_{n+1}=x_n+v\\Delta t' },
    { caption: 'Predict what happens when the speed doubles.' },
  ] };
  const original = globalThis.fetch;
  const events: RealtimeServerEvent[] = [];
  globalThis.fetch = async () => new Response(`event: block\ndata: ${JSON.stringify({ seq: 1, block: board })}\n\n`,
    { headers: { 'content-type': 'text/event-stream' } });
  try {
    await new Promise<void>((resolve, reject) => openTutorStream({ sessionId: 'session-fixture', idempotencyKey: 'fixture-delivery', content: 'Explain' }, {
      sessionId: 'session-fixture', turnId: 'turn-fixture', onEvent: event => events.push(event),
      onFailure: reject, onSettled: resolve,
    }));
    const delivered = events.find(event => event.type === 'tutor.block');
    assert.ok(delivered && delivered.type === 'tutor.block', 'The transport must not silently discard an owner-issued board');
    assert.deepEqual(delivered.block, board);
    assert.equal(isTutorReplyBlock(JSON.parse(JSON.stringify(board))), true, 'Reloaded history uses the same guard');
  } finally { globalThis.fetch = original; }
});

test('board validation still rejects malformed representations and boards with no visual content', () => {
  for (const steps of [[], [{ caption: 'Text only' }], [{ caption: 'Bad math', tex: 42 }], [{ caption: 'Empty graph', mermaid: '' }]]) {
    assert.equal(isTutorReplyBlock({ kind: 'board', boardId: 'invalid', steps }), false);
  }
  for (const representation of ['tex', 'mermaid', 'svg']) {
    assert.equal(isTutorReplyBlock({ kind: 'board', boardId: 'legacy', steps: [{ caption: 'Legacy visual', [representation]: 'content' }] }), true);
  }
});
