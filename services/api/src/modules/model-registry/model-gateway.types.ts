import type { ModelApi, ModelModality } from '@qitu/contracts';

/**
 * Runtime ModelGateway 的统一输入 / 输出 / 解析目标类型。
 *
 * 设计目标：**协议差异只存在于适配器内部**。业务调用方（后续的 AI搭档、成长、
 * 知识库）只看到「消息数组进、文本出」，永远不感知 Chat Completions /
 * Responses / Anthropic Messages 的请求体与响应结构差异，也拿不到密钥。
 */

/** 统一消息角色。三种协议都归一到这三类。 */
export type ModelChatRole = 'system' | 'user' | 'assistant';

export interface ModelChatMessage {
  role: ModelChatRole;
  /** 纯文本内容。本任务只统一文本，模态消息在后续任务扩展。 */
  content: string;
}

/** 统一的非流式补全请求。 */
export interface ModelCompletionRequest {
  messages: readonly ModelChatMessage[];
  /** 采样温度；不传时用上游默认值，不替调用方臆造。 */
  temperature?: number;
  /**
   * 单次回复的最大生成 token。
   * 不传时不设置（Anthropic 协议必须提供，适配器会用保守默认值兜底）。
   */
  maxTokens?: number;
  /** 单次调用超时（毫秒）；缺省 {@link DEFAULT_COMPLETION_TIMEOUT_MS}。 */
  timeoutMs?: number;
  /** 调用方取消信号；与超时信号合并，任一触发即中止。 */
  signal?: AbortSignal;
}

/** 统一的 token 用量；上游没给时字段为 `null`。 */
export interface ModelTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

/** 统一的非流式补全结果。**刻意不含任何凭证字段。** */
export interface ModelCompletionResult {
  providerId: string;
  modelId: string;
  api: ModelApi;
  /** 拼接后的纯文本输出。 */
  text: string;
  /** 上游结束原因；不可用时为 `null`。 */
  finishReason: string | null;
  /** token 用量；上游未返回时为 `null`。 */
  usage: ModelTokenUsage | null;
}

/**
 * 流式事件（seam）。
 *
 * 本任务只交付非流式 `complete`；`stream` 已按此事件形状预留，协议适配器以后
 * 负责把各自的 `delta` / `content_block_delta` 映射到这里，调用方无需感知协议。
 */
export type ModelStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'done'; result: ModelCompletionResult }
  | { type: 'error'; code: string; message: string; retryable: boolean };

/**
 * 运行时可调用的模型目标。
 *
 * ⚠️ `credential` 是**解密后的明文**：只允许 `ModelGateway` 用来构造鉴权头，
 * 绝不能出现在控制器返回值、日志、错误或审计里。
 */
export interface ModelRuntimeTarget {
  providerId: string;
  providerName: string;
  modelId: string;
  baseUrl: string;
  api: ModelApi;
  authHeader: boolean;
  /** Declared capabilities of the resolved model; credentials remain private. */
  input?: ModelModality[];
  output?: ModelModality[];
  credential: string;
}

export interface ModelRuntimeModelSelection {
  providerId: string;
  modelId: string;
}

/**
 * `ModelGateway` 依赖的最小解析接口。
 *
 * `ModelRegistryService` 实现它；单测可用桩替换，从而在不启动 Nest / 数据库的
 * 情况下验证三种协议适配。
 */
export interface ModelRuntimeResolver {
  /**
   * 把 `usageId` 解析为运行时目标（含解密后的凭证）。
   *
   * 没有 binding / provider / model / secret 时抛
   * {@link ModelGatewayError}（对应 `MODEL_USAGE_NOT_BOUND` 等错误码），
   * 让业务方把功能显式标记为不可用，而不是静默回落到硬编码默认模型。
   */
  resolveRuntimeTarget(usageId: string): ModelRuntimeTarget;
  resolveRuntimeTargetByModel?(selection: ModelRuntimeModelSelection): ModelRuntimeTarget;
}

/** 默认单次补全超时。比 `/models` 发现（12s）长，给生成留足时间。 */
export const DEFAULT_COMPLETION_TIMEOUT_MS = 30_000;

/** 超时上限，避免调用方传入无限等待。 */
export const MAX_COMPLETION_TIMEOUT_MS = 120_000;

/** 上游响应体上限，防止超大 body 拖垮进程。 */
export const MAX_COMPLETION_RESPONSE_BYTES = 2 * 1024 * 1024;
