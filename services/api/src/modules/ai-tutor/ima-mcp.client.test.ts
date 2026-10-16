import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { ImaMcpClient } from './ima-mcp.client';
import type { TutorAgentMcpDescriptor } from '@qitu/contracts';

const binding: TutorAgentMcpDescriptor = { serverId: 'ima-knowledge', label: 'ima', transport: 'streamable_http', toolIds: ['ima_list_knowledge_bases'] };

test('unbound Agent cannot connect even when credentials are configured', async () => {
  const client = new ImaMcpClient({ QITU_IMA_MCP_URL: 'http://127.0.0.1:1/mcp', QITU_IMA_MCP_TOKEN: 'x'.repeat(32) });
  assert.equal(client.isBound([]), false);
  assert.deepEqual(await client.toolsFor([]), []);
});

test('MCP handshake, binding intersection, SSE results and isolated concurrent turns', async () => {
  const methods: string[] = [];
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer ' + 'x'.repeat(32));
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const rpc = JSON.parse(raw);
    methods.push(rpc.method);
    if (rpc.method === 'notifications/initialized') { response.writeHead(202); response.end(); return; }
    const result = rpc.method === 'initialize' ? { protocolVersion: '2025-03-26' }
      : rpc.method === 'tools/list' ? { tools: ['ima_list_knowledge_bases', 'ima_read_document', 'evil_write'].map((name) => ({ name, description: name, inputSchema: { type: 'object' } })) }
      : { content: [{ type: 'text', text: '{"items":[{"name":"高中数学"}]}' }] };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }) + '\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const client = new ImaMcpClient({ QITU_IMA_MCP_URL: `http://127.0.0.1:${address.port}/mcp`, QITU_IMA_MCP_TOKEN: 'x'.repeat(32) });
    const catalogs = await Promise.all([client.toolsFor([binding]), client.toolsFor([binding])]);
    for (const tools of catalogs) {
      assert.deepEqual(tools.map((tool) => tool.name), ['ima_list_knowledge_bases']);
      assert.match((await tools[0]!.execute({})).text, /高中数学/);
    }
    assert.equal(methods.filter((method) => method === 'initialize').length, 2);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('rejects credential-bearing or non-local plaintext endpoints before network access', async () => {
  for (const url of ['http://example.com/mcp', 'https://user:secret@example.com/mcp', 'https://example.com/mcp?token=secret']) {
    await assert.rejects(new ImaMcpClient({ QITU_IMA_MCP_URL: url, QITU_IMA_MCP_TOKEN: 'x'.repeat(32) }).toolsFor([binding]), /INVALID_ENDPOINT/);
  }
});

test('revocation after discovery blocks an already-held tool before any upstream call', async () => {
  let calls = 0;
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const rpc = JSON.parse(raw);
    if (rpc.method === 'notifications/initialized') { response.writeHead(202); response.end(); return; }
    if (rpc.method === 'tools/call') calls++;
    const result = rpc.method === 'initialize' ? { protocolVersion: '2025-03-26' }
      : rpc.method === 'tools/list' ? { tools: [{ name: 'ima_list_knowledge_bases', inputSchema: { type: 'object' } }] }
      : { content: [{ type: 'text', text: 'ok' }] };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    let permitted = true;
    const client = new ImaMcpClient({ QITU_IMA_MCP_URL: `http://127.0.0.1:${address.port}/mcp`, QITU_IMA_MCP_TOKEN: 'x'.repeat(32) });
    const tools = await client.toolsFor([binding], async () => permitted);
    await tools[0]!.execute({});
    assert.equal(calls, 1);
    permitted = false;
    await assert.rejects(() => tools[0]!.execute({}), /ACCESS_REVOKED/);
    assert.equal(calls, 1, 'revoked call must never reach ima');
    assert.deepEqual(await client.toolsFor([binding], async () => false), []);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
