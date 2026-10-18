import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Param, Patch } from '@nestjs/common';
import type {
  AdminModelsResponse,
  ModelConfigPublic,
  ModelRuntimeResponse,
  ModelSlot,
  ModelSlotOption,
  UpdateModelConfigRequest,
} from '@qitu/contracts';
import { requireAnyRole, requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { ModelRegistryService } from '../model-registry/model-registry.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';

const SLOTS = new Set<ModelSlot>(['text', 'live']);

/**
 * 模型配置接口（向后兼容）。
 *
 * 统一收敛至 `ModelRegistryService` 作为唯一事实源：
 * - 读 slots 与 options 时动态解析注册表中的当前用途绑定与已知模型目录；
 * - PATCH slot 时直接写入对应的用途绑定（text -> tutor.chat, live -> tutor.live）；
 * - 运行时摘要直接调用 `registry.getRuntimeSummary()`。
 */
@Controller()
export class ModelConfigController {
  constructor(
    private readonly registry: ModelRegistryService,
    private readonly authService: AuthService,
    private readonly idempotency: IdempotencyStore,
  ) {}

  @Get('admin/models')
  getAdminModels(@Headers('cookie') cookieHeader: string | undefined): { data: AdminModelsResponse } {
    requireRole(this.authService, cookieHeader, 'admin', '模型配置仅向管理员开放');
    return { data: this.getAdminModelsData() };
  }

  @Patch('admin/models/:slot')
  async updateModel(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('slot') slot: string,
    @Body() body: UpdateModelConfigRequest,
  ): Promise<{ data: ModelConfigPublic }> {
    const admin = requireRole(this.authService, cookieHeader, 'admin', '模型配置仅向管理员开放');
    if (!SLOTS.has(slot as ModelSlot)) {
      throw new ForbiddenException('未知的模型插槽');
    }
    if (!idempotencyKey?.trim() || idempotencyKey.length > 160) throw new BadRequestException('Idempotency-Key 必填');
    const scope = `model-config:${slot}`;
    const input = sanitiseBody(body);
    const usageId = slot === 'live' ? 'tutor.live' : 'tutor.chat';

    const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, { ...input }, {}), async () => {
      if (input.provider !== undefined && input.modelId !== undefined) {
        await this.registry.bindUsage(usageId, { providerId: input.provider, modelId: input.modelId }, admin.id);
      }
      return { status: 200, body: this.resolveSlotPublic(slot as ModelSlot) };
    });
    return { data: result.body };
  }

  /** 学生端 / 家长端 / 班主任端用来显示「当前跑的是哪个模型、Live 能不能用」。 */
  @Get('models/runtime')
  getRuntime(@Headers('cookie') cookieHeader: string | undefined): { data: ModelRuntimeResponse } {
    requireAnyRole(this.authService, cookieHeader);
    return { data: this.registry.getRuntimeSummary() };
  }

  private resolveSlotPublic(slot: ModelSlot): ModelConfigPublic {
    const usageId = slot === 'live' ? 'tutor.live' : 'tutor.chat';
    const bound = this.registry.resolve(usageId);
    if (!bound) {
      return {
        slot,
        provider: '',
        modelId: '',
        baseUrl: null,
        configured: false,
        keyFingerprint: null,
        updatedAt: null,
        updatedBy: null,
      };
    }
    const providers = this.registry.listProviders().providers;
    const provider = providers.find((p) => p.id === bound.providerId);
    return {
      slot,
      provider: bound.providerId,
      modelId: bound.modelId,
      baseUrl: provider?.baseUrl ?? null,
      configured: provider?.auth.configured ?? false,
      keyFingerprint: provider?.auth.keyFingerprint ?? null,
      updatedAt: provider?.updatedAt ?? null,
      updatedBy: provider?.updatedBy ?? null,
    };
  }

  private getAdminModelsData(): AdminModelsResponse {
    const slots: ModelConfigPublic[] = [
      this.resolveSlotPublic('text'),
      this.resolveSlotPublic('live'),
    ];

    const providers = this.registry.listProviders().providers;
    const options: ModelSlotOption[] = [];

    for (const provider of providers) {
      if (!provider.enabled) continue;
      for (const model of provider.models) {
        const isAudio = model.input.includes('audio') || model.output.includes('audio');
        options.push({
          provider: provider.id,
          modelId: model.id,
          label: `${provider.name} · ${model.name || model.id}`,
          slot: isAudio ? 'live' : 'text',
          requiresApiKey: true,
          supportsInput: model.input.includes('audio') ? ['text', 'voice'] : ['text'],
          supportsOutput: model.output.includes('audio') ? ['text', 'voice'] : ['text'],
        });
      }
    }

    return { slots, options };
  }
}

/**
 * 只挑出契约里声明的字段，避免调用方塞进 `slot` / `updatedAt` 之类的
 * 服务端字段来污染状态。
 */
function sanitiseBody(body: UpdateModelConfigRequest | undefined): UpdateModelConfigRequest {
  if (body === undefined || body === null) return {};
  const out: UpdateModelConfigRequest = {};
  if (typeof body.provider === 'string') out.provider = body.provider;
  if (typeof body.modelId === 'string') out.modelId = body.modelId;
  if (typeof body.baseUrl === 'string' || body.baseUrl === null) out.baseUrl = body.baseUrl;
  if (typeof body.apiKey === 'string') out.apiKey = body.apiKey;
  return out;
}
