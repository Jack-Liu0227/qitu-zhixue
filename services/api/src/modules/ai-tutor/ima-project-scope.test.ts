import assert from 'node:assert/strict';
import { test } from 'node:test';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';
import { ImaProjectBoundary, type ImaProjectScope } from './ima-project-scope';

const schema = { type: 'object', properties: {} };
function fixture() {
  let allowed = ['kb-a', 'kb-added-later'];
  let now = 1000;
  const scope: ImaProjectScope = {
    projectId: 'project-a', studentId: 'student-a', knowledgeBaseIds: ['kb-a'],
    toolPins: [{ toolId: 'ima_read_document', mcpServerId: 'ima-knowledge', handlerVersion: 'ima-mcp.v1', schemaDigest: teachingValueDigest(schema) }],
    refreshAllowedKnowledgeBaseIds: async () => allowed,
  };
  return { scope, boundary: new ImaProjectBoundary(scope, () => now),
    revoke: () => { allowed = []; }, expire: () => { now += 300001; } };
}
const list = JSON.stringify({ items: [
  { kind: 'document', knowledge_base_id: 'kb-a', document_ref: 'ref-a', title: 'Verified retrieval' },
  { kind: 'folder', knowledge_base_id: 'kb-a', folder_ref: 'folder-a', title: 'Folder' },
  { kind: 'document', knowledge_base_id: 'kb-outside', document_ref: 'ref-outside', title: 'Must not leak' },
] });

test('frozen project list filters current global additions; search/list reject outside KBs before calls', async () => {
  const { boundary } = fixture();
  await boundary.before('ima_list_knowledge_bases', {});
  const bases = JSON.parse(await boundary.after('ima_list_knowledge_bases', null, JSON.stringify({ knowledge_bases: [
    { knowledge_base_id: 'kb-a', name: 'Allowed' }, { knowledge_base_id: 'kb-added-later', name: 'New grant' },
  ] })));
  assert.deepEqual(bases.knowledge_bases.map((base: { knowledge_base_id: string }) => base.knowledge_base_id), ['kb-a']);
  for (const name of ['ima_search_knowledge', 'ima_list_documents']) {
    await assert.rejects(boundary.before(name, { knowledge_base_id: 'kb-added-later', query: 'probe' }), /SCOPE_DENIED/);
  }
  await assert.rejects(boundary.before('ima_search_knowledge', { knowledge_base_id: 'kb-a', query: 'probe', projectId: 'forged' }), /SCOPE_DENIED/);
});

test('read requires a bounded reference actually returned by this project search; folder traversal uses same provenance', async () => {
  const h = fixture();
  await assert.rejects(h.boundary.before('ima_read_document', { document_ref: 'signed-but-unseen' }), /REFERENCE_REQUIRED/);
  assert.equal(await h.boundary.before('ima_search_knowledge', { knowledge_base_id: 'kb-a', query: 'light' }), 'kb-a');
  const result = JSON.parse(await h.boundary.after('ima_search_knowledge', 'kb-a', list));
  assert.equal(result.items.length, 2);
  assert.equal(await h.boundary.before('ima_read_document', { document_ref: 'ref-a', page_count: 1 }), 'kb-a');
  assert.equal(await h.boundary.before('ima_list_documents', { knowledge_base_id: 'kb-a', folder_ref: 'folder-a' }), 'kb-a');
  await assert.rejects(h.boundary.before('ima_read_document', { document_ref: 'ref-outside' }), /REFERENCE_REQUIRED/);
  await assert.rejects(h.boundary.before('ima_read_document', { document_ref: 'folder-a' }), /REFERENCE_REQUIRED/);
  await assert.rejects(new ImaProjectBoundary({ ...h.scope, projectId: 'other-project' }).before('ima_read_document', { document_ref: 'ref-a' }), /REFERENCE_REQUIRED/);
  h.expire();
  await assert.rejects(h.boundary.before('ima_read_document', { document_ref: 'ref-a' }), /REFERENCE_REQUIRED/);
});

test('response scope is checked again after an in-flight call and read citation must match provenance', async () => {
  const h = fixture();
  await h.boundary.after('ima_list_documents', 'kb-a', list);
  await h.boundary.before('ima_read_document', { document_ref: 'ref-a' });
  await assert.rejects(h.boundary.after('ima_read_document', 'kb-a', JSON.stringify({ citation: { knowledge_base_id: 'other-kb' }, content: 'private' })), /INVALID_RESULT/);
  const valid = JSON.stringify({ citation: { knowledge_base_id: 'kb-a', title: 'Book' }, available: true, format: 'text', content: 'Actual text', offset: 0, total_chars: 11 });
  assert.equal(JSON.parse(await h.boundary.after('ima_read_document', 'kb-a', valid)).content, 'Actual text');
  const pdf = JSON.stringify({ citation: { knowledge_base_id: 'kb-a' }, available: true, format: 'pdf_text', total_pages: 10, pages: [{ page: 3, text: 'Actual PDF text' }], page_numbering: 'PDF file page index' });
  assert.equal(JSON.parse(await h.boundary.after('ima_read_document', 'kb-a', pdf)).pages[0].page, 3);
  h.revoke();
  await assert.rejects(h.boundary.after('ima_read_document', 'kb-a', valid), /ACCESS_REVOKED/);
  await assert.rejects(h.boundary.before('ima_read_document', { document_ref: 'ref-a' }), /SCOPE_DENIED/);
});

test('tool version/schema drift, unknown response schema, invalid pagination and bounded provenance eviction fail closed', async () => {
  const h = fixture();
  h.boundary.assertDefinition('ima_read_document', schema);
  assert.throws(() => h.boundary.assertDefinition('ima_read_document', { type: 'array' }), /VERSION_CHANGED/);
  h.scope.toolPins[0]!.handlerVersion = 'ima-mcp.v2';
  assert.throws(() => h.boundary.assertDefinition('ima_read_document', schema), /VERSION_CHANGED/);
  await assert.rejects(h.boundary.after('ima_search_knowledge', 'kb-a', JSON.stringify({ documents: [] })), /INVALID_RESULT/);
  for (let batch = 0; batch < 4; batch++) {
    await h.boundary.after('ima_list_documents', 'kb-a', JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({
      kind: 'document', knowledge_base_id: 'kb-a', document_ref: `ref-${batch}-${i}`,
    })) }));
  }
  await assert.rejects(h.boundary.before('ima_read_document', { document_ref: 'ref-0-0' }), /REFERENCE_REQUIRED/);
  assert.equal(await h.boundary.before('ima_read_document', { document_ref: 'ref-3-99' }), 'kb-a');
  await assert.rejects(h.boundary.before('ima_read_document', { document_ref: 'ref-3-99', page_count: 1.5 }), /SCOPE_DENIED/);
});


test('only an actual scoped read publishes bounded evidence metadata; searches and unavailable documents do not', async () => {
  const h = fixture();
  const recorded: unknown[] = []; h.scope.recordReadEvidence = (evidence) => recorded.push(evidence);
  await h.boundary.after('ima_search_knowledge', 'kb-a', list);
  assert.deepEqual(recorded, []);
  const unavailable = JSON.stringify({ citation: { knowledge_base_id: 'kb-a' }, available: false, message: 'not available' });
  await h.boundary.after('ima_read_document', 'kb-a', unavailable, 'ref-a');
  assert.deepEqual(recorded, []);
  const text = JSON.stringify({ citation: { knowledge_base_id: 'kb-a', title: 'Book' }, available: true,
    format: 'text', content: 'SOURCE_TEXT_MUST_NOT_BE_METADATA', offset: 0, total_chars: 32 });
  const result = JSON.parse(await h.boundary.after('ima_read_document', 'kb-a', text, 'ref-a'));
  assert.equal(recorded.length, 1);
  assert.match(result.evidence_ref, /^ima-read:/);
  assert.doesNotMatch(JSON.stringify(recorded), /SOURCE_TEXT_MUST_NOT_BE_METADATA|ref-a/);
  h.revoke();
  await assert.rejects(h.boundary.after('ima_read_document', 'kb-a', text, 'ref-a'));
  assert.equal(recorded.length, 1);
});
