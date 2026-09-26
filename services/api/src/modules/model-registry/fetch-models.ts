import type { ModelApi, ModelDescriptor, ModelModality } from '@qitu/contracts';

/**
 * 从供应商的 `baseUrl` 自动拉取模型列表。
 *
 * 对应 `pi-ai` 里 `createProvider({ fetchModels })` 的位置：凭证属于供应商，
 * **能力发现**也从供应商这一层做，而不是让管理员手抄模型名。
 *
 * 上游 `/models` 一般**只返回 id**，不返回模态与上下文长度。因此这里刻意
 * 保守：一律按 `['text']` 声明能力，真实模态由预置模板或管理员明确覆盖
 * （见 `ModelRegistryService.mergeCapabilities`）。宁可少声明，也不要让
 * 「语音输入」在运行时报错。
 */

const TIMEOUT_MS = 12_000;
/** 上限，避免上游返回超大 body 拖垮进程。 */
const MAX_BYTES = 512 * 1024;

export class ModelFetchError extends Error {}

/**
 * 允许被服务端主动请求的地址校验。
 *
 * 这是 **SSRF 防线**：`baseUrl` 由管理员填写，服务端替它发请求，若不加限制，
 * 一个被拿到的管理员账号就能让 API 进程去读云元数据（`169.254.169.254`）
 * 或内网服务。这里挡掉链路本地与元数据地址；生产环境应再叠一层出站白名单。
 */
function assertFetchable(rawBaseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new ModelFetchError('网关地址不是合法的 URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ModelFetchError('网关地址只支持 http:// 或 https://');
  }
  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'metadata.google.internal' ||
    host.startsWith('169.254.') ||
    host === '0.0.0.0' ||
    /^\[?(fc|fd)[0-9a-f]{2}:/.test(host);
  if (blocked) throw new ModelFetchError('拒绝访问链路本地或云元数据地址');
  return url;
}

/**
 * 拼出模型列表地址。
 *
 * 约定与 `pi-ai` 一致：`baseUrl` 是**网关根**（例如
 * `https://newapi.example.com`），协议层自己补 `/v1/...`。
 * 若管理员已经把 `/v1` 写进 `baseUrl`，就不再重复补。
 */
function modelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(trimmed) ? `${trimmed}/models` : `${trimmed}/v1/models`;
}

function authHeaders(api: ModelApi, apiKey: string, authHeader: boolean): Record<string, string> {
  if (api === 'anthropic-messages') {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  }
  return authHeader ? { authorization: `Bearer ${apiKey}` } : {};
}

interface RawModelEntry {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  context_window?: unknown;
  max_tokens?: unknown;
}

function toDescriptors(payload: unknown, api: ModelApi): ModelDescriptor[] {
  // OpenAI 风格 `{ data: [...] }`；少数网关直接返回数组。
  const list: unknown = Array.isArray(payload)
    ? payload
    : payload !== null && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (list === null) throw new ModelFetchError('上游返回的结构里没有模型列表');

  const out: ModelDescriptor[] = [];
  for (const entry of list as RawModelEntry[]) {
    if (entry === null || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' ? entry.id : undefined;
    if (id === undefined || id.length === 0) continue;
    const name =
      typeof entry.name === 'string'
        ? entry.name
        : typeof entry.display_name === 'string'
          ? entry.display_name
          : id;
    out.push({
      id,
      name,
      api,
      // 保守：上游不说模态，就只声明文本能力。
      input: ['text'] satisfies ModelModality[],
      output: ['text'] satisfies ModelModality[],
      contextWindow: typeof entry.context_window === 'number' ? entry.context_window : null,
      maxTokens: typeof entry.max_tokens === 'number' ? entry.max_tokens : null,
      source: 'fetched',
    });
  }
  return out;
}

export interface FetchModelsInput {
  baseUrl: string;
  api: ModelApi;
  apiKey: string;
  authHeader: boolean;
}

export async function fetchProviderModels(input: FetchModelsInput): Promise<ModelDescriptor[]> {
  const url = assertFetchable(input.baseUrl);
  const target = modelsUrl(url.toString());

  let response: Response;
  try {
    response = await fetch(target, {
      method: 'GET',
      headers: { accept: 'application/json', ...authHeaders(input.api, input.apiKey, input.authHeader) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // 只带原因，不带请求头（里面有密钥）。
    const reason = error instanceof Error ? error.message : '未知网络错误';
    throw new ModelFetchError(`拉取模型列表失败：${reason}`);
  }

  if (!response.ok) {
    throw new ModelFetchError(`上游返回 HTTP ${response.status}`);
  }

  const text = await response.text();
  if (text.length > MAX_BYTES) throw new ModelFetchError('上游返回内容过大，已中止');

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ModelFetchError('上游返回的不是 JSON');
  }
  return toDescriptors(payload, input.api);
}
