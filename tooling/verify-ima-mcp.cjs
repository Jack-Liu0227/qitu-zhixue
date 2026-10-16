#!/usr/bin/env node
// Run from a built checkout: node --env-file=/etc/qitu/ima-api.env tooling/verify-ima-mcp.cjs
// Prints counts and source metadata only; never tokens, document refs or passages.
const assert = require('node:assert/strict');
const { ImaMcpClient, IMA_READ_TOOLS } = require('../services/api/dist/modules/ai-tutor/ima-mcp.client.js');

(async () => {
  const binding = [{ serverId: 'ima-knowledge', label: 'ima', transport: 'streamable_http', toolIds: [...IMA_READ_TOOLS] }];
  const client = new ImaMcpClient();
  const catalogs = await Promise.all([client.toolsFor(binding), client.toolsFor(binding)]);
  for (const tools of catalogs) assert.equal(tools.length, 4);
  async function call(catalog, name, args) {
    const result = await catalog.find((tool) => tool.name === name).execute(args);
    assert.equal(result.isError, false);
    return JSON.parse(result.text);
  }
  const lists = await Promise.all(catalogs.map((tools) => call(tools, 'ima_list_knowledge_bases', {})));
  assert.deepEqual(lists[0], lists[1]);
  assert.equal(lists[0].knowledge_bases.length, 3);
  const bases = lists[0].knowledge_bases;
  const counts = [];
  for (const base of bases) {
    const result = await call(catalogs[0], 'ima_list_documents', { knowledge_base_id: base.knowledge_base_id, limit: 20 });
    counts.push({ name: base.name, documents: result.items.length });
  }
  const math = bases.find((base) => base.name === '高中数学');
  const search = await call(catalogs[0], 'ima_search_knowledge', { knowledge_base_id: math.knowledge_base_id, query: '数学' });
  assert.ok(search.items.length > 0);
  const document = search.items.find((item) => item.title.includes('必修') && item.title.includes('第一册'));
  assert.ok(document?.document_ref);
  const page = await call(catalogs[0], 'ima_read_document', { document_ref: document.document_ref, start_page: 10, page_count: 1, max_chars: 2000 });
  assert.equal(page.available, true);
  assert.ok(page.pages[0].text.length > 100);
  const empty = await call(catalogs[0], 'ima_search_knowledge', { knowledge_base_id: math.knowledge_base_id, query: '对数' });
  console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), concurrentClients: 2, tools: 4, bases: counts,
    mathSearchHits: search.items.length, pdf: { title: page.citation.title, page: page.pages[0].page, characters: page.pages[0].text.length },
    keywordLogarithmHits: empty.items.length, tutorModelChanged: false }, null, 2));
})().catch(() => { console.error('IMA_VERIFICATION_FAILED'); process.exitCode = 1; });
