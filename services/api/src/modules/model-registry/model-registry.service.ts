import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  AdminModelUsagesResponse,
  AdminProvidersResponse,
  BindUsageRequest,
  ModelDescriptor,
  ModelModality,
  ModelUsageBinding,
  ModelUsageSlot,
  ProviderConfigPublic,
  RefreshProviderResponse,
  UpsertProviderRequest,
} from '@qitu/contracts';
import { fetchProviderModels, ModelFetchError } from './fetch-models';
import { PROVIDER_PRESETS } from './provider-presets';

/**
 * 模型供应商注册表 + 「用途 → 模型」绑定。
 *
 * 参照 `pi-ai` 的分层：**凭证属于供应商、能力属于模型、选择属于用途**。
 *
 * 密钥处理与 `ModelConfigService` 保持一致：明文只在写请求里出现一次，落进
 * 进程内 Map，立刻丢弃；对外只给指纹；日志不打印密钥；进程重启即忘。
 * 现在没有密钥库，宁可重启后要求管理员重填，也不把密钥落盘。
 */

interface ProviderState {
  id: string;
  name: string;
  baseUrl: string;
  api: ModelDescriptor['api'];
  authHeader: boolean;
  apiKey: string | null;
  /** 本次进程生命周期内自动拉取到的模型（按 id 索引）。 */
  fetched: Map<string, ModelDescriptor>;
  /** 管理员手填的模型（按 id 索引），优先级高于拉取结果。 */
  manual: Map<string, ModelDescriptor>;
  modelsFetchedAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * 需要模型的具体用途。
 *
 * 拆到「用途」而不是只留一个全局模型，是因为这些调用的诉求不同：
 * 灵感空间只需要快、成长总结需要稳、语音需要能听能说。
 * `fallbackTo` 让管理员只配一个模型也能把产品跑起来。
 */
const USAGES: readonly ModelUsageSlot[] = [
  {
    id: 'tutor.chat',
    agent: 'tutor',
    label: 'AI 搭档 · 对话',
    description: '启发式追问的主体模型，决定教学语气与提示阶梯。',
    requiresOutput: ['text'],
    fallbackTo: null,
  },
  {
    id: 'tutor.live',
    agent: 'tutor',
    label: 'AI 搭档 · 实时语音',
    description: '实时语音通道。需同时具备 audio 输入与输出才能启用「语音入→语音出」。',
    requiresOutput: ['text'],
    fallbackTo: 'tutor.chat',
  },
  {
    id: 'inspiration.recommend',
    agent: 'inspiration',
    label: '灵感空间 · 项目推荐',
    description: '按兴趣与掌握度推荐模板，要求低延迟。',
    requiresOutput: ['text'],
    fallbackTo: 'tutor.chat',
  },
  {
    id: 'curriculum.plan',
    agent: 'curriculum',
    label: '学习计划 · 拆解',
    description: '把模板拆成 4 周 / 8 周路线与每阶段的理论、实践任务。',
    requiresOutput: ['text'],
    fallbackTo: 'tutor.chat',
  },
  {
    id: 'growth.summarize',
    agent: 'growth',
    label: '成长档案 · 总结与建议',
    description: '把证据记录归纳成成长结论。只允许产出「建议」，不得直接写结论。',
    requiresOutput: ['text'],
    fallbackTo: 'tutor.chat',
  },
  {
    id: 'knowledge.embed',
    agent: 'knowledge',
    label: '知识库 · 向量化',
    description: '切片向量化，供检索使用。必须是向量模型，不能填对话模型。',
    requiresOutput: ['text'],
    fallbackTo: null,
  },
];

@Injectable()
export class ModelRegistryService {
  private readonly logger = new Logger(ModelRegistryService.name);
  private readonly providers = new Map<string, ProviderState>();
  private readonly bindings = new Map<string, { providerId: string; modelId: string }>();

  /* ----------------------------- 读 ----------------------------- */

  listProviders(): AdminProvidersResponse {
    return {
      providers: [...this.providers.values()].map((state) => this.toPublic(state)),
      presets: PROVIDER_PRESETS.map((preset) => ({ ...preset })),
    };
  }

  getUsages(): AdminModelUsagesResponse {
    return {
      usages: USAGES.map((usage) => ({ ...usage })),
      bindings: USAGES.map((usage) => this.toBinding(usage)),
    };
  }

  /** 供其他模块取「这个用途实际该用哪个模型」。不要在这里填硬编码默认值。 */
  resolve(usageId: string): { providerId: string; modelId: string } | null {
    const usage = USAGES.find((candidate) => candidate.id === usageId);
    if (usage === undefined) throw new NotFoundException(`未知的模型用途：${usageId}`);
    return this.toBinding(usage).resolved;
  }

  /* ----------------------------- 写 ----------------------------- */

  upsertProvider(id: string, body: UpsertProviderRequest, actor: string): ProviderConfigPublic {
    const existing = this.providers.get(id);
    if (existing === undefined && body.baseUrl === undefined) {
      throw new BadRequestException('新建供应商时必须提供网关地址');
    }

    // 新建时可以按预置模板补默认值。
    const preset = PROVIDER_PRESETS.find((candidate) => candidate.id === id);
    const state: ProviderState =
      existing ??
      ({
        id,
        name: preset?.name ?? id,
        baseUrl: preset?.baseUrl ?? '',
        api: preset?.api ?? 'openai-completions',
        authHeader: preset?.authHeader ?? true,
        apiKey: null,
        fetched: new Map(),
        manual: new Map(),
        modelsFetchedAt: null,
        lastError: null,
        updatedAt: null,
        updatedBy: null,
      } satisfies ProviderState);

    if (body.name !== undefined) state.name = body.name;
    if (body.baseUrl !== undefined) state.baseUrl = normaliseBaseUrl(body.baseUrl);
    if (body.api !== undefined) state.api = body.api;
    if (body.authHeader !== undefined) state.authHeader = body.authHeader;
    if (body.apiKey !== undefined) {
      // 空串 = 清除密钥；不落盘、不打日志。
      state.apiKey = body.apiKey.length > 0 ? body.apiKey : null;
    }
    // 兼容预置手选：新供应商先带上模板建议的模型，管理员可随后自动拉取覆盖。
    if (existing === undefined && preset !== undefined && state.manual.size === 0) {
      for (const model of preset.suggestedModels) {
        state.manual.set(model.id, {
          id: model.id,
          name: model.name,
          api: state.api,
          input: [...model.input],
          output: [...model.output],
          contextWindow: null,
          maxTokens: null,
          source: 'manual',
        });
      }
    }

    state.updatedAt = new Date().toISOString();
    state.updatedBy = actor;
    this.providers.set(id, state);
    this.logger.log(
      `供应商已保存 id=${id} api=${state.api} baseUrl=${state.baseUrl} 密钥=${state.apiKey === null ? '无' : '已配置'}`,
    );
    return this.toPublic(state);
  }

  deleteProvider(id: string): { id: string } {
    if (!this.providers.delete(id)) throw new NotFoundException(`供应商不存在：${id}`);
    // 解绑引用它的用途，避免留下指向已删供应商的悬空绑定。
    for (const [usageId, binding] of [...this.bindings.entries()]) {
      if (binding.providerId === id) this.bindings.delete(usageId);
    }
    this.logger.log(`供应商已删除 id=${id}`);
    return { id };
  }

  async refreshProvider(id: string): Promise<RefreshProviderResponse> {
    const state = this.providers.get(id);
    if (state === undefined) throw new NotFoundException(`供应商不存在：${id}`);
    if (state.baseUrl.length === 0) throw new BadRequestException('请先填写网关地址');

    try {
      const models = await fetchProviderModels({
        baseUrl: state.baseUrl,
        api: state.api,
        apiKey: state.apiKey ?? '',
        authHeader: state.authHeader,
      });
      state.fetched = new Map(models.map((model) => [model.id, model]));
      state.modelsFetchedAt = new Date().toISOString();
      state.lastError = null;
      this.logger.log(`自动拉取成功 id=${id} 模型数=${models.length}`);
      return { provider: this.toPublic(state), fetched: models.length };
    } catch (error) {
      const message = error instanceof ModelFetchError ? error.message : '拉取模型列表失败';
      state.lastError = message;
      this.logger.warn(`自动拉取失败 id=${id} 原因=${message}`);
      // 不抛异常：拉取失败是**可恢复的配置问题**，管理员需要看到 lastError
      // 并保留已配置的模型，而不是让整页报错。
      return { provider: this.toPublic(state), fetched: 0 };
    }
  }

  bindUsage(usageId: string, body: BindUsageRequest, actor: string): ModelUsageBinding {
    const usage = USAGES.find((candidate) => candidate.id === usageId);
    if (usage === undefined) throw new NotFoundException(`未知的模型用途：${usageId}`);

    if (body.providerId === null || body.modelId === null) {
      this.bindings.delete(usageId);
      this.logger.log(`用途已解绑 id=${usageId} 操作者=${actor}`);
      return this.toBinding(usage);
    }

    const state = this.providers.get(body.providerId);
    if (state === undefined) throw new BadRequestException(`供应商不存在：${body.providerId}`);
    const model = this.modelOf(state, body.modelId);
    if (model === undefined) {
      throw new BadRequestException(`供应商 ${body.providerId} 下没有模型 ${body.modelId}，请先自动拉取`);
    }
    const missing = usage.requiresOutput.filter((modality) => !model.output.includes(modality));
    if (missing.length > 0) {
      // 明确拒绝，而不是绑定后运行时才炸。
      throw new BadRequestException(
        `模型 ${body.modelId} 不具备「${usage.label}」需要的输出模态：${missing.join('、')}`,
      );
    }

    this.bindings.set(usageId, { providerId: body.providerId, modelId: body.modelId });
    this.logger.log(`用途已绑定 id=${usageId} provider=${body.providerId} model=${body.modelId} 操作者=${actor}`);
    return this.toBinding(usage);
  }

  /* --------------------------- 内部工具 --------------------------- */

  private toBinding(usage: ModelUsageSlot): ModelUsageBinding {
    const direct = this.bindings.get(usage.id);
    if (direct !== undefined) {
      return { usageId: usage.id, providerId: direct.providerId, modelId: direct.modelId, resolved: { ...direct } };
    }
    /*
     * 只在**显式声明了 `fallbackTo`** 时回落，没有全局兜底。
     *
     * 这里刻意不写「最后回落到 tutor.chat」：那样会让 `knowledge.embed`
     * （需要向量模型）静默拿到一个对话模型，把散文写进向量索引，
     * 而调用方完全看不出来。宁可返回 `null` 让功能显式不可用。
     */
    if (usage.fallbackTo !== null) {
      const fallback = this.bindings.get(usage.fallbackTo);
      if (fallback !== undefined) {
        return {
          usageId: usage.id,
          providerId: null,
          modelId: null,
          resolved: { providerId: fallback.providerId, modelId: fallback.modelId },
        };
      }
    }
    return { usageId: usage.id, providerId: null, modelId: null, resolved: null };
  }

  private modelOf(state: ProviderState, modelId: string): ModelDescriptor | undefined {
    return state.manual.get(modelId) ?? state.fetched.get(modelId);
  }

  private toPublic(state: ProviderState): ProviderConfigPublic {
    // 手填优先，拉取结果补充；同一 id 只出现一次。
    const merged = new Map<string, ModelDescriptor>();
    for (const model of state.fetched.values()) merged.set(model.id, model);
    for (const model of state.manual.values()) merged.set(model.id, model);

    const models = [...merged.values()].map((model) => this.withDeclaredCapabilities(state, model));

    return {
      id: state.id,
      name: state.name,
      baseUrl: state.baseUrl,
      api: state.api,
      authHeader: state.authHeader,
      auth: {
        configured: state.apiKey !== null && state.apiKey.length > 0,
        keyFingerprint: state.apiKey === null ? null : fingerprint(state.apiKey),
      },
      models,
      modelsFetchedAt: state.modelsFetchedAt,
      lastError: state.lastError,
      updatedAt: state.updatedAt,
      updatedBy: state.updatedBy,
    };
  }

  /**
   * 用**人或预置模板声明的能力**覆盖自动拉取来的保守默认值。
   *
   * 上游 `/models` 只会回一个 id，所以自动拉取一律按 `['text']` 处理。
   * 如果这个 id 在预置模板里被显式声明过（例如
   * `qwen-audio-3.0-realtime-plus` 带 audio），就以声明为准。
   * 手填的模型不动——那是管理员明确写的。
   */
  private withDeclaredCapabilities(state: ProviderState, model: ModelDescriptor): ModelDescriptor {
    if (model.source === 'manual') return model;
    for (const preset of PROVIDER_PRESETS) {
      const declared = preset.suggestedModels.find((candidate) => candidate.id === model.id);
      if (declared !== undefined) {
        return { ...model, name: declared.name, input: [...declared.input], output: [...declared.output] };
      }
    }
    return model;
  }
}

/** 去掉结尾斜杠，避免拼出 `//v1/models`。 */
function normaliseBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  if (!/^https?:\/\//.test(trimmed)) {
    throw new BadRequestException('网关地址必须以 http:// 或 https:// 开头');
  }
  return trimmed.replace(/\/+$/, '');
}

function fingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

/** 供其他地方复用的模态判断，避免各写一份。 */
export function supportsModality(model: ModelDescriptor, modality: ModelModality): boolean {
  return model.input.includes(modality) || model.output.includes(modality);
}
