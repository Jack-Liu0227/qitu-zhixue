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

export class ModelFetchError extends Error {
  /**
   * 上游返回的 HTTP 状态码；网络错误、超时或 SSRF 拒绝时为 `null`。
   * 连接测试据此区分「到不了 / 被拒」与「到了但鉴权失败」。
   */
  readonly httpStatus: number | null;

  constructor(message: string, httpStatus: number | null = null) {
    super(message);
    this.name = 'ModelFetchError';
    this.httpStatus = httpStatus;
  }
}

/**
 * 允许被服务端主动请求的地址校验。
 *
 * 这是 **SSRF 防线**：`baseUrl` 由管理员填写，服务端替它发请求，若不加限制，
 * 一个被拿到的管理员账号就能让 API 进程去读云元数据（`169.254.169.254`）
 * 或内网服务。这里挡掉链路本地与元数据地址；生产环境应再叠一层出站白名单。
 */
export function assertFetchable(rawBaseUrl: string): URL {
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
 * 在 `baseUrl` 之后拼接协议路径（如 `/chat/completions`）。
 *
 * 约定与 `pi-ai` 一致：`baseUrl` 是**网关根**（例如
 * `https://newapi.example.com`），协议层自己补 `/v1/...`。
 * 若管理员已经把 `/v1` 写进 `baseUrl`，就不再重复补。
 */
export function protocolUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const withVersion = /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
  return `${withVersion}${path}`;
}

/** 拼出模型列表地址（`GET /v1/models`）。 */
function modelsUrl(baseUrl: string): string {
  return protocolUrl(baseUrl, '/models');
}

/**
 * 按协议构造供应商鉴权头。
 *
 * - `anthropic-messages`：`x-api-key` + `anthropic-version`，忽略 `authHeader`；
 * - 其余协议：`authHeader=true` 时用 `Authorization: Bearer`，否则不带鉴权头。
 * 这里是**唯一**一处鉴权头拼装，`/models` 发现与运行时 completion 共用，
 * 避免两份实现漂移。
 */
export function providerAuthHeaders(
  api: ModelApi,
  apiKey: string,
  authHeader: boolean,
): Record<string, string> {
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
      headers: { accept: 'application/json', ...providerAuthHeaders(input.api, input.apiKey, input.authHeader) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // 只带原因，不带请求头（里面有密钥）。
    const reason = error instanceof Error ? error.message : '未知网络错误';
    throw new ModelFetchError(`拉取模型列表失败：${reason}`);
  }

  if (!response.ok) {
    throw new ModelFetchError(`上游返回 HTTP ${response.status}`, response.status);
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

/**
 * 受 SSRF / 超时 / 响应体上限保护的 `/models` 探测结果。
 *
 * 与 `fetchProviderModels` **共用同一套实现**（地址校验、鉴权头、超时、大小上限），
 * 只是把失败收敛成结果对象，供连接测试返回 `ok=false`，而不是让接口 5xx。
 * 这里仍然**只探测配置 / 鉴权 / 模型发现**，不发起对话推理。
 */
export interface ProviderModelsProbe {
  ok: boolean;
  /** 上游 HTTP 状态码；网络错误、超时或 SSRF 拒绝时为 `null`。 */
  status: number | null;
  /** 成功解析到的模型；失败时为空数组。 */
  models: ModelDescriptor[];
  /** 已脱敏的错误说明；成功时为 `null`。**绝不含密钥或原始响应体**。 */
  error: string | null;
}

/**
 * 连接测试用的最小探测：调用现有 fetcher，永不抛异常。
 *
 * 失败原因来自 `ModelFetchError`，本身已不含请求头与响应体；调用方仍需把
 * 已知密钥再脱敏一遍（见 `connection-test.ts` 的 `redactConnectionError`），作为纵深防御。
 */
export async function probeProviderModels(
  input: FetchModelsInput,
): Promise<ProviderModelsProbe> {
  try {
    const models = await fetchProviderModels(input);
    return { ok: true, status: 200, models, error: null };
  } catch (error) {
    if (error instanceof ModelFetchError) {
      return { ok: false, status: error.httpStatus, models: [], error: error.message };
    }
    return { ok: false, status: null, models: [], error: '探测上游模型列表失败' };
  }
}
