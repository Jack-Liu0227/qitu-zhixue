import { createModelRuntime, isModelRuntimeError, type ModelRuntime } from '@qitu/model-runtime';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { BusinessUsage } from '../business/business.usage';
import { ModelGatewayError, type ModelGatewayErrorCode } from './model-gateway.errors';
import {
  type ModelCompletionRequest,
  type ModelCompletionResult,
  type ModelRuntimeModelSelection,
  type ModelRuntimeResolver,
  type ModelStreamEvent,
} from './model-gateway.types';

/**
 * Nest 注入令牌：模块用 `useExisting` 把 `ModelRegistryService` 绑到这里，
 * `ModelGateway` 只依赖接口，不直接 import 具体服务。单测可直接构造桩。
 */
export const MODEL_RUNTIME_RESOLVER = Symbol('MODEL_RUNTIME_RESOLVER');

/** The server-owned model registry is resolved only by the shared native runtime. */
@Injectable()
export class ModelGateway {
  private readonly runtime: ModelRuntime;

  constructor(@Inject(MODEL_RUNTIME_RESOLVER) private readonly resolver: ModelRuntimeResolver, @Optional() private readonly usage?: BusinessUsage) {
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
    try {
      const result = await this.runtime.complete({ usageId, ...request, ...selection });
      await this.usage?.record(usageId, result);
      return result;
    } catch (error) {
      if (isModelRuntimeError(error)) {
        throw new ModelGatewayError(error.code as ModelGatewayErrorCode, error.message, {
          retryable: error.retryable,
          upstreamStatus: error.upstreamStatus,
          responseDiagnostic: error.responseDiagnostic,
        });
      }
      throw error;
    }
  }

  /**
   * 流式补全生成器。
   */
  async *stream(
    usageId: string,
    request: ModelCompletionRequest,
    selection?: ModelRuntimeModelSelection,
  ): AsyncGenerator<ModelStreamEvent> {
    for await (const event of this.runtime.stream({ usageId, ...request, ...selection })) {
      if (event.type === 'text-delta') yield { type: 'text-delta', text: event.text };
      else if (event.type === 'done') {
        await this.usage?.record(usageId, event.result);
        yield { type: 'done', result: event.result };
      }
      else if (event.type === 'error') yield event;
    }
  }
}
