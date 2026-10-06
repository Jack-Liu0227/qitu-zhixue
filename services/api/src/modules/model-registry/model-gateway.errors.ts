/**
 * 运行时模型网关（ModelGateway）的稳定错误码与错误类型。
 *
 * 为什么单独一个文件：`ModelGateway`、三种协议适配器、`ModelRegistryService`
 * 都要用同一套错误码，若定义在 `model-gateway.ts` 里会和适配器形成运行时循环
 * 依赖（适配器 import 错误类，网关 import 适配器）。这里只放类型与错误类，
 * 放在依赖图的最底层。
 *
 * 安全约束：错误消息**绝不**包含明文密钥、带凭证的 URL 或上游原始响应体。
 * 上游 HTTP 失败只暴露状态码，正文一律丢弃。
 */

/** 网关不可用 / 调用失败的稳定错误码。业务方据此决定重试或降级，不要解析文案。 */
export type ModelGatewayErrorCode =
  /** usageId 不在注册表声明的用途里（调用方写错了）。 */
  | 'MODEL_USAGE_UNKNOWN'
  /** 用途没有直接绑定，也没有可回落的绑定。 */
  | 'MODEL_USAGE_NOT_BOUND'
  /** 绑定的供应商不存在（配置被并发删除或数据不一致）。 */
  | 'MODEL_PROVIDER_NOT_FOUND'
  /** 供应商被停用。 */
  | 'MODEL_PROVIDER_DISABLED'
  /** 供应商没有网关地址。 */
  | 'MODEL_BASE_URL_MISSING'
  /** 绑定的模型在供应商下不存在。 */
  | 'MODEL_NOT_FOUND'
  /** 模型被停用。 */
  | 'MODEL_DISABLED'
  /** 供应商没有可用凭证，或已存密文但无法解密。 */
  | 'MODEL_CREDENTIAL_MISSING'
  /** 调用方传入的消息结构非法。 */
  | 'MODEL_REQUEST_INVALID'
  /** 网络层失败（DNS / 连接被拒 / TLS 等）。 */
  | 'MODEL_TRANSPORT_ERROR'
  /** 超过超时时间。 */
  | 'MODEL_REQUEST_TIMEOUT'
  /** 调用方通过 AbortSignal 主动取消。 */
  | 'MODEL_REQUEST_ABORTED'
  /** 上游返回非 2xx。 */
  | 'MODEL_UPSTREAM_HTTP_ERROR'
  /** 上游响应不是期望的 JSON 结构 / 无法读取。 */
  | 'MODEL_RESPONSE_INVALID'
  /** 上游结构合法但没有文本内容。 */
  | 'MODEL_EMPTY_RESPONSE'
  /** pi-ai 流式生命周期失败。 */
  | 'MODEL_STREAM_ERROR'
  /** 流式接口尚未接线（旧实现兼容错误）。 */
  | 'MODEL_STREAM_NOT_IMPLEMENTED';

export interface ModelGatewayErrorOptions {
  /** 上游 HTTP 状态码；非 HTTP 失败时为 `null`。 */
  upstreamStatus?: number | null;
  /** 调用方是否可以在稍后重试（超时、网络错误、429、5xx）。 */
  retryable?: boolean;
}

/**
 * 模型网关的统一错误。
 *
 * - `code` 是稳定机器码，业务方据此分支，不要解析 `message`；
 * - `message` 面向人类，已保证不含密钥；
 * - `retryable` 供上层决定退避重试还是直接降级为「功能不可用」。
 */
export class ModelGatewayError extends Error {
  readonly code: ModelGatewayErrorCode;
  readonly upstreamStatus: number | null;
  readonly retryable: boolean;

  constructor(
    code: ModelGatewayErrorCode,
    message: string,
    options: ModelGatewayErrorOptions = {},
  ) {
    super(message);
    this.name = 'ModelGatewayError';
    this.code = code;
    this.upstreamStatus = options.upstreamStatus ?? null;
    this.retryable = options.retryable ?? false;
  }
}

/** 判断任意错误是否为 `ModelGatewayError`（跨 realm 安全）。 */
export function isModelGatewayError(error: unknown): error is ModelGatewayError {
  return error instanceof ModelGatewayError;
}
