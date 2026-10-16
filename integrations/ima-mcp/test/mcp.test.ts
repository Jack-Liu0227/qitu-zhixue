import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHttpServer } from '../src/http.js';
import { object } from '../src/ima.js';
import { KnowledgeService } from '../src/knowledge.js';
import { createMcpServer } from '../src/mcp.js';
import { config, MockIma, pdfFixture, tokens } from './fixtures.js';

test('两个独立 Agent 并发通过 Streamable HTTP 搜索并读取同一知识库', async () => {
  const settings = config();
  const api = new MockIma();
  const knowledge = new KnowledgeService(settings, api, async () => ({ bytes: pdfFixture(), contentType: 'application/pdf' }));
  const http = createHttpServer(settings, knowledge);
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const port = (http.address() as AddressInfo).port;
  settings.allowedHosts = [`127.0.0.1:${port}`];
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  const clients = [new Client({ name: 'math-agent', version: '1' }), new Client({ name: 'planner-agent', version: '1' })];
  try {
    await Promise.all(clients.map((client, i) => client.connect(new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${Object.values(tokens)[i]}` } },
    }))));
    await Promise.all(clients.map(async client => {
      const tools = await client.listTools();
      assert.equal(tools.tools.length, 4);
      assert.ok(tools.tools.every(tool => tool.annotations?.readOnlyHint));
      const bases = await client.callTool({ name: 'ima_list_knowledge_bases', arguments: {} });
      assert.equal(bases.isError, undefined);
      const search = await client.callTool({ name: 'ima_search_knowledge', arguments: { knowledge_base_id: 'math', query: '对数' } });
      assert.ok(!search.isError);
      const item = object((object(search.structuredContent).items as unknown[])[0]);
      const read = await client.callTool({ name: 'ima_read_document', arguments: { document_ref: item.document_ref, start_page: 2, page_count: 1 } });
      assert.ok(!read.isError);
      const output = object(read.structuredContent);
      assert.equal(object(output.citation).title, '数学教材.pdf');
      assert.match(JSON.stringify(output.pages), /logarithm/);
    }));
    const denied = await clients[0]!.callTool({ name: 'ima_search_knowledge', arguments: { knowledge_base_id: 'private', query: 'x' } });
    assert.equal(denied.isError, true);
    const invalid = await clients[0]!.callTool({ name: 'ima_read_document', arguments: { document_ref: 'forged', page_count: 6 } });
    assert.equal(invalid.isError, true);
    assert.equal(api.calls.filter(c => c.path.endsWith('/search_knowledge')).length, 2);
  } finally {
    await Promise.all(clients.map(client => client.close()));
    await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
  }
});

test('HTTP 拦截无鉴权、错误 token、未授权 Origin、DNS rebinding Host 和非法请求', async () => {
  const settings = config();
  const api = new MockIma();
  const http = createHttpServer(settings, new KnowledgeService(settings, api));
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const port = (http.address() as AddressInfo).port;
  settings.allowedHosts = [`127.0.0.1:${port}`];
  const base = `http://127.0.0.1:${port}`;
  const auth = { Authorization: `Bearer ${tokens.math}`, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(base + '/healthz')).status, 200);
    assert.equal((await fetch(base + '/mcp', { method: 'POST' })).status, 401);
    assert.equal((await fetch(base + '/mcp', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(base + '/mcp', { headers: { ...auth, Origin: 'https://evil.example' } })).status, 403);
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(base + '/mcp', { headers: { ...auth, Host: 'evil.example' } }, res => {
        res.resume(); resolve(res.statusCode);
      });
      req.on('error', reject); req.end();
    });
    assert.equal(hostStatus, 403);
    assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: auth, body: '{' })).status, 400);
    assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: auth, body: 'x'.repeat(65537) })).status, 413);
    assert.equal((await fetch(base + '/mcp', { method: 'POST', headers: { Authorization: auth.Authorization }, body: '{}' })).status, 415);
    assert.equal((await fetch(base + '/mcp', { method: 'PUT', headers: auth })).status, 405);
    assert.equal(api.calls.length, 0);
    for (let i = 0; i < 120; i++) await fetch(base + '/mcp', { headers: auth });
    assert.equal((await fetch(base + '/mcp', { headers: auth })).status, 429);
    assert.notEqual((await fetch(base + '/mcp', { headers: { Authorization: `Bearer ${tokens.planner}` } })).status, 429);
  } finally {
    http.closeAllConnections();
    await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
  }
});

test('stdio 子进程可正常初始化，stdout 不混入配置日志', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/main.js', import.meta.url)), '--stdio'],
    env: {
      ...(process.env as Record<string, string>),
      IMA_OPENAPI_CLIENTID: 'stdio-test', IMA_OPENAPI_APIKEY: 'stdio-test-key', IMA_KNOWLEDGE_BASE_IDS: 'math',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stdio-test-agent', version: '1' });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 4);
  } finally { await client.close(); }
});

test('MCP 校验参数并向客户端返回稳定的工具错误', async () => {
  const api = new MockIma();
  const server = createMcpServer(new KnowledgeService(config(), api));
  const client = new Client({ name: 'validation-agent', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    for (const args of [
      { knowledge_base_id: 'math', query: '' },
      { knowledge_base_id: 'math', query: 'x', api_key: 'injected' },
    ]) {
      const reply = await client.callTool({ name: 'ima_search_knowledge', arguments: args });
      assert.equal(reply.isError, true);
    }
    assert.equal(api.calls.length, 0);
  } finally { await client.close(); await server.close(); }
});
