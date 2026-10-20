import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImaScopeGuard } from './ima-tool-scope';
import { resolveTutorKnowledgeAccess } from './tutor-knowledge-access';
import { toolEventStream } from './tool-event-stream';

test('four IMA tools share a ceiling and reads require recent in-scope provenance', async () => {
  let ids = ['a']; let time = 0;
  const guard = createImaScopeGuard({ knowledgeBaseIds: async () => ids }, () => time);
  assert.deepEqual(JSON.parse(await guard.after('ima_list_knowledge_bases', null,
    JSON.stringify({ knowledge_bases: [{ knowledge_base_id: 'a' }, { knowledge_base_id: 'b' }] }))).knowledge_bases, [{ knowledge_base_id: 'a' }]);
  for (const tool of ['ima_search_knowledge', 'ima_list_documents']) {
    await assert.rejects(guard.before(tool, { knowledge_base_id: 'b' }));
    assert.equal(await guard.before(tool, { knowledge_base_id: 'a' }), 'a');
  }
  await assert.rejects(guard.before('ima_read_document', { document_ref: 'signed-but-unseen' }));
  await guard.after('ima_search_knowledge', 'a', JSON.stringify({ items: [{ document_ref: 'r' }] }));
  assert.equal(await guard.before('ima_read_document', { document_ref: 'r' }), 'a');
  await assert.rejects(guard.after('ima_read_document', 'a', '{"knowledge_base_id":"b"}'));
  ids = [];
  await assert.rejects(guard.before('ima_read_document', { document_ref: 'r' }));
  ids = ['a']; time = 16 * 60_000;
  await assert.rejects(guard.before('ima_read_document', { document_ref: 'r' }));
  const otherTurn = createImaScopeGuard({ knowledgeBaseIds: async () => ['a'] });
  await assert.rejects(otherTurn.before('ima_read_document', { document_ref: 'r' }));
});

test('frozen grant intersects current Admin authorization and missing bundle denies', async () => {
  let current = ['a', 'new'];
  const ima = { allowedKnowledgeBaseIds: async () => current, canCall: async () => true } as never;
  const base = { studentId: 'student', assistantId: 'assistant', projectId: 'p', templateVersionId: 'v', ima };
  const access = await resolveTutorKnowledgeAccess({ ...base, bindings: {
    getFrozenTeachingBundle: async () => ({ knowledgeGrant: { knowledgeBaseIds: ['a'], allowedTools: ['ima_search_knowledge'] } }),
  } as never });
  assert.deepEqual(await access.ima.knowledgeBaseIds(), ['a']);
  assert.equal(await access.authorize('ima_list_documents'), false);
  assert.equal(await access.authorize('ima_search_knowledge'), true);
  current = ['new'];
  assert.equal(await access.authorize('ima_search_knowledge'), false);
  const missing = await resolveTutorKnowledgeAccess(base);
  assert.deepEqual(missing.managed.knowledgeBaseIds, []);
  assert.equal(await missing.authorize('ima_search_knowledge'), false);
});

test('tool events arrive before completion and retain order when completion fails', async () => {
  let finish!: () => void;
  const hold = new Promise<void>(resolve => { finish = resolve; });
  const stream = toolEventStream<string, string>(async emit => {
    emit('call'); await hold; emit('result'); throw new Error('MODEL_FAILURE');
  });
  assert.deepEqual(await stream.next(), { value: 'call', done: false });
  finish();
  assert.deepEqual(await stream.next(), { value: 'result', done: false });
  await assert.rejects(stream.next(), /MODEL_FAILURE/);
});
