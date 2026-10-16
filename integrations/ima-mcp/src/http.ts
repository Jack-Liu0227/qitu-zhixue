import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Config } from './config.js';
import type { KnowledgeService } from './knowledge.js';
import { createMcpServer } from './mcp.js';

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) throw new Error('CONTENT_TYPE');
  if (Number(req.headers['content-length']) > 65536) throw new Error('TOO_LARGE');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new Error('TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createHttpServer(config: Config, service: KnowledgeService) {
  const hashes = Object.entries(config.tokens).map(([name, token]) => ({ name, hash: createHash('sha256').update(token).digest() }));
  const windows = new Map<string, { start: number; count: number }>();
  let active = 0;
  const http = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!config.allowedHosts.includes((req.headers.host || '').toLowerCase())) {
      return json(res, 403, { error: 'HOST_NOT_ALLOWED' });
    }
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) return json(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id,MCP-Protocol-Version');
    }
    if (req.url === '/healthz' && req.method === 'GET') return json(res, 200, { status: 'ok' });
    if (req.url !== '/mcp') return json(res, 404, { error: 'NOT_FOUND' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'POST,GET,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept,MCP-Protocol-Version,Mcp-Session-Id',
      });
      res.end();
      return;
    }
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const hash = createHash('sha256').update(token).digest();
    const client = hashes.find(entry => timingSafeEqual(entry.hash, hash));
    if (!client) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="ima-mcp"');
      return json(res, 401, { error: 'UNAUTHORIZED' });
    }
    const now = Date.now();
    let window = windows.get(client.name);
    if (!window || now - window.start >= 60000) { window = { start: now, count: 0 }; windows.set(client.name, window); }
    if (++window.count > 120) {
      res.setHeader('Retry-After', String(Math.ceil((60000 - (now - window.start)) / 1000)));
      return json(res, 429, { error: 'RATE_LIMITED' });
    }
    if (!['POST', 'GET', 'DELETE'].includes(req.method || '')) {
      res.setHeader('Allow', 'POST,GET,DELETE,OPTIONS');
      return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    }
    if (active >= 8) { res.setHeader('Retry-After', '1'); return json(res, 503, { error: 'BUSY' }); }
    let parsed: unknown;
    if (req.method === 'POST') {
      try { parsed = await body(req); }
      catch (error) {
        const code = error instanceof Error ? error.message : '';
        return json(res, code === 'TOO_LARGE' ? 413 : code === 'CONTENT_TYPE' ? 415 : 400, { error: 'INVALID_REQUEST_BODY' });
      }
    }
    active++;
    const server = createMcpServer(service);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch {
      if (!res.headersSent) json(res, 500, { error: 'MCP_REQUEST_FAILED' });
      else if (!res.writableEnded) res.end();
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
      active--;
    }
  });
  http.requestTimeout = 30000;
  http.headersTimeout = 10000;
  http.keepAliveTimeout = 5000;
  return http;
}
