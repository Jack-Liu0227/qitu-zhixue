import { Compile } from 'typebox/compile';
import type { ModelRuntimeTool } from './runtime.js';

export interface McpHttpTransport {
  (body: string, headers: Record<string, string>, signal: AbortSignal): Promise<Response>;
}
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Server SDK adapter. The host owns transport, credentials, allowlists and per-call authorization. */
export class StreamableMcpClient {
  private sequence = 0;
  private protocol = '2025-06-18';
  private session: string | undefined;
  constructor(private readonly transport: McpHttpTransport) {}

  private async rpc(method: string, params: Record<string, unknown>, signal: AbortSignal, notification = false): Promise<Record<string, unknown>> {
    const id = ++this.sequence;
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      'mcp-protocol-version': this.protocol };
    if (this.session) headers['mcp-session-id'] = this.session;
    const response = await this.transport(JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }), headers,
      AbortSignal.any([signal, AbortSignal.timeout(25_000)]));
    if (!response.ok) { await response.body?.cancel(); throw new Error('MCP_HTTP_FAILED'); }
    const session = response.headers.get('mcp-session-id');
    if (session) {
      if (!/^[\x21-\x7e]{1,256}$/.test(session) || this.session && session !== this.session) {
        await response.body?.cancel(); throw new Error('MCP_SESSION_INVALID');
      }
      this.session = session;
    }
    if (notification) { await response.body?.cancel(); return {}; }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('MCP_RESPONSE_INVALID');
    const sse = response.headers.get('content-type')?.includes('text/event-stream');
    if (!sse && !response.headers.get('content-type')?.includes('application/json')) {
      await reader.cancel(); throw new Error('MCP_CONTENT_TYPE_INVALID');
    }
    const decoder = new TextDecoder();
    let body = '', bytes = 0;
    const result = (envelope: unknown) => {
      if (!record(envelope) || envelope.id !== id) return null;
      if (envelope.jsonrpc !== '2.0' || envelope.error || !record(envelope.result)) throw new Error('MCP_PROTOCOL_ERROR');
      return envelope.result;
    };
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 1024 * 1024) throw new Error('MCP_RESPONSE_TOO_LARGE');
        body += decoder.decode(next.value, { stream: true });
        if (sse) {
          const frames = body.split(/\r?\n\r?\n/);
          body = frames.pop() ?? '';
          for (const frame of frames) {
            const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (data) { const value = result(JSON.parse(data)); if (value) return value; }
          }
        }
      }
      body += decoder.decode();
      if (!sse) { const value = result(JSON.parse(body)); if (value) return value; }
      throw new Error('MCP_RESPONSE_INVALID');
    } finally { await reader.cancel().catch(() => undefined); }
  }

  async discover(allowedTools?: readonly string[], signal = AbortSignal.timeout(30_000)): Promise<McpToolDefinition[]> {
    const initialized = await this.rpc('initialize', { protocolVersion: this.protocol, capabilities: {},
      clientInfo: { name: 'qitu-model-runtime', version: '1.0.0' } }, signal);
    if (!['2025-03-26', '2025-06-18', '2025-11-25'].includes(String(initialized.protocolVersion)) || !record(initialized.capabilities) || !record(initialized.capabilities.tools)) {
      throw new Error('MCP_INITIALIZE_INVALID');
    }
    this.protocol = String(initialized.protocolVersion);
    await this.rpc('notifications/initialized', {}, signal, true);
    const definitions: McpToolDefinition[] = [];
    const names = new Set<string>(), cursors = new Set<string>();
    let cursor: string | undefined, total = 0;
    do {
      const catalog = await this.rpc('tools/list', cursor ? { cursor } : {}, signal);
      if (!Array.isArray(catalog.tools) || (total += catalog.tools.length) > 1000) throw new Error('MCP_CATALOG_INVALID');
      for (const tool of catalog.tools) {
        if (!record(tool) || typeof tool.name !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(tool.name) || names.has(tool.name)) throw new Error('MCP_TOOL_INVALID');
        names.add(tool.name);
        if (allowedTools && !allowedTools.includes(tool.name)) continue;
        if (!record(tool.inputSchema) || tool.inputSchema.type !== 'object' || JSON.stringify(tool.inputSchema).length > 32_768) throw new Error('MCP_TOOL_SCHEMA_INVALID');
        Compile(tool.inputSchema);
        definitions.push({ name: tool.name, description: String(tool.description ?? '').slice(0, 2000), inputSchema: tool.inputSchema });
      }
      if (catalog.nextCursor !== undefined && typeof catalog.nextCursor !== 'string') throw new Error('MCP_CURSOR_INVALID');
      cursor = catalog.nextCursor as string | undefined;
      if (cursor) {
        if (cursor.length > 1000 || cursors.has(cursor) || cursors.size >= 16) throw new Error('MCP_CURSOR_INVALID');
        cursors.add(cursor);
      }
    } while (cursor);
    if (allowedTools?.some(name => !definitions.some(tool => tool.name === name))) throw new Error('MCP_ALLOWED_TOOL_MISSING');
    return definitions;
  }

  tool(definition: McpToolDefinition, authorize: () => Promise<boolean>): ModelRuntimeTool {
    const validator = Compile(definition.inputSchema);
    return { ...definition, execute: async (args, signal) => {
      if (!await authorize()) throw new Error('MCP_ACCESS_DENIED');
      if (!validator.Check(args)) throw new Error('MCP_ARGUMENTS_INVALID');
      const result = await this.rpc('tools/call', { name: definition.name, arguments: args }, signal ?? AbortSignal.timeout(25_000));
      if (result.isError === true) throw new Error('MCP_TOOL_FAILED');
      const text = Array.isArray(result.content) ? result.content.filter(record).filter(part => part.type === 'text' && typeof part.text === 'string').map(part => String(part.text)).join('\n') : '';
      if (!text && !record(result.structuredContent)) throw new Error('MCP_TOOL_RESULT_INVALID');
      return { text: text.slice(0, 32_000), ...(record(result.structuredContent) ? { data: result.structuredContent } : {}) };
    } };
  }
}
