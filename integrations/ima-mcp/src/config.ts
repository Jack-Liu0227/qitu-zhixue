import { z } from 'zod';
import { config as dotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

export function loadEnvironment(): void {
  dotenv({ path: process.env.IMA_ENV_FILE || fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
}

export interface Config {
  clientId: string;
  apiKey: string;
  knowledgeBaseIds: string[];
  host: string;
  port: number;
  tokens: Record<string, string>;
  allowedHosts: string[];
  allowedOrigins: string[];
  timeoutMs: number;
  maxFileBytes: number;
}

const credential = z.string().trim().min(1).max(4096).regex(/^[^\r\n]+$/);
const id = z.string().trim().min(1).max(512).regex(/^[^\s,]+$/);
export function credentials(env: NodeJS.ProcessEnv) {
  const parsed = z.object({ clientId: credential, apiKey: credential }).safeParse({
    clientId: env.IMA_OPENAPI_CLIENTID || env.IMA_CLIENT_ID,
    apiKey: env.IMA_OPENAPI_APIKEY || env.IMA_API_KEY,
  });
  if (!parsed.success) throw new Error('请在 .env 配置 IMA_OPENAPI_CLIENTID 和 IMA_OPENAPI_APIKEY。');
  return parsed.data;
}

const csv = (value: string | undefined) => (value || '').split(',').map(s => s.trim()).filter(Boolean);
function numberSetting(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error('端口、超时或文件大小配置不合法。');
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv, stdio = false): Config {
  const auth = credentials(env);
  const knowledgeBaseIds = [...new Set(csv(env.IMA_KNOWLEDGE_BASE_IDS))];
  if (!knowledgeBaseIds.length || !z.array(id).max(100).safeParse(knowledgeBaseIds).success) {
    throw new Error('请配置 IMA_KNOWLEDGE_BASE_IDS；可先运行 npm run discover 查询。');
  }
  const port = numberSetting(env.PORT, 8787, 1, 65535);
  const host = env.HOST || '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0', '::1', '::'].includes(host)) throw new Error('HOST 必须为明确的监听 IP。');
  let tokens: Record<string, string> = {};
  if (env.MCP_CLIENT_TOKENS) {
    try {
      tokens = z.record(z.string().min(1).max(100), z.string().min(32).max(512).regex(/^[\x21-\x7e]+$/))
        .parse(JSON.parse(env.MCP_CLIENT_TOKENS));
    } catch { throw new Error('MCP_CLIENT_TOKENS 必须为 JSON 对象，各 Agent 的 token 至少 32 字符。'); }
  }
  if (!stdio && !Object.keys(tokens).length) throw new Error('HTTP 模式必须配置 MCP_CLIENT_TOKENS。');
  if (new Set(Object.values(tokens)).size !== Object.keys(tokens).length) throw new Error('各 Agent 应使用不同 token。');
  const allowedHosts = csv(env.MCP_ALLOWED_HOSTS).map(s => s.toLowerCase());
  if (!allowedHosts.length) {
    if (host === '0.0.0.0' || host === '::') throw new Error('对外监听时必须显式配置 MCP_ALLOWED_HOSTS。');
    allowedHosts.push(`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`);
  }
  const allowedOrigins = csv(env.MCP_ALLOWED_ORIGINS);
  for (const origin of allowedOrigins) {
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new Error('MCP_ALLOWED_ORIGINS 不是有效的 Origin。'); }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('MCP_ALLOWED_ORIGINS 必须为完整 Origin，不含路径或通配符。');
    }
  }
  return {
    ...auth, knowledgeBaseIds, host, port, tokens, allowedHosts, allowedOrigins,
    timeoutMs: numberSetting(env.IMA_TIMEOUT_MS, 20000, 100, 120000),
    maxFileBytes: numberSetting(env.IMA_MAX_FILE_MB, 50, 1, 200) * 1024 * 1024,
  };
}
