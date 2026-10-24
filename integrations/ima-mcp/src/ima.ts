export type JsonObject = Record<string, unknown>;
export interface ImaApi { call(path: string, body: JsonObject): Promise<JsonObject> }

export class ServiceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export class ImaClient implements ImaApi {
  constructor(
    private readonly config: { clientId: string; apiKey: string; timeoutMs: number },
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async call(path: string, body: JsonObject): Promise<JsonObject> {
    if (!/^openapi\/(wiki\/v1\/(get_knowledge_base|get_knowledge_list|search_knowledge|search_knowledge_base|get_media_info)|note\/v1\/get_doc_content)$/.test(path)) {
      throw new ServiceError('UNSUPPORTED_OPERATION', '只支持知识库读取接口。');
    }
    const started = Date.now();
    let response: Response;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await this.fetcher(`https://ima.qq.com/${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'ima-openapi-clientid': this.config.clientId,
            'ima-openapi-apikey': this.config.apiKey,
          },
          body: JSON.stringify(body),
          redirect: 'error',
          signal: AbortSignal.timeout(Math.max(1, this.config.timeoutMs - (Date.now() - started))),
        });
      } catch {
        throw new ServiceError('IMA_UNAVAILABLE', 'ima 请求失败或超时，请稍后重试。');
      }
      if (!response.ok) {
        await response.body?.cancel();
        // Only operation/status are diagnostic; never log query, KB IDs, credentials or response bodies.
        console.warn(JSON.stringify({ event: 'ima.http.failed', operation: path.split('/').at(-1), status: response.status, attempt }));
        const retryable = [429, 502, 503, 504].includes(response.status);
        if (attempt === 0 && retryable && Date.now() - started + 300 < this.config.timeoutMs) {
          await new Promise(resolve => setTimeout(resolve, 250));
          continue;
        }
        throw new ServiceError([401, 403].includes(response.status) ? 'IMA_ACCESS_DENIED' : 'IMA_HTTP_ERROR', `ima 返回 HTTP ${response.status}。`);
      }
      break;
    }
    let payload: JsonObject;
    try {
      const buffer = await readLimited(response, 4 * 1024 * 1024);
      payload = JSON.parse(buffer.toString('utf8')) as JsonObject;
    } catch { throw new ServiceError('IMA_INVALID_RESPONSE', 'ima 返回的数据格式或大小异常。'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.code !== 'number') {
      throw new ServiceError('IMA_INVALID_RESPONSE', 'ima 返回的数据格式异常。');
    }
    if (payload.code !== 0) {
      // Business messages may contain echoed inputs or credentials; keep secrets out of tool results.
      const msg = typeof payload.msg === 'string' ? payload.msg.slice(0, 500) : '请求未成功';
      const safe = [this.config.clientId, this.config.apiKey].reduce((s, secret) => s.split(secret).join('[redacted]'), msg);
      throw new ServiceError(`IMA_${payload.code}`, `ima：${safe}`);
    }
    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
      throw new ServiceError('IMA_INVALID_RESPONSE', 'ima 返回的数据缺少 data。');
    }
    return payload.data as JsonObject;
  }
}

export async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const length = Number(response.headers.get('content-length'));
  if (length > maxBytes) {
    await response.body?.cancel();
    throw new ServiceError('FILE_TOO_LARGE', '资料超过服务配置的读取大小上限。');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ServiceError('EMPTY_RESPONSE', '资料响应为空。');
  const buffers: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ServiceError('FILE_TOO_LARGE', '资料超过服务配置的读取大小上限。');
      buffers.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(buffers, size);
}

export function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}
export function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
