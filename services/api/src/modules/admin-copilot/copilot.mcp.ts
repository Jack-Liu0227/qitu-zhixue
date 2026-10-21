import { ForbiddenException, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { Readable } from 'node:stream';
import { StreamableMcpClient, type McpHttpTransport } from '@qitu/model-runtime';
import type { CurrentUser } from '@qitu/contracts';
import { CopilotResources } from './copilot.resources';
import { exact, invalid, object, text } from './copilot.protocol';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';

export function publicMcpAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
      a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  return isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:(db8|0):/i.test(address) && !/^2002:/i.test(address);
}

/** HTTPS with DNS validation and address pinning. Redirects and local network access are rejected. */
export function mcpTransport(endpoint: string, credential?: string): McpHttpTransport {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) invalid('MCP 必须使用无凭据 HTTPS 地址');
  if (credential && /[\r\n]/.test(credential)) invalid('MCP 凭据格式无效');
  return async (body, headers, signal) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(row => !publicMcpAddress(row.address))) throw new ForbiddenException('MCP 地址解析到受限制网络');
    const chosen = addresses[0]!;
    return new Promise<Response>((resolve, reject) => {
      const outgoing = request(url, { method: 'POST', signal, family: chosen.family,
        lookup: (_host, _options, callback) => callback(null, chosen.address, chosen.family),
        headers: { ...headers, ...(credential ? { authorization: `Bearer ${credential}` } : {}) },
      }, incoming => {
        if (!incoming.statusCode || incoming.statusCode >= 300) {
          incoming.destroy(); reject(new ServiceUnavailableException('MCP 请求未成功，请检查连接和专用凭据')); return;
        }
        const responseHeaders = new Headers();
        for (const name of ['content-type', 'mcp-session-id']) {
          const value = incoming.headers[name]; if (typeof value === 'string') responseHeaders.set(name, value);
        }
        resolve(new Response(incoming.statusCode === 204 ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
          { status: incoming.statusCode, headers: responseHeaders }));
      });
      outgoing.on('error', () => reject(new ServiceUnavailableException('MCP 网络请求失败或超时')));
      outgoing.end(body);
    });
  };
}

export const COPILOT_MCP_TRANSPORT = Symbol('COPILOT_MCP_TRANSPORT');

@Injectable()
export class CopilotMcp {
  constructor(private readonly resources: CopilotResources, private readonly idempotency: IdempotencyStore,
    @Optional() @Inject(COPILOT_MCP_TRANSPORT) private readonly transportFactory: typeof mcpTransport = mcpTransport) {}

  async snapshot(actor: CurrentUser, id: string) {
    if (actor.role !== 'admin') throw new ForbiddenException('仅管理员可以调用 MCP');
    const source = await this.resources.readMcp(id);
    if (id === 'ima-knowledge') invalid('IMA 保持知识范围专用驱动，不能通过通用 MCP 绕过');
    const credential = process.env[`QITU_MCP_${id.replace(/-/g, '_').toUpperCase()}_TOKEN`] ?? '';
    return { source, digest: teachingValueDigest({ ...source, credentialDigest: createHash('sha256').update(credential).digest('hex') }) };
  }

  private async client(actor: CurrentUser, id: string, discoverAll = false) {
    const { source, digest } = await this.snapshot(actor, id);
    const credential = process.env[`QITU_MCP_${id.replace(/-/g, '_').toUpperCase()}_TOKEN`];
    const client = new StreamableMcpClient(this.transportFactory(text(source.endpointOrigin, 'endpointOrigin', 500), credential));
    const tools = await client.discover(discoverAll ? undefined : source.toolIds);
    if (source.toolIds.some(name => !tools.some(tool => tool.name === name))) throw new ServiceUnavailableException('MCP 已登记工具在远端不存在');
    return { client, tools, digest };
  }

  async probe(actor: CurrentUser, id: string) {
    const { tools, digest } = await this.client(actor, id, true);
    if ((await this.snapshot(actor, id)).digest !== digest) throw new ServiceUnavailableException('MCP 配置在探测期间变化');
    return { ok: true, toolCount: tools.length, tools: tools.slice(0, 50), truncated: tools.length > 50, scope: 'admin_connection', teachingRuntimeEnabled: false };
  }

  async invoke(actor: CurrentUser, input: Record<string, unknown>, key: string) {
    exact(input, ['id', 'toolId', 'arguments']);
    const id = text(input.id, 'id'), toolId = text(input.toolId, 'toolId');
    const args = object(input.arguments);
    const { client, tools, digest } = await this.client(actor, id);
    const definition = tools.find(tool => tool.name === toolId);
    if (!definition) throw new ForbiddenException('MCP 工具不在管理员登记的允许列表');
    // Journal the dispatch BEFORE contacting the remote tool. An uncertain outcome is never resent automatically.
    const scope = `admin.copilot.mcp-dispatch:${actor.id}`;
    const dispatch = await this.idempotency.execute(scope, key, hashIdempotentInput(scope, {}, { id, toolId, args, digest }),
      async () => ({ body: { dispatched: true } }));
    if (dispatch.replayed) throw new ServiceUnavailableException({ code: 'COPILOT_MCP_OUTCOME_UNKNOWN', message: '远端调用已发出且结果未完成持久化，请核对远端状态；不会自动重发' });
    const tool = client.tool(definition, async () => (await this.snapshot(actor, id)).digest === digest);
    const result = await tool.execute(args, AbortSignal.timeout(25_000));
    return { id, toolId, configurationDigest: digest, result, outcome: 'remote_response_received' };
  }
}
