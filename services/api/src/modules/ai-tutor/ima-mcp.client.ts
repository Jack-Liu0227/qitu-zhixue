import { createImaScopeGuard, type ImaKnowledgeScope } from './ima-tool-scope';
import { Injectable } from '@nestjs/common';
import type { ModelRuntimeTool } from '@qitu/model-runtime';
import type { TutorAgentMcpDescriptor } from '@qitu/contracts';
import { ImaProjectBoundary, type ImaProjectScope } from './ima-project-scope';

export const IMA_MCP_SERVER_ID = 'ima-knowledge';
export const IMA_READ_TOOLS = [
  'ima_list_knowledge_bases',
  'ima_search_knowledge',
  'ima_list_documents',
  'ima_read_document',
] as const;
const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Server-only stateless Streamable HTTP client. Tool bindings are resolved
 * by the API; each turn has its own protocol state and textbook references. */
@Injectable()
export class ImaMcpClient {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  isBound(servers: readonly TutorAgentMcpDescriptor[]): boolean {
    return servers.some(
      (server) =>
        server.serverId === IMA_MCP_SERVER_ID &&
        server.transport === 'streamable_http' &&
        server.toolIds.length > 0,
    );
  }

  async toolsFor(
    servers: readonly TutorAgentMcpDescriptor[],
    authorize?: (toolId: string) => Promise<boolean>,
    scope?: ImaProjectScope | ImaKnowledgeScope,
  ): Promise<ModelRuntimeTool[]> {
    const projectScope = scope && 'projectId' in scope ? scope : undefined;
    const scopedKnowledge = projectScope ? { knowledgeBaseIds: async () => {
      const current = await projectScope.refreshAllowedKnowledgeBaseIds();
      return projectScope.knowledgeBaseIds.filter(id => current.includes(id));
    } } : scope as ImaKnowledgeScope | undefined;
    const guard = scopedKnowledge ? createImaScopeGuard(scopedKnowledge) : undefined;
    const binding = servers.find(
      (server) => server.serverId === IMA_MCP_SERVER_ID && server.transport === 'streamable_http',
    );
    if (!binding?.toolIds.length) return [];
    const allowedTools = authorize
      ? (
          await Promise.all(binding.toolIds.map(async (id) => ((await authorize(id)) ? id : null)))
        ).filter((id): id is string => id !== null)
      : binding.toolIds;
    if (!allowedTools.length) return [];
    const project = projectScope ? new ImaProjectBoundary(projectScope) : null;
    const endpoint = this.env.QITU_IMA_MCP_URL;
    const token = this.env.QITU_IMA_MCP_TOKEN;
    if (!endpoint || !token || token.length < 32 || /[\r\n]/.test(token))
      throw new Error('IMA_MCP_NOT_CONFIGURED');
    const url = new URL(endpoint);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
      )
    ) {
      throw new Error('IMA_MCP_INVALID_ENDPOINT');
    }
    let sequence = 0;
    let protocol = '2025-03-26';
    const discoverySignal = AbortSignal.timeout(20_000);
    const rpc = async (
      method: string,
      params: Record<string, unknown>,
      notification = false,
      outerSignal?: AbortSignal,
    ): Promise<Record<string, unknown>> => {
      const id = ++sequence;
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([
          AbortSignal.timeout(25_000),
          ...(outerSignal ? [outerSignal] : []),
        ]),
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${token}`,
          'mcp-protocol-version': protocol,
        },
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('IMA_MCP_UNAVAILABLE');
      }
      if (notification) {
        await response.body?.cancel();
        return {};
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('IMA_MCP_INVALID_RESPONSE');
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > MAX_RESPONSE_BYTES) throw new Error('IMA_MCP_RESPONSE_TOO_LARGE');
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel();
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const values: unknown[] = response.headers.get('content-type')?.includes('text/event-stream')
        ? body.split(/\r?\n\r?\n/).flatMap((frame) => {
            const data = frame
              .split(/\r?\n/)
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n');
            return data ? [JSON.parse(data) as unknown] : [];
          })
        : [JSON.parse(body) as unknown];
      const envelope = values.find((value) => record(value) && value.id === id);
      if (!record(envelope) || envelope.error || !record(envelope.result))
        throw new Error('IMA_MCP_PROTOCOL_ERROR');
      return envelope.result;
    };
    const initialized = await rpc(
      'initialize',
      {
        protocolVersion: protocol,
        capabilities: {},
        clientInfo: { name: 'qitu-agent-runtime', version: '1.0.0' },
      },
      false,
      discoverySignal,
    );
    if (typeof initialized.protocolVersion === 'string') protocol = initialized.protocolVersion;
    await rpc('notifications/initialized', {}, true, discoverySignal);
    const definitions: Record<string, unknown>[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const catalog = await rpc('tools/list', cursor ? { cursor } : {}, false, discoverySignal);
      if (!Array.isArray(catalog.tools)) throw new Error('IMA_MCP_INVALID_TOOLS');
      definitions.push(...catalog.tools.filter(record));
      if (definitions.length > 2000) throw new Error('IMA_MCP_CATALOG_TOO_LARGE');
      if (catalog.nextCursor !== undefined && typeof catalog.nextCursor !== 'string')
        throw new Error('IMA_MCP_INVALID_CURSOR');
      cursor = catalog.nextCursor as string | undefined;
      if (cursor) {
        if (cursors.has(cursor) || cursors.size >= 32) throw new Error('IMA_MCP_INVALID_CURSOR');
        cursors.add(cursor);
      }
    } while (cursor);
    return definitions
      .filter((tool, index) => definitions.findIndex((other) => other.name === tool.name) === index)
      .filter(
        (tool) =>
          typeof tool.name === 'string' &&
          IMA_READ_TOOLS.some((name) => name === tool.name) &&
          allowedTools.includes(tool.name) &&
          record(tool.inputSchema),
      )
      .map((tool) => {
        project?.assertDefinition(tool.name as string, tool.inputSchema as Record<string, unknown>);
        return {
        name: tool.name as string,
        description: String(tool.description ?? '').slice(0, 2000),
        inputSchema: tool.inputSchema as Record<string, unknown>,
        execute: async (args, signal) => {
          if (authorize && !(await authorize(tool.name as string)))
            throw new Error('IMA_MCP_ACCESS_REVOKED');
          const kb = project ? await project.before(tool.name as string, args) : guard ? await guard.before(tool.name as string, args) : null;
          if (project && guard && await guard.before(tool.name as string, args) !== kb) throw new Error('IMA_PROJECT_SCOPE_DENIED');
          const result = await rpc(
            'tools/call',
            { name: tool.name, arguments: args },
            false,
            signal,
          );
          const text = Array.isArray(result.content)
            ? result.content
                .filter(record)
                .filter((part) => part.type === 'text' && typeof part.text === 'string')
                .map((part) => part.text as string)
                .join('\n')
            : '';
          if (!text) throw new Error('IMA_MCP_EMPTY_RESULT');
          if (authorize && !(await authorize(tool.name as string))) throw new Error('IMA_MCP_ACCESS_REVOKED');
          if (guard && result.isError) throw new Error('IMA_PROJECT_RETRIEVAL_FAILED');
          const scoped = guard ? await guard.after(tool.name as string, kb, text) : text;
          return { text: project ? await project.after(tool.name as string, kb, scoped, args.document_ref) : scoped.slice(0, 48_000), isError: result.isError === true };
        },
      }; });
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
