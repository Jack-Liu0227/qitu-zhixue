import { createModelRuntime, isModelRuntimeError, type ModelRuntime } from '@qitu/model-runtime';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { adapterFor } from './model-gateway.adapters';
import { ModelGatewayError, type ModelGatewayErrorCode } from './model-gateway.errors';
import {
  DEFAULT_COMPLETION_TIMEOUT_MS,
  MAX_COMPLETION_RESPONSE_BYTES,
  MAX_COMPLETION_TIMEOUT_MS,
  type ModelCompletionRequest,
  type ModelCompletionResult,
  type ModelRuntimeModelSelection,
  type ModelRuntimeResolver,
  type ModelRuntimeTarget,
  type ModelStreamEvent,
} from './model-gateway.types';

/**
 * Nest 注入令牌：模块用 `useExisting` 把 `ModelRegistryService` 绑到这里，
 * `ModelGateway` 只依赖接口，不直接 import 具体服务。单测可直接构造桩。
 */
export const MODEL_RUNTIME_RESOLVER = Symbol('MODEL_RUNTIME_RESOLVER');

/**
 * Runtime `ModelGateway`：业务模块真正调用 LLM 的**唯一**入口。
 *
 * 分层：
 * ```
 *   业务（AI搭档 / 成长 / 知识库）   ← 只依赖本类，拿不到密钥
 *        │  complete(usageId, { messages })
 *        ▼
 *   ModelGateway（resolve + 超时 + 取消 + 脱敏 + 归一化）
 *        │  resolveRuntimeTarget(usageId)  → 含明文凭证（仅本类可见）
 *        ▼
 *   ProviderAdapter（openai-completions / openai-responses / anthropic-messages）
 * ```
 *
 * 安全边界：
 * - 明文凭证只在本类内用于构造鉴权头，**绝不**进入返回值、日志或错误；
 * - 上游 HTTP 失败只暴露状态码，正文丢弃，避免夹带密钥 / 用户内容；
 * - 错误统一为 {@link ModelGatewayError}，业务方按 `code` 分支。
 *
 * 本任务只交付**非流式** `complete`；`stream` 已预留事件形状但**未接线**，
 * 并在调用时抛 `MODEL_STREAM_NOT_IMPLEMENTED`，绝不假装支持流式。也**尚未**
 * 接入 AI搭档 / 成长 / 知识库任何业务（见 `docs/admin/model-registry.md` §8）。
 */
@Injectable()
export class ModelGateway {
  private readonly logger = new Logger(ModelGateway.name);
  private readonly runtime: ModelRuntime;

  constructor(@Inject(MODEL_RUNTIME_RESOLVER) private readonly resolver: ModelRuntimeResolver) {
    this.runtime = createModelRuntime(resolver);
  }

  /**
   * 按用途发起一次非流式补全。
   *
   * @param usageId 注册表声明的用途 id，如 `tutor.chat`。
   * @param request 统一消息与可选取样参数；协议差异由内部适配器吸收。
   * @throws {ModelGatewayError} 用途未绑定 / 供应商或模型不可用 / 无凭证 /
   *   超时 / 被取消 / 上游 HTTP 失败 / 响应不可解析或为空。
   */
  async complete(
    usageId: string,
    request: ModelCompletionRequest,
    selection?: ModelRuntimeModelSelection,
  ): Promise<ModelCompletionResult> {
    if (runtimeEngine() === 'qitu') return this.completeWithQituRuntime(usageId, request, selection);
    const target = selection
      ? this.resolveSelectedTarget(selection)
      : this.resolver.resolveRuntimeTarget(usageId);
    return this.execute(usageId, target, request);
  }

  /**
   * 流式 seam（**尚未接线**）。
   *
   * 事件形状见 {@link ModelStreamEvent}：`text-delta` / `done` / `error`。
   * 未来由协议适配器把各自的分片事件映射到这里，调用方无需感知协议。
   * 当前实现直接抛 `MODEL_STREAM_NOT_IMPLEMENTED`，避免让调用方误以为
   * 已支持流式而写出依赖增量的逻辑。
   */
  async *stream(
    usageId: string,
    request: ModelCompletionRequest,
    selection?: ModelRuntimeModelSelection,
  ): AsyncGenerator<ModelStreamEvent> {
    if (runtimeEngine() === 'qitu') {
      for await (const event of this.runtime.stream({ usageId, ...request, ...selection })) {
        if (event.type === 'text-delta') yield { type: 'text-delta', text: event.text };
        else if (event.type === 'done') yield { type: 'done', result: event.result };
        else if (event.type === 'error') yield event;
      }
      return;
    }
    void usageId;
    void request;
    throw new ModelGatewayError(
      'MODEL_STREAM_NOT_IMPLEMENTED',
      '流式模型调用尚未接线；本任务只交付非流式 complete()。',
    );
  }

  private async completeWithQituRuntime(
    usageId: string,
    request: ModelCompletionRequest,
    selection?: ModelRuntimeModelSelection,
  ): Promise<ModelCompletionResult> {
    try {
      return await this.runtime.complete({ usageId, ...request, ...selection });
    } catch (error) {
      if (isModelRuntimeError(error)) {
        throw new ModelGatewayError(error.code as ModelGatewayErrorCode, error.message, {
          retryable: error.retryable,
          upstreamStatus: error.upstreamStatus,
        });
      }
      throw error;
    }
  }

  private resolveSelectedTarget(selection: ModelRuntimeModelSelection): ModelRuntimeTarget {
    if (!this.resolver.resolveRuntimeTargetByModel) {
      throw new ModelGatewayError('MODEL_NOT_FOUND', '当前运行时不支持 Agent 级模型选择');
    }
    return this.resolver.resolveRuntimeTargetByModel(selection);
  }

  private async execute(
    usageId: string,
    target: ModelRuntimeTarget,
    request: ModelCompletionRequest,
  ): Promise<ModelCompletionResult> {
    assertRequest(request);
    const adapter = adapterFor(target.api);
    const built = adapter.build(target, request);
    const timeoutMs = clampTimeout(request.timeoutMs);

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal =
      request.signal !== undefined
        ? AbortSignal.any([request.signal, timeoutSignal])
        : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(built.url, {
        method: 'POST',
        headers: built.headers,
        body: built.body,
        signal,
      });
    } catch (error) {
      throw translateTransportError(error, request.signal, timeoutMs);
    }

    if (!response.ok) {
      // 丢弃响应体：可能夹带上游回显的请求内容。只保留状态码。
      throw new ModelGatewayError(
        'MODEL_UPSTREAM_HTTP_ERROR',
        `模型网关返回 HTTP ${response.status}`,
        {
          upstreamStatus: response.status,
          retryable: response.status === 429 || response.status >= 500,
        },
      );
    }

    const payload = await readJson(response);
    const parsed = adapter.parse(payload);
    if (parsed.text.trim().length === 0) {
      throw new ModelGatewayError('MODEL_EMPTY_RESPONSE', '模型网关返回了空文本');
    }

    // 只记录非敏感元数据；绝不打印 prompt / 凭证 / 输出正文。
    this.logger.log(
      `模型调用完成 usage=${usageId} provider=${target.providerId} model=${target.modelId} api=${target.api} 字数=${parsed.text.length}`,
    );

    return {
      providerId: target.providerId,
      modelId: target.modelId,
      api: target.api,
      text: parsed.text,
      finishReason: parsed.finishReason,
      usage: parsed.usage,
    };
  }
}

export function runtimeEngine(): 'qitu' | 'legacy' {
  return process.env.QITU_MODEL_RUNTIME_ENGINE === 'qitu' ? 'qitu' : 'legacy';
}

function assertRequest(request: ModelCompletionRequest): void {
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new ModelGatewayError('MODEL_REQUEST_INVALID', '至少需要一条消息');
  }
  for (const message of request.messages) {
    if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') {
      throw new ModelGatewayError('MODEL_REQUEST_INVALID', `未知的消息角色：${String(message.role)}`);
    }
    if (typeof message.content !== 'string') {
      throw new ModelGatewayError('MODEL_REQUEST_INVALID', '消息内容必须是字符串');
    }
  }
}

/** 把调用方超时收敛到 [1, MAX] 区间；缺省用默认值。 */
function clampTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_COMPLETION_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_COMPLETION_TIMEOUT_MS);
}

/** 读取响应体并解析 JSON，带大小上限，失败信息不含正文。 */
async function readJson(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ModelGatewayError('MODEL_RESPONSE_INVALID', '读取模型网关响应失败', {
      retryable: true,
    });
  }
  if (text.length > MAX_COMPLETION_RESPONSE_BYTES) {
    throw new ModelGatewayError('MODEL_RESPONSE_INVALID', '模型网关响应过大，已中止');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelGatewayError('MODEL_RESPONSE_INVALID', '模型网关响应不是合法 JSON');
  }
}

/**
 * 区分「调用方取消」与「超时」，两者都是 AbortError，但语义与可重试性不同。
 * 消息与 cause 都不带 URL / 请求头，避免泄露凭证。
 */
function translateTransportError(
  error: unknown,
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): ModelGatewayError {
  // 先看调用方信号：只要它已中止，就归因为调用方取消。
  if (callerSignal?.aborted === true) {
    return new ModelGatewayError('MODEL_REQUEST_ABORTED', '模型调用已被调用方取消');
  }
  // 注意：Node 的 `AbortSignal.timeout` 以 `TimeoutError` 中止，而手动
  // `abort()` 是 `AbortError`，两者都要归到超时。
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new ModelGatewayError(
      'MODEL_REQUEST_TIMEOUT',
      `模型调用超时（${timeoutMs}ms）`,
      { retryable: true },
    );
  }
  return new ModelGatewayError('MODEL_TRANSPORT_ERROR', '无法连接模型网关', {
    retryable: true,
  });
}
