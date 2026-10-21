import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StreamableMcpClient, type McpHttpTransport } from './mcp-streamable.js';

function fixture(sse = false) {
  const calls: string[] = [];
  const transport: McpHttpTransport = async (body, headers) => {
    const request = JSON.parse(body) as { id?: number; method: string; params: Record<string, unknown> };
    calls.push(request.method);
    if (calls.length > 1) assert.equal(headers['mcp-session-id'], 'fixture-session');
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = request.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} } }
      : request.method === 'tools/list' ? { tools: [{ name: 'echo', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } }, additionalProperties: false } },
        { name: 'not-granted', inputSchema: { type: 'object' } }] }
      : { content: [{ type: 'text', text: 'fixture result' }] };
    const envelope = JSON.stringify({ jsonrpc: '2.0', id: request.id, result });
    return new Response(sse ? `event: message\ndata: ${envelope}\n\n` : envelope,
      { headers: { 'content-type': sse ? 'text/event-stream' : 'application/json', 'mcp-session-id': 'fixture-session' } });
  };
  return { client: new StreamableMcpClient(transport), calls };
}

for (const sse of [false, true]) test(`MCP ${sse ? 'SSE' : 'JSON'} discovers allowed tools, preserves session and enforces live authorization/schema`, async () => {
  const { client, calls } = fixture(sse);
  const definitions = await client.discover(['echo']);
  assert.deepEqual(definitions.map(tool => tool.name), ['echo']);
  let allowed = true;
  const tool = client.tool(definitions[0]!, async () => allowed);
  assert.equal((await tool.execute({ query: 'test' })).text, 'fixture result');
  await assert.rejects(tool.execute({ query: 123 }), /MCP_ARGUMENTS_INVALID/);
  allowed = false;
  await assert.rejects(tool.execute({ query: 'test' }), /MCP_ACCESS_DENIED/);
  assert.equal(calls.filter(method => method === 'tools/call').length, 1);
});

test('MCP rejects missing grants, duplicate pagination and oversized responses', async () => {
  await assert.rejects(fixture().client.discover(['missing']), /MCP_ALLOWED_TOOL_MISSING/);
  const duplicate = new StreamableMcpClient(async body => {
    const request = JSON.parse(body) as { id: number; method: string };
    const result = request.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} } }
      : { tools: [], nextCursor: 'same' };
    return request.method === 'notifications/initialized' ? new Response(null, { status: 202 })
      : new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });
  });
  await assert.rejects(duplicate.discover([]), /MCP_CURSOR_INVALID/);
  const oversized = new StreamableMcpClient(async () => new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(oversized.discover([]), /MCP_RESPONSE_TOO_LARGE/);
});

test('MCP remote error responses never masquerade as successful tools', async () => {
  let count = 0;
  const transport: McpHttpTransport = async body => {
    const request = JSON.parse(body) as { id: number; method: string };
    count++;
    const result = request.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} } }
      : request.method === 'tools/list' ? { tools: [{ name: 'tool', inputSchema: { type: 'object' } }] }
      : { isError: true, content: [{ type: 'text', text: 'upstream private detail' }] };
    return request.method === 'notifications/initialized' ? new Response(null, { status: 202 })
      : new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json' } });
  };
  const client = new StreamableMcpClient(transport);
  const [definition] = await client.discover(['tool']);
  await assert.rejects(client.tool(definition!, async () => true).execute({}), /MCP_TOOL_FAILED/);
  assert.equal(count, 4);
});
