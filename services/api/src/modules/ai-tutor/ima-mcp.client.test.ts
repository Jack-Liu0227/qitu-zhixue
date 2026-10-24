import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { ImaMcpClient } from './ima-mcp.client';
import type { TutorAgentMcpDescriptor } from '@qitu/contracts';
import type { ImaProjectScope } from './ima-project-scope';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';

const binding: TutorAgentMcpDescriptor = {
  serverId: 'ima-knowledge',
  label: 'ima',
  transport: 'streamable_http',
  toolIds: ['ima_list_knowledge_bases'],
};

test('unbound Agent cannot connect even when credentials are configured', async () => {
  const client = new ImaMcpClient({
    QITU_IMA_MCP_URL: 'http://127.0.0.1:1/mcp',
    QITU_IMA_MCP_TOKEN: 'x'.repeat(32),
  });
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
    if (rpc.method === 'notifications/initialized') {
      response.writeHead(202);
      response.end();
      return;
    }
    const result =
      rpc.method === 'initialize'
        ? { protocolVersion: '2025-03-26' }
        : rpc.method === 'tools/list'
          ? {
              tools: ['ima_list_knowledge_bases', 'ima_read_document', 'evil_write'].map(
                (name) => ({ name, description: name, inputSchema: { type: 'object' } }),
              ),
            }
          : { content: [{ type: 'text', text: '{"items":[{"name":"高中数学"}]}' }] };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(
      'event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }) + '\n\n',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const client = new ImaMcpClient({
      QITU_IMA_MCP_URL: `http://127.0.0.1:${address.port}/mcp`,
      QITU_IMA_MCP_TOKEN: 'x'.repeat(32),
    });
    const catalogs = await Promise.all([client.toolsFor([binding]), client.toolsFor([binding])]);
    for (const tools of catalogs) {
      assert.deepEqual(
        tools.map((tool) => tool.name),
        ['ima_list_knowledge_bases'],
      );
      assert.match((await tools[0]!.execute({})).text, /高中数学/);
    }
    assert.equal(methods.filter((method) => method === 'initialize').length, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('rejects credential-bearing or non-local plaintext endpoints before network access', async () => {
  for (const url of [
    'http://example.com/mcp',
    'https://user:secret@example.com/mcp',
    'https://example.com/mcp?token=secret',
  ]) {
    await assert.rejects(
      new ImaMcpClient({ QITU_IMA_MCP_URL: url, QITU_IMA_MCP_TOKEN: 'x'.repeat(32) }).toolsFor([
        binding,
      ]),
      /INVALID_ENDPOINT/,
    );
  }
});

test('revocation after discovery blocks an already-held tool before any upstream call', async () => {
  let calls = 0;
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const rpc = JSON.parse(raw);
    if (rpc.method === 'notifications/initialized') {
      response.writeHead(202);
      response.end();
      return;
    }
    if (rpc.method === 'tools/call') calls++;
    const result =
      rpc.method === 'initialize'
        ? { protocolVersion: '2025-03-26' }
        : rpc.method === 'tools/list'
          ? { tools: [{ name: 'ima_list_knowledge_bases', inputSchema: { type: 'object' } }] }
          : { content: [{ type: 'text', text: 'ok' }] };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    let permitted = true;
    const client = new ImaMcpClient({
      QITU_IMA_MCP_URL: `http://127.0.0.1:${address.port}/mcp`,
      QITU_IMA_MCP_TOKEN: 'x'.repeat(32),
    });
    const tools = await client.toolsFor([binding], async () => permitted);
    await tools[0]!.execute({});
    assert.equal(calls, 1);
    permitted = false;
    await assert.rejects(() => tools[0]!.execute({}), /ACCESS_REVOKED/);
    assert.equal(calls, 1, 'revoked call must never reach ima');
    assert.deepEqual(await client.toolsFor([binding], async () => false), []);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('catalog discovery follows pages without executing tools, and rejects cursor cycles', async () => {
  let cycle = false;
  const calls: string[] = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const rpc = JSON.parse(raw);
    calls.push(rpc.method);
    if (rpc.method === 'notifications/initialized') {
      response.writeHead(202);
      response.end();
      return;
    }
    const result =
      rpc.method === 'initialize'
        ? { protocolVersion: '2025-03-26' }
        : !rpc.params.cursor
          ? { tools: [], nextCursor: 'page-2' }
          : {
              tools: [
                {
                  name: 'ima_list_knowledge_bases',
                  inputSchema: {
                    type: 'object',
                    properties: { limit: { type: 'integer', maximum: 50 } },
                  },
                },
              ],
              ...(cycle ? { nextCursor: 'page-2' } : {}),
            };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const client = new ImaMcpClient({
      QITU_IMA_MCP_URL: `http://127.0.0.1:${address.port}/mcp`,
      QITU_IMA_MCP_TOKEN: 'x'.repeat(32),
    });
    const tools = await client.toolsFor([binding]);
    assert.equal(tools.length, 1);
    assert.deepEqual(tools[0]!.inputSchema.properties, { limit: { type: 'integer', maximum: 50 } });
    assert.deepEqual(calls, [
      'initialize',
      'notifications/initialized',
      'tools/list',
      'tools/list',
    ]);
    cycle = true;
    await assert.rejects(client.toolsFor([binding]), /INVALID_CURSOR/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('project MCP execution filters KBs, records real search provenance and rejects schema drift/revocation', async () => {
  const names = ['ima_list_knowledge_bases', 'ima_search_knowledge', 'ima_list_documents', 'ima_read_document'];
  const inputSchema = { type: 'object' };
  let drift = false;
  let allowed = true;
  let revokeDuringRead = false;
  let deniedSearch = false;
  const calls: string[] = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const rpc = JSON.parse(raw);
    if (rpc.method === 'notifications/initialized') { response.writeHead(202); response.end(); return; }
    let result: unknown;
    if (rpc.method === 'initialize') result = { protocolVersion: '2025-03-26' };
    else if (rpc.method === 'tools/list') result = { tools: names.map((name) => ({ name, inputSchema: drift ? { type: 'array' } : inputSchema })) };
    else {
      const name = rpc.params.name;
      calls.push(name);
      assert.equal(rpc.params.arguments.projectId, undefined, 'project metadata must stay server-side');
      const value = name === 'ima_list_knowledge_bases' ? { knowledge_bases: [{ knowledge_base_id: 'allowed' }, { knowledge_base_id: 'outside' }] }
        : name === 'ima_read_document' ? { citation: { knowledge_base_id: 'allowed' }, available: true, format: 'text', content: 'Retrieved text', offset: 0, total_chars: 14 }
          : { items: [{ kind: 'document', knowledge_base_id: 'allowed', document_ref: 'signed-source-reference' }] };
      if (name === 'ima_read_document' && revokeDuringRead) allowed = false;
      result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
      if (name === 'ima_search_knowledge' && deniedSearch) result = { isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'IMA_ACCESS_DENIED', message: 'private upstream body' }) }] };
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const client = new ImaMcpClient({ QITU_IMA_MCP_URL: `http://127.0.0.1:${address.port}/mcp`, QITU_IMA_MCP_TOKEN: 'x'.repeat(32) });
    const scope: ImaProjectScope = { projectId: 'project-a', studentId: 'student-a', knowledgeBaseIds: ['allowed'],
      toolPins: names.map((toolId) => ({ toolId, handlerVersion: 'ima-mcp.v1', schemaDigest: teachingValueDigest(inputSchema), mcpServerId: 'ima-knowledge' })),
      refreshAllowedKnowledgeBaseIds: async () => allowed ? ['allowed', 'outside'] : [],
    };
    const tools = await client.toolsFor([{ ...binding, toolIds: names }], async () => true, scope);
    const tool = (name: string) => tools.find((entry) => entry.name === name)!;
    assert.equal(JSON.parse((await tool(names[0]!).execute({})).text).knowledge_bases.length, 1);
    await assert.rejects(tool(names[1]!).execute({ knowledge_base_id: 'outside', query: 'light' }), /SCOPE_DENIED/);
    await assert.rejects(tool(names[3]!).execute({ document_ref: 'signed-source-reference' }), /REFERENCE_REQUIRED/);
    deniedSearch = true;
    const denied = await tool(names[1]!).execute({ knowledge_base_id: 'allowed', query: 'light' });
    assert.equal(denied.isError, true);
    assert.match(denied.text, /^KNOWLEDGE_UPSTREAM_DENIED/);
    assert.doesNotMatch(denied.text, /private upstream body/);
    await assert.rejects(tool(names[3]!).execute({ document_ref: 'signed-source-reference' }), /REFERENCE_REQUIRED/);
    deniedSearch = false;
    await tool(names[1]!).execute({ knowledge_base_id: 'allowed', query: 'light' });
    assert.match((await tool(names[3]!).execute({ document_ref: 'signed-source-reference' })).text, /Retrieved text/);
    const otherTurn = await client.toolsFor([{ ...binding, toolIds: names }], async () => true, { ...scope, projectId: 'other-project' });
    await assert.rejects(otherTurn[3]!.execute({ document_ref: 'signed-source-reference' }), /REFERENCE_REQUIRED/);
    revokeDuringRead = true;
    await assert.rejects(tool(names[3]!).execute({ document_ref: 'signed-source-reference' }), /IMA_PROJECT_SCOPE_REVOKED/);
    const count = calls.length;
    await assert.rejects(tool(names[1]!).execute({ knowledge_base_id: 'allowed', query: 'light' }), /SCOPE_DENIED/);
    assert.equal(calls.length, count);
    drift = true;
    await assert.rejects(client.toolsFor([{ ...binding, toolIds: names }], async () => true, scope), /TOOL_VERSION_CHANGED/);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
