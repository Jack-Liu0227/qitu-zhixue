import { assertResourceNameAvailable, assertResourceNamesUnique, resourceNameDatabaseConflict } from '../../common/resource-name';
import { MODEL_USAGE_SLOTS } from '@qitu/contracts';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  AdminModelResponse,
  AdminRuntimeModelOption,
  AdminModelUsagesResponse,
  AdminProvidersResponse,
  BindUsageRequest,
  ConnectionTestResponse,
  DiscoverProviderModelsResponse,
  ModelApi,
  ModelDescriptor,
  ModelModality,
  ModelUsageBinding,
  ModelUsageSlot,
  ModelRuntimeResponse,
  TutorAgentModelPurpose,
  ProviderConfigPublic,
  ProbeModelsRequest,
  ProbeModelsResponse,
  ProviderModelSelection,
  RefreshProviderResponse,
  SetProviderModelsResponse,
  UpsertProviderRequest,
} from '@qitu/contracts';
import type { Database } from '@qitu/database';
import { withTransaction } from '@qitu/database';
import { AuditWriter, type AuditEntry } from '../../common/audit';
import { DATABASE_TOKEN } from '../../database';
import {
  decryptModelSecret,
  encryptModelSecret,
  fingerprintModelSecret,
  readModelSecretKey,
} from '../../common/secrets';
import {
  deleteBindingRow,
  deleteManualModelRow,
  deleteModelRowsByIds,
  deleteProviderRows,
  insertManualModelRow,
  listBindingUsageIdsForModel,
  listAgentIdsForModel,
  listFrozenTeamVersionsForModel,
  listAgentIdsForProvider,
  listReferencedModelIds,
  loadModelRow,
  loadModelRows,
  loadModelRowsForProvider,
  loadProviderRow,
  loadProviderRows,
  loadUsageBindingRows,
  markProviderFetchError,
  markProviderFetchSuccess,
  markProviderModelsUpdated,
  syncRemoteModelMetadata,
  updateManualModelRow,
  upsertBindingRow,
  upsertManualModelRow,
  upsertProviderRow,
  upsertSelectedModelRows,
  type ManualModelPatch,
  type ModelRow,
  type SelectedModelRowInput,
} from './model-registry.persistence';
import {
  MODEL_APIS,
  MODEL_MODALITIES,
  normaliseApi,
  normaliseEnabled,
  normaliseModalities,
  normaliseOptionalInt,
  requireDisplayName,
  requireModelId,
} from './manual-model.validation';
import { fetchProviderModels, ModelFetchError, probeProviderModels, type ProviderModelsProbe } from './fetch-models';
import {
  buildConnectionTestResponse,
  CONNECTIVITY_DISCLAIMER,
  redactConnectionError,
} from './connection-test';
import { ModelGatewayError } from './model-gateway.errors';
import type { ModelRuntimeTarget } from './model-gateway.types';
import { PROVIDER_PRESETS } from './provider-presets';
import {
  readPiImportManifest,
  type PiImportManifest,
  type PiImportResult,
  type VoiceModelOption,
} from './pi-import';

/**
 * 模型供应商注册表 + Agent 直选模型解析。
 *
 * 参照 `pi-ai` 的分层：凭证属于供应商、能力属于模型、选择属于 Agent Runtime。
 *
 * 持久化（本任务）：
 * - `live` + `DATABASE_URL`：三张表 `model_providers` / `model_models` /
 *   `model_usage_bindings` 只作为迁移与兼容边界。进程启动时 `onModuleInit` 从库中
 *   **水合**内存快照；所有写操作落库后同步更新快照。这样重启后状态恢复，
 *   同时 `admin.controller` 的同步只读调用（`listProviders` / `getUsages`）
 *   无需改动。
 * - `demo` / `test` 且无 `DATABASE_URL`：保留纯内存实现，仅供显式演示 / 测试。
 *   这是显式降级，不是默认；`live` 缺库会在 `DatabaseModule` fail-fast。
 *
 * 密钥：
 * - 明文只在写请求里出现一次；`live` 下用 AES-256-GCM 加密后写
 *   `model_providers.encrypted_api_key`，主密钥来自 `QITU_MODEL_SECRET_KEY`。
 * - 没有主密钥时，带 `apiKey` 的 live 写入抛 503，**绝不**写明文或假成功。
 * - 对外只返回 `configured` / `keyFingerprint`；日志与审计不含密钥。
 * - 内存模式（demo/test）仍把明文留在进程内，仅用于兼容演示，**不适合 live**。
 *
 * 审计：
 * - provider upsert/delete、usage bind/unbind、model collection set 在 live 下与业务写入同事务落审计；
 * - refresh 只同步已挂载远程模型的元数据，成功时同事务审计；失败时先保留
 *   旧列表并更新 `last_error`，审计为 best-effort（不把可恢复的上游失败升级成 5xx）；
 * - discover 是只读上游探测，不落库、不写审计；
 * - `test` 连接测试接口本任务未实现，故无审计。
 * - 不接入写幂等：控制器未接收 `Idempotency-Key`；若将来接入，scope 必须使用
 *   provider / model / usage 维度（见文档）。
 */

interface ModelEntry {
  descriptor: ModelDescriptor;
  enabled: boolean;
}

interface ProviderState {
  id: string;
  name: string;
  baseUrl: string;
  api: ModelApi;
  authHeader: boolean;
  enabled: boolean;
  /** 解密后的明文密钥，仅存在于进程内；null 表示无密钥或无法解密。 */
  apiKey: string | null;
  /** 落库的密文（`v1:iv:tag:ciphertext`）；内存模式下为 null。 */
  encryptedApiKey: string | null;
  keyFingerprint: string | null;
  /** 本次进程生命周期内自动拉取到的模型（按 id 索引）。 */
  fetched: Map<string, ModelEntry>;
  /** 管理员/预置模板声明的模型（按 id 索引），优先级高于拉取结果。 */
  manual: Map<string, ModelEntry>;
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
const USAGES = MODEL_USAGE_SLOTS;

/** 模型注册表服务。读写方法见下方分区。 */

/**
 * 手工创建模型的入参。
 *
 * 字段全部可选：控制器只做字段白名单，真正的类型 / 范围校验、默认值（协议沿用
 * 供应商、模态默认 `text`、`enabled` 默认 true）都在服务层用
 * `manual-model.validation` 的纯函数完成。
 */
export interface CreateManualModelInput {
  modelId?: string;
  displayName?: string;
  api?: ModelApi;
  input?: ModelModality[];
  output?: ModelModality[];
  contextWindow?: number | null;
  maxTokens?: number | null;
  enabled?: boolean;
}

/** 手工更新模型的入参；刻意不含 `modelId`（路径参数才是身份来源）。 */
export interface UpdateManualModelInput {
  displayName?: string;
  api?: ModelApi;
  input?: ModelModality[];
  output?: ModelModality[];
  contextWindow?: number | null;
  maxTokens?: number | null;
  enabled?: boolean;
}

@Injectable()
export class ModelRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ModelRegistryService.name);
  private readonly providers = new Map<string, ProviderState>();
  private readonly bindings = new Map<string, { providerId: string; modelId: string }>();

  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {}

  /**
   * 启动时从数据库水合内存快照。live 下若三张表不可读会抛错让进程 fail-fast，
   * 而不是带着空列表继续对外服务。
   */
  async onModuleInit(): Promise<void> {
    if (!this.db) {
      this.logger.warn(
        'ModelRegistryService：无 DATABASE_URL，使用内存实现（仅 demo/test 演示，不适合 live）。',
      );
      return;
    }
    await this.hydrate();
    this.logger.log(
      `ModelRegistryService：已从数据库恢复 ${this.providers.size} 个供应商、${this.bindings.size} 条用途绑定。`,
    );

    // Pi remains a desktop-only source. An operator can explicitly stage a
    // copy of its catalog on the server for first-time initialization; normal
    // restarts stay database-only unless this opt-in flag is present.
    if (process.env.QITU_PI_IMPORT_ON_STARTUP?.trim().toLowerCase() === 'true') {
      const result = await this.importPiConfigFromDirectory('system:pi-import');
      this.logger.log(
        `ModelRegistryService：Pi 初始化导入完成 ${result.providers.length} 个供应商、${result.importedModels} 个模型，跳过 ${result.skippedModels} 个模型。`,
      );
    }
  }

  /* ----------------------------- 读 ----------------------------- */

  listProviders(): AdminProvidersResponse {
    return {
      providers: [...this.providers.values()].map((state) => this.toPublic(state)),
      presets: PROVIDER_PRESETS.map((preset) => ({ ...preset })),
    };
  }

  /**
   * Import the server-side pi catalog through the same provider/key path used
   * by the admin provider form. Credentials are accepted only from the
   * server-mounted manifest and are encrypted by `upsertProvider` before they
   * reach persistence.
   */
  async importPiConfigFromDirectory(actor: string): Promise<PiImportResult> {
    const manifest = await readPiImportManifest();
    return this.importPiManifest(manifest, actor);
  }

  async importPiManifest(manifest: PiImportManifest, actor: string): Promise<PiImportResult> {
    if (manifest.providers.length === 0) {
      throw new BadRequestException({
        code: 'PI_CONFIG_EMPTY',
        message: 'Pi 配置中没有可导入的供应商',
      });
    }
    let importedModels = 0;
    let skippedModels = 0;
    // A model declaration alone cannot enable voice. The VoiceGateway adapter
    // is a separate server capability, so imports never bind tutor.live.
    const defaultVoiceModel: PiImportResult['defaultVoiceModel'] = null;
    const providers: PiImportResult['providers'] = [];

    for (const input of manifest.providers) {
      const provider = await this.upsertProvider(
        input.id,
        {
          name: input.name,
          baseUrl: input.baseUrl,
          api: input.api,
          authHeader: input.authHeader,
          apiKey: input.apiKey,
        },
        actor,
        false,
      );
      const state = this.providers.get(input.id);
      if (state === undefined) {
        throw new ServiceUnavailableException(`PI 导入后供应商状态不可用：${input.id}`);
      }

      const seenModelIds = new Set<string>();
      const descriptors: ModelDescriptor[] = [];
      let providerSkipped = 0;
      for (const model of input.models) {
        const modelId = model.modelId.trim();
        if (modelId.length === 0 || seenModelIds.has(modelId)) {
          providerSkipped += 1;
          continue;
        }
        seenModelIds.add(modelId);

        try {
          // The storage schema keeps the protocol at provider scope, so a pi
          // model declaring another protocol cannot be represented safely.
          const api = normaliseApi(model.api, provider.api);
          descriptors.push({
            id: modelId,
            name: model.displayName?.trim() || modelId,
            api,
            input: normaliseModalities(model.input, 'input'),
            output: normaliseModalities(model.output, 'output'),
            contextWindow: model.contextWindow ?? null,
            maxTokens: model.maxTokens ?? null,
            source: 'manual',
          });
        } catch (error) {
          providerSkipped += 1;
          this.logger.warn(
            `PI 模型已跳过 provider=${input.id} model=${modelId} 原因=${
              error instanceof Error ? error.message : '模型声明无效'
            }`,
          );
        }
      }

      const mergedNames = new Map(this.modelEntryIds(state).map(id => [id, this.modelEntry(state, id)!.descriptor.name]));
      for (const descriptor of descriptors) mergedNames.set(descriptor.id, descriptor.name);
      assertResourceNamesUnique('model', mergedNames.values());
      skippedModels += providerSkipped;

      if (this.db && descriptors.length > 0) {
        const now = new Date();
        await withTransaction(this.db, async (tx) => {
          for (const descriptor of descriptors) {
            await upsertManualModelRow(
              tx,
              {
                providerId: input.id,
                modelId: descriptor.id,
                displayName: descriptor.name,
                input: [...descriptor.input],
                output: [...descriptor.output],
                contextWindow: descriptor.contextWindow,
                maxTokens: descriptor.maxTokens,
              },
              now,
            );
          }
          await this.audit.write(
            {
              actorId: actor,
              action: 'model_provider.pi_import',
              targetType: 'model_provider',
              targetId: input.id,
              detail: {
                importedModels: descriptors.map((descriptor) => descriptor.id),
                skippedModels: providerSkipped,
              },
            },
            tx,
          );
        });
      }

      // Commit the in-memory snapshot only after persistence succeeds. The
      // import deliberately uses the manual bucket so a later remote refresh
      // cannot erase the pi-declared capabilities (especially audio).
      for (const descriptor of descriptors) {
        this.applyModelToMemory(input.id, descriptor, true);
      }
      importedModels += descriptors.length;

      const voiceModelIds = descriptors
        .filter((descriptor) => isAudioModel(descriptor))
        .map((descriptor) => descriptor.id);
      providers.push({
        id: input.id,
        configured: provider.auth.configured,
        modelsImported: descriptors.length,
        modelsSkipped: providerSkipped,
        voiceModelIds,
      });
    }

    return {
      providers,
      importedModels,
      skippedModels,
      defaultVoiceModel,
    };
  }

  /** Return an audio-capable catalog without provider credentials. */
  listVoiceModels(): VoiceModelOption[] {
    const result: VoiceModelOption[] = [];
    for (const state of this.providers.values()) {
      const publicProvider = this.toPublic(state);
      for (const model of publicProvider.models) {
        if (!isAudioModel(model)) continue;
        const operations = voiceOperationsFor(model.input, model.output);
        result.push({
          providerId: state.id,
          providerName: state.name,
          modelId: model.id,
          modelName: model.name || model.id,
          configured: state.keyFingerprint !== null,
          available: false,
          availabilityReason:
            operations.length === 0
              ? 'voice_capability_not_declared'
              : state.keyFingerprint === null
                ? 'provider_not_configured'
                : 'voice_adapter_not_configured',
          operations,
          input: [...model.input],
          output: [...model.output],
        });
      }
    }
    return result;
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

  /**
   * Agent Runtime 使用的无密钥用途投影。
   *
   * 与 `resolveRuntimeTarget` 分开：运行时只需要知道「这项能力是否可用、
   * 采用哪个用途/模型、输入输出模态」，绝不能为了做路由判断而拿到凭证。
   */
  resolvePurpose(usageId: string): TutorAgentModelPurpose {
    const usage = USAGES.find((candidate) => candidate.id === usageId);
    if (usage === undefined) throw new NotFoundException(`未知的模型用途：${usageId}`);
    const unavailable: TutorAgentModelPurpose = {
      usageId,
      available: false,
      input: [],
      output: [],
      modelId: null,
    };
    const resolved = this.toBinding(usage).resolved;
    if (resolved === null) return unavailable;
    const state = this.providers.get(resolved.providerId);
    const entry = state === undefined ? null : this.modelEntry(state, resolved.modelId);
    if (state === undefined || entry === null) return unavailable;
    const input = [...entry.descriptor.input];
    const output = [...entry.descriptor.output];
    const missingInput = (usage.requiresInput ?? []).some((modality) => !input.includes(modality));
    const missingOutput = usage.requiresOutput.some((modality) => !output.includes(modality));
    const available = state.enabled && entry.enabled && state.apiKey !== null && !missingInput && !missingOutput;
    return { usageId, available, input, output, modelId: resolved.modelId };
  }

  /** Resolve a provider/model pair selected directly on an Agent. */
  resolvePurposeByModel(selection: { providerId: string; modelId: string }): TutorAgentModelPurpose {
    const option = this.listAgentModelOptions().find(
      (candidate) => candidate.providerId === selection.providerId && candidate.modelId === selection.modelId,
    );
    return {
      usageId: 'agent.model',
      available: option?.available ?? false,
      input: option?.input ?? [],
      output: option?.output ?? [],
      modelId: option?.modelId ?? null,
    };
  }

  /** Compatibility projection for existing four-client runtime status consumers. */
  getRuntimeSummary(): ModelRuntimeResponse {
    const text = this.resolvePurpose('tutor.chat');
    const live = this.resolvePurpose('tutor.live');
    const availableModalities: ModelRuntimeResponse['availableModalities'] = [];
    if (text.available && text.input.includes('text') && text.output.includes('text')) {
      availableModalities.push('text_text');
    }
    const canHear = live.available && live.input.includes('audio');
    const canSpeak = live.available && live.output.includes('audio');
    if (canHear && canSpeak) availableModalities.push('voice_voice');
    if (canHear && live.output.includes('text')) availableModalities.push('voice_text');
    if (live.input.includes('text') && canSpeak) availableModalities.push('text_voice');
    return {
      textModelId: text.modelId ?? 'unavailable',
      liveModelId: live.modelId ?? 'unavailable',
      liveAvailable: live.available,
      availableModalities,
    };
  }
  /**
   * Runtime `ModelGateway` 的解析入口：把用途解析为 provider / model / baseUrl /
   * 协议 / **解密后的凭证**。
   *
   * ⚠️ 返回值里的 `credential` 是明文。它**只允许** `ModelGateway` 用来构造
   * 鉴权头：绝不能交给控制器、写日志、进审计或错误消息。业务模块应注入
   * `ModelGateway` 调 `complete()`，而不是直接调用本方法。
   *
   * 任一层缺失（无 binding / provider / model / secret）都抛
   * {@link ModelGatewayError}，让调用方把功能显式标记为「不可用」，而不是
   * 静默回落到硬编码默认模型。
   */
  resolveRuntimeTarget(usageId: string): ModelRuntimeTarget {
    const usage = USAGES.find((candidate) => candidate.id === usageId);
    if (usage === undefined) {
      throw new ModelGatewayError('MODEL_USAGE_UNKNOWN', `未知的模型用途：${usageId}`);
    }

    const resolved = this.toBinding(usage).resolved;
    if (resolved === null) {
      throw new ModelGatewayError(
        'MODEL_USAGE_NOT_BOUND',
        `用途「${usage.label}」未绑定或尚未解析到可用模型，请在 AI 运行时为 Agent 配置模型`,
      );
    }

    const state = this.providers.get(resolved.providerId);
    if (state === undefined) {
      throw new ModelGatewayError(
        'MODEL_PROVIDER_NOT_FOUND',
        `用途绑定的供应商不存在：${resolved.providerId}`,
      );
    }
    if (!state.enabled) {
      throw new ModelGatewayError('MODEL_PROVIDER_DISABLED', `供应商已停用：${state.id}`);
    }
    if (state.baseUrl.length === 0) {
      throw new ModelGatewayError('MODEL_BASE_URL_MISSING', `供应商 ${state.id} 未配置网关地址`);
    }

    const entry = this.modelEntry(state, resolved.modelId);
    if (entry === null) {
      throw new ModelGatewayError(
        'MODEL_NOT_FOUND',
        `模型不存在：${state.id}/${resolved.modelId}`,
      );
    }
    if (!entry.enabled) {
      throw new ModelGatewayError('MODEL_DISABLED', `模型已停用：${state.id}/${resolved.modelId}`);
    }

    if (state.apiKey === null || state.apiKey.length === 0) {
      throw new ModelGatewayError(
        'MODEL_CREDENTIAL_MISSING',
        `供应商 ${state.id} 未配置可用密钥，或已存密文无法解密`,
      );
    }

    return {
      providerId: state.id,
      providerName: state.name,
      modelId: resolved.modelId,
      baseUrl: state.baseUrl,
      api: state.api,
      authHeader: state.authHeader,
      input: [...entry.descriptor.input],
      output: [...entry.descriptor.output],
      credential: state.apiKey,
    };
  }

  /* ----------------------------- 写 ----------------------------- */

  resolveRuntimeTargetByModel(selection: { providerId: string; modelId: string }): ModelRuntimeTarget {
    const state = this.providers.get(selection.providerId);
    if (state === undefined) {
      throw new ModelGatewayError('MODEL_PROVIDER_NOT_FOUND', `模型供应商不存在：${selection.providerId}`);
    }
    if (!state.enabled) {
      throw new ModelGatewayError('MODEL_PROVIDER_DISABLED', `供应商已停用：${state.id}`);
    }
    if (state.baseUrl.length === 0) {
      throw new ModelGatewayError('MODEL_BASE_URL_MISSING', `供应商 ${state.id} 未配置网关地址`);
    }
    const entry = this.modelEntry(state, selection.modelId);
    if (entry === null) {
      throw new ModelGatewayError('MODEL_NOT_FOUND', `模型不存在：${state.id}/${selection.modelId}`);
    }
    if (!entry.enabled) {
      throw new ModelGatewayError('MODEL_DISABLED', `模型已停用：${state.id}/${selection.modelId}`);
    }
    if (state.apiKey === null || state.apiKey.length === 0) {
      throw new ModelGatewayError('MODEL_CREDENTIAL_MISSING', `供应商 ${state.id} 未配置可用密钥，或已存密文无法解密`);
    }
    return {
      providerId: state.id,
      providerName: state.name,
      modelId: selection.modelId,
      baseUrl: state.baseUrl,
      api: state.api,
      authHeader: state.authHeader,
      input: [...entry.descriptor.input],
      output: [...entry.descriptor.output],
      credential: state.apiKey,
    };
  }

  listAgentModelOptions(): AdminRuntimeModelOption[] {
    return this.listProviders().providers.flatMap((provider) => provider.models.map((model) => ({
      providerId: provider.id,
      providerLabel: provider.name,
      modelId: model.id,
      modelLabel: model.name || model.id,
      label: `${provider.name} · ${model.name || model.id}`,
      // `configured` only means that a fingerprint exists. A key can still be
      // undecryptable after a deployment, so runtime availability must use the
      // in-process secret as the source of truth.
      available: provider.enabled
        && this.providers.get(provider.id)?.apiKey !== null
        && this.providers.get(provider.id)?.apiKey !== undefined
        && provider.baseUrl.trim().length > 0,
      input: [...model.input],
      output: [...model.output],
    })));
  }

  async upsertProvider(
    id: string,
    body: UpsertProviderRequest,
    actor: string,
    seedPresetModels = true,
  ): Promise<ProviderConfigPublic> {
    const existing = this.providers.get(id);
    if (existing === undefined && body.baseUrl === undefined) {
      throw new BadRequestException('新建供应商时必须提供网关地址');
    }

    const preset = PROVIDER_PRESETS.find((candidate) => candidate.id === id);
    const created = existing === undefined;
    // 基于副本构造，数据库写入成功后才替换内存快照，避免「库写失败但内存已改」。
    const state: ProviderState =
      existing !== undefined
        ? { ...existing }
        : ({
            id,
            name: preset?.name ?? id,
            baseUrl: preset?.baseUrl ?? '',
            api: preset?.api ?? 'openai-completions',
            authHeader: preset?.authHeader ?? true,
            enabled: true,
            apiKey: null,
            encryptedApiKey: null,
            keyFingerprint: null,
            fetched: new Map(),
            manual: new Map(),
            modelsFetchedAt: null,
            lastError: null,
            updatedAt: null,
            updatedBy: null,
          } satisfies ProviderState);

    // 密钥先处理：缺少主密钥时立刻 503，不产生任何半写入。
    if (body.apiKey !== undefined) this.applyApiKey(state, body.apiKey);
    if (body.name !== undefined) state.name = body.name;
    assertResourceNameAvailable('model_provider', state.name, this.providers.values(), id);
    if (body.baseUrl !== undefined) state.baseUrl = normaliseBaseUrl(body.baseUrl);
    if (body.api !== undefined) state.api = body.api;
    if (body.authHeader !== undefined) state.authHeader = body.authHeader;
    const providerEnabled = (body as UpsertProviderRequest & { enabled?: boolean }).enabled;
    if (providerEnabled !== undefined) state.enabled = providerEnabled;

    // 兼容预置手选：新供应商先带上模板建议的模型，管理员可随后自动拉取覆盖。
    const newManualModels: ModelDescriptor[] = [];
    if (seedPresetModels && created && preset !== undefined && state.manual.size === 0) {
      for (const model of preset.suggestedModels) {
        const descriptor: ModelDescriptor = {
          id: model.id,
          name: model.name,
          api: state.api,
          input: [...model.input],
          output: [...model.output],
          contextWindow: null,
          maxTokens: null,
          source: 'manual',
        };
        state.manual.set(model.id, { descriptor, enabled: true });
        newManualModels.push(descriptor);
      }
    }

    state.updatedAt = new Date().toISOString();
    state.updatedBy = actor;

    if (this.db) {
      const now = new Date();
      await withTransaction(this.db, async (tx) => {
        await upsertProviderRow(tx, {
          id: state.id,
          name: state.name,
          baseUrl: state.baseUrl,
          api: state.api,
          authHeader: state.authHeader,
          enabled: state.enabled,
          secretRef: null,
          encryptedApiKey: state.encryptedApiKey,
          keyFingerprint: state.keyFingerprint,
          modelsFetchedAt: state.modelsFetchedAt === null ? null : new Date(state.modelsFetchedAt),
          lastError: state.lastError,
          updatedAt: now,
          updatedBy: state.updatedBy,
        });
        for (const model of newManualModels) {
          await upsertManualModelRow(
            tx,
            {
              providerId: id,
              modelId: model.id,
              displayName: model.name,
              input: [...model.input],
              output: [...model.output],
              contextWindow: model.contextWindow,
              maxTokens: model.maxTokens,
            },
            now,
          );
        }
        await this.audit.write(
          {
            actorId: actor,
            action: 'model_provider.upsert',
            targetType: 'model_provider',
            targetId: id,
            detail: {
              created,
              name: state.name,
              baseUrl: state.baseUrl,
              api: state.api,
              authHeader: state.authHeader,
              keyConfigured: state.keyFingerprint !== null,
              keyChanged: body.apiKey !== undefined,
              manualModels: newManualModels.map((model) => model.id),
            },
          },
          tx,
        );
      });
    }

    // 数据库成功（或显式内存模式）后，才提交内存快照。
    this.providers.set(id, state);

    this.logger.log(
      `供应商已保存 id=${id} api=${state.api} baseUrl=${state.baseUrl} 密钥=${state.keyFingerprint === null ? '无' : '已配置'}`,
    );
    return this.toPublic(state);
  }

  async deleteProvider(id: string, actor: string): Promise<{ id: string }> {
    const state = this.providers.get(id);
    if (state === undefined) throw new NotFoundException(`供应商不存在：${id}`);

    if (this.db) {
      const directAgentIds = await listAgentIdsForProvider(this.db, id);
      if (directAgentIds.length > 0) {
        throw new ConflictException(`供应商仍被 Agent 配置引用（${directAgentIds.join('、')}），请先在 AI 运行时清空模型选择`);
      }
    }

    // 引用它的用途先显式解绑；前端文案承诺「引用它的用途会被解绑」。
    const unboundUsages = [...this.bindings.entries()]
      .filter(([, binding]) => binding.providerId === id)
      .map(([usageId]) => usageId);

    if (this.db) {
      await withTransaction(this.db, async (tx) => {
        await deleteProviderRows(tx, id);
        await this.audit.write(
          {
            actorId: actor,
            action: 'model_provider.delete',
            targetType: 'model_provider',
            targetId: id,
            detail: { name: state.name, unboundUsages },
          },
          tx,
        );
      });
    }

    this.providers.delete(id);
    for (const usageId of unboundUsages) this.bindings.delete(usageId);
    this.logger.log(`供应商已删除 id=${id} 解绑用途=${unboundUsages.join(',') || '无'}`);
    return { id };
  }

  /**
   * 上游目录同步：**只更新元数据，不改变挂载集合**。
   *
   * 产品规则（对应 `docs/admin/model-registry.md` §5）：
   *  - 拉取不再替管理员做决定——新发现的上游模型只进 `discovered` 报告，
   *    必须管理员在「选择模型」里勾选并保存才入库；
   *  - 上游本次未返回的已挂载模型只进 `stale` 报告，**不自动停用也不删除**，
   *    避免网关临时少返一个模型就把 Agent 正在用的模型抹掉；
   *  - 失败仍为可恢复状态：保留旧列表、写 `last_error`，不报 5xx。
   */
  async refreshProvider(id: string, actor: string): Promise<RefreshProviderResponse> {
    const state = this.providers.get(id);
    if (state === undefined) throw new NotFoundException(`供应商不存在：${id}`);
    if (state.baseUrl.length === 0) throw new BadRequestException('请先填写网关地址');

    // 只把**上游拉取**放进 try/catch：落库 / 审计失败属于基础设施故障，
    // 必须向上抛，不能被伪装成「上游不可达」。
    let models: ModelDescriptor[];
    try {
      models = await fetchProviderModels({
        baseUrl: state.baseUrl,
        api: state.api,
        apiKey: state.apiKey ?? '',
        authHeader: state.authHeader,
      });
    } catch (error) {
      const message = error instanceof ModelFetchError ? error.message : '拉取模型列表失败';
      const now = new Date();

      // 拉取失败是**可恢复的配置问题**：保留已配置模型，把原因写进 lastError，
      // 不抛异常让整页报错。
      if (this.db) {
        await withTransaction(this.db, async (tx) => {
          await markProviderFetchError(tx, id, message, now, actor);
        });
        // 审计是 best-effort：不能让审计故障把可恢复的上游失败升级成 5xx。
        await this.auditBestEffort({
          actorId: actor,
          action: 'model_provider.refresh',
          targetType: 'model_provider',
          targetId: id,
          detail: { ok: false, error: message },
        });
      }

      state.lastError = message;
      state.updatedAt = now.toISOString();
      state.updatedBy = actor;
      this.logger.warn(`目录同步失败 id=${id} 原因=${message}`);
      return { provider: this.toPublic(state), fetched: 0, discovered: [], stale: [] };
    }

    const now = new Date();
    const upstreamIds = new Set(models.map((model) => model.id));
    const byId = new Map(models.map((model) => [model.id, model]));
    const mountedIds = new Set([...state.fetched.keys(), ...state.manual.keys()]);
    const discovered = models.filter((model) => !mountedIds.has(model.id));
    // `stale` 只报「自称来自上游同步、但本次上游没返回」的行。手工行是
    // 管理员显式声明的（常见于网关别名），上游本来就不一定认识它，
    // 把它们当成「已消失」只会制造噪声。
    const stale: ModelDescriptor[] = [];
    for (const entry of state.fetched.values()) {
      if (!upstreamIds.has(entry.descriptor.id)) stale.push(entry.descriptor);
    }

    assertResourceNamesUnique('model', this.modelEntryIds(state).map(modelId => {
      const entry = this.modelEntry(state, modelId)!;
      return entry.descriptor.source === 'fetched' ? byId.get(modelId)?.name ?? entry.descriptor.name : entry.descriptor.name;
    }));
    if (this.db) {
      await withTransaction(this.db, async (tx) => {
        await syncRemoteModelMetadata(tx, id, models, now);
        await markProviderFetchSuccess(tx, id, now, actor);
        await this.audit.write(
          {
            actorId: actor,
            action: 'model_provider.refresh',
            targetType: 'model_provider',
            targetId: id,
            detail: { ok: true, fetched: models.length, discovered: discovered.length, stale: stale.length },
          },
          tx,
        );
      });
    }

    // 内存快照：只刷元数据，不新增 / 不剔除条目。手工条目保持管理员原写，
    // 因为模态与展示名是管理员声明的，不能用上游 id 覆盖。
    for (const entry of state.fetched.values()) {
      const fresh = byId.get(entry.descriptor.id);
      if (fresh === undefined) continue;
      entry.descriptor = { ...entry.descriptor, name: fresh.name, contextWindow: fresh.contextWindow, maxTokens: fresh.maxTokens };
    }
    state.modelsFetchedAt = now.toISOString();
    state.lastError = null;
    state.updatedAt = now.toISOString();
    state.updatedBy = actor;

    this.logger.log(
      `目录同步成功 id=${id} 上游模型数=${models.length} 未挂载=${discovered.length} 己消失=${stale.length}`,
    );
    return { provider: this.toPublic(state), fetched: models.length, discovered, stale };
  }

  /**
   * 只读发现：用**已保存**的地址与密钥拉一次上游模型列表。
   *
   * 与 `refreshProvider` 的关键区别：这里**不写库、不改内存、不写审计**，
   * 也不进 `modelsFetchedAt`。它是管理员「先看看有什么」的唯一入口；要什
   * 么模型由 `PUT :id/models` 决定。失败收敛成 `ok=false` + 已脱敏错误。
   */
  async discoverModels(id: string, actor: string): Promise<DiscoverProviderModelsResponse> {
    const state = this.providers.get(id);
    if (state === undefined) throw new NotFoundException(`供应商不存在：${id}`);
    if (state.baseUrl.length === 0) throw new BadRequestException('请先填写网关地址');

    const probe = await probeProviderModels({
      baseUrl: state.baseUrl,
      api: state.api,
      apiKey: state.apiKey ?? '',
      authHeader: state.authHeader,
    });
    const error = probe.ok ? null : redactConnectionError(probe.error ?? '探测上游模型列表失败', [state.apiKey]);
    // 日志只记地址、协议与个数，绝不记密钥。
    this.logger.log(
      probe.ok
        ? `只读发现成功 id=${id} api=${state.api} 模型数=${probe.models.length} 操作者=${actor}`
        : `只读发现失败 id=${id} api=${state.api} 操作者=${actor} 原因=${error}`,
    );

    const mountedIds = [...new Set([...state.fetched.keys(), ...state.manual.keys()])];
    return {
      providerId: id,
      ok: probe.ok,
      models: probe.models,
      error,
      mountedIds,
    };
  }

  /**
   * 设置通道的挂载模型集合（**唯一的挂载 / 取消入口**）。
   *
   * 语义：请求体里的 `models` 是期望的完整集合。
   *  - 不在集合里的行→ **物理删除**（按产品决定）；
   *  - 在集合里但不存在的行→ 插入（`source` 默认 `remote`）；
   *  - 已存在的行→ 只更新元数据，**保留原来源**。
   *
   * 安全：删除前先算引用集合（用途绑定 + Agent 直选），命中则整笔 409，
   * 绝不部分成功；写入与审计同事务，日志与审计不含密钥。
   */
  async setProviderModels(
    id: string,
    selection: readonly ProviderModelSelection[],
    actor: string,
    auditIdempotencyKey: string,
  ): Promise<SetProviderModelsResponse> {
    const state = this.providers.get(id);
    if (state === undefined) throw new NotFoundException(`供应商不存在：${id}`);

    const desired: SelectedModelRowInput[] = [];
    const seen = new Set<string>();
    for (const raw of selection) {
      const modelId = requireModelId(raw.modelId);
      if (seen.has(modelId)) {
        throw new BadRequestException(`模型重复：${modelId}；期望集合里同一个 modelId 只能出现一次`);
      }
      seen.add(modelId);
      const input = normaliseModalities(raw.input ?? null, 'input');
      const output = normaliseModalities(raw.output ?? null, 'output');
      const contextWindow = normaliseOptionalInt(raw.contextWindow ?? null, 'contextWindow');
      const maxTokens = normaliseOptionalInt(raw.maxTokens ?? null, 'maxTokens');
      const displayName = raw.displayName === undefined ? modelId : requireDisplayName(raw.displayName);
      const source = raw.source === undefined || raw.source === 'remote' ? 'remote' : raw.source;
      if (source !== 'remote' && source !== 'manual') {
        throw new BadRequestException(`source 只允许 remote | manual，收到 ${String(raw.source)}`);
      }
      desired.push({ modelId, displayName, input, output, contextWindow, maxTokens, source });
    }
    assertResourceNamesUnique('model', desired.map(model => model.displayName));
    if (desired.length > 500) throw new BadRequestException('单次提交模型数不得超过 500');

    const desiredIds = new Set(desired.map((model) => model.modelId));
    const now = new Date();
    const created: string[] = [];
    const kept: string[] = [];
    let removed: string[] = [];

    if (this.db) {
      const rows = await loadModelRowsForProvider(this.db, id);
      const existingIds = new Set(rows.map((row) => row.modelId));
      const toRemove = rows.map((row) => row.modelId).filter((modelId) => !desiredIds.has(modelId));
      if (toRemove.length > 0) {
        const referenced = new Set(await listReferencedModelIds(this.db, id));
        const blocked = toRemove.filter((modelId) => referenced.has(modelId));
        if (blocked.length > 0) {
          throw new ConflictException(
            `以下模型仍被用途或 Agent 直接引用，不能取消挂载：${blocked.slice(0, 20).join('、')}` +
              (blocked.length > 20 ? ` 等 ${blocked.length} 个` : '') +
              '；请先在 AI 运行时清空模型选择',
          );
        }
      }
      removed = toRemove;

      for (const model of desired) {
        if (existingIds.has(model.modelId)) kept.push(model.modelId);
        else created.push(model.modelId);
      }

      await withTransaction(this.db, async (tx) => {
        await deleteModelRowsByIds(tx, id, removed);
        await upsertSelectedModelRows(tx, id, desired, now);
        await markProviderModelsUpdated(tx, id, now, actor);
        await this.audit.write(
          {
            actorId: actor,
            action: 'model.set_collection',
            targetType: 'model_provider',
            targetId: id,
            idempotencyKey: auditIdempotencyKey,
            detail: { providerId: id, mounted: desired.length, created, removed },
          },
          tx,
        );
      });
    } else {
      for (const model of desired) {
        if (this.modelEntry(state, model.modelId) !== null) kept.push(model.modelId);
        else created.push(model.modelId);
      }
      removed = [...this.modelEntryIds(state)].filter((modelId) => !desiredIds.has(modelId));
    }

    // 内存快照与库保持一致：未选的行从两个桶里都摸掉，选中的按来源入桶。
    for (const modelId of removed) {
      state.fetched.delete(modelId);
      state.manual.delete(modelId);
    }
    for (const model of desired) {
      const descriptor: ModelDescriptor = {
        id: model.modelId,
        name: model.displayName,
        api: state.api,
        input: model.input,
        output: model.output,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        source: model.source === 'manual' ? 'manual' : 'fetched',
      };
      // 已存在的行保留原来源，与持久化层的 onConflictDoUpdate 一致。
      const existing = this.modelEntry(state, model.modelId);
      const finalDescriptor =
        existing === null ? descriptor : { ...descriptor, source: existing.descriptor.source };
      const bucket = finalDescriptor.source === 'manual' ? state.manual : state.fetched;
      bucket.set(model.modelId, { descriptor: finalDescriptor, enabled: true });
    }
    state.updatedAt = now.toISOString();
    state.updatedBy = actor;

    this.logger.log(
      `挂载集合已保存 id=${id} 挂载=${desired.length} 新增=${created.length} 取消=${removed.length} 操作者=${actor}`,
    );
    return { provider: this.toPublic(state), created, removed, kept };
  }

  /** 内存快照里当前已挂载的模型 id（两个桶都算）。 */
  private modelEntryIds(state: ProviderState): string[] {
    return [...new Set([...state.fetched.keys(), ...state.manual.keys()])];
  }

  /**
   * 未保存供应商的模型发现探测（新建渠道表单里的「获取模型」）。
   *
   * 用管理员**表单当前值**发起一次受 SSRF / 超时 / 响应体上限保护的
   * `/models` 拉取（复用 `probeProviderModels`，与连接测试同一套防护）。
   * 不落库、不写审计、不改任何 Provider 状态；明文密钥只在本次调用里存在。
   * 上游失败返回 `ok=false` + 已脱敏错误，**绝不回填预设模型**。
   */
  async probeModels(input: ProbeModelsRequest, actor: string): Promise<ProbeModelsResponse> {
    const probe = await probeProviderModels({
      baseUrl: input.baseUrl,
      api: input.api,
      apiKey: input.apiKey ?? '',
      authHeader: input.authHeader ?? true,
    });
    // 纵深防御：fetcher 的错误已不含请求头，这里再按本次明文密钥兑底脱敏。
    const error = probe.ok
      ? null
      : redactConnectionError(probe.error ?? '探测上游模型列表失败', [input.apiKey]);
    // 日志只记地址、协议与模型个数，绝不记密钥。
    if (probe.ok) {
      this.logger.log(
        `模型探测成功 baseUrl=${input.baseUrl} api=${input.api} 模型数=${probe.models.length} actor=${actor}`,
      );
    } else {
      this.logger.warn(
        `模型探测失败 baseUrl=${input.baseUrl} api=${input.api} actor=${actor} 原因=${error}`,
      );
    }
    return { ok: probe.ok, models: probe.ok ? probe.models : [], error };
  }

  async bindUsage(usageId: string, body: BindUsageRequest, actor: string): Promise<ModelUsageBinding> {
    const usage = USAGES.find((candidate) => candidate.id === usageId);
    if (usage === undefined) throw new NotFoundException(`未知的模型用途：${usageId}`);

    if (body.providerId === null || body.modelId === null) {
      if (this.db) {
        await withTransaction(this.db, async (tx) => {
          await deleteBindingRow(tx, usageId);
          await this.audit.write(
            {
              actorId: actor,
              action: 'model_usage.unbind',
              targetType: 'model_usage',
              targetId: usageId,
              detail: {},
            },
            tx,
          );
        });
      }
      this.bindings.delete(usageId);
      this.logger.log(`用途已解绑 id=${usageId} 操作者=${actor}`);
      return this.toBinding(usage);
    }

    const state = this.providers.get(body.providerId);
    if (state === undefined) throw new BadRequestException(`供应商不存在：${body.providerId}`);
    if (!state.enabled) throw new ConflictException(`供应商已停用：${body.providerId}`);
    const model = this.modelOf(state, body.modelId);
    if (model === undefined) {
      // 已下线（enabled=false）或从未见过的模型都拒绝，避免绑定后运行时才炸。
      throw new BadRequestException(
        `供应商 ${body.providerId} 下没有可用模型 ${body.modelId}，请先自动拉取或确认模型未下线`,
      );
    }
    const missingInput = (usage.requiresInput ?? []).filter((modality) => !model.input.includes(modality));
    const missingOutput = usage.requiresOutput.filter((modality) => !model.output.includes(modality));
    if (missingInput.length > 0 || missingOutput.length > 0) {
      const requirements = [
        ...(missingInput.length > 0 ? [`输入：${missingInput.join('、')}`] : []),
        ...(missingOutput.length > 0 ? [`输出：${missingOutput.join('、')}`] : []),
      ];
      throw new BadRequestException(
        `模型 ${body.modelId} 不具备「${usage.label}」需要的模态：${requirements.join('；')}`,
      );
    }

    if (this.db) {
      const now = new Date();
      await withTransaction(this.db, async (tx) => {
        await upsertBindingRow(tx, { usageId, providerId: body.providerId!, modelId: body.modelId! }, actor, now);
        await this.audit.write(
          {
            actorId: actor,
            action: 'model_usage.bind',
            targetType: 'model_usage',
            targetId: usageId,
            detail: { providerId: body.providerId, modelId: body.modelId },
          },
          tx,
        );
      });
    }

    this.bindings.set(usageId, { providerId: body.providerId, modelId: body.modelId });
    this.logger.log(
      `用途已绑定 id=${usageId} provider=${body.providerId} model=${body.modelId} 操作者=${actor}`,
    );
    return this.toBinding(usage);
  }

  /* --------------------------- 手工模型管理 --------------------------- */

  /**
   * 手工创建一个模型（`source=manual`）。
   *
   * 约束：
   * - 供应商必须存在且启用；
   * - `modelId` / `displayName` 非空且有长度上限；
   * - 同供应商下 `modelId` 唯一，重复（含已软下线 / 自动拉取的行）→ 409；
   * - 协议缺省沿用供应商；模态只按请求声明，不猜；
   * - `AuditWriter` 与业务写入**同事务**，审计关联 `scope:key`。
   */
  async createManualModel(
    providerId: string,
    body: CreateManualModelInput,
    actor: string,
    auditIdempotencyKey: string,
  ): Promise<AdminModelResponse> {
    const state = this.providers.get(providerId);
    if (state === undefined) throw new NotFoundException(`供应商不存在：${providerId}`);
    if (!state.enabled) throw new ConflictException(`供应商已停用：${providerId}`);

    const modelId = requireModelId(body.modelId);
    const displayName = requireDisplayName(body.displayName);
    const api = normaliseApi(body.api, state.api);
    const input = normaliseModalities(body.input, 'input');
    const output = normaliseModalities(body.output, 'output');
    const contextWindow = normaliseOptionalInt(body.contextWindow, 'contextWindow');
    const maxTokens = normaliseOptionalInt(body.maxTokens, 'maxTokens');
    const enabled = normaliseEnabled(body.enabled, true);

    const inMemory = this.modelOf(state, modelId);
    if (inMemory !== undefined) {
      throw this.duplicateModelError(providerId, modelId, inMemory.source);
    }

    assertResourceNameAvailable('model', displayName, this.modelEntryIds(state).map(id => ({ id, name: this.modelEntry(state, id)!.descriptor.name })));
    const descriptor: ModelDescriptor = {
      id: modelId,
      name: displayName,
      api,
      input,
      output,
      contextWindow,
      maxTokens,
      source: 'manual',
    };

    if (this.db) {
      const now = new Date();
      try {
        await withTransaction(this.db, async (tx) => {
          const providerRow = await loadProviderRow(tx, providerId);
          if (providerRow === null) throw new NotFoundException(`供应商不存在：${providerId}`);
          if (!providerRow.enabled) throw new ConflictException(`供应商已停用：${providerId}`);
          // 内存快照只含 enabled 行，所以必须回库查，才能拦住与软下线 / 远程行重名。
          const existing = await loadModelRow(tx, providerId, modelId);
          if (existing !== null) {
            throw this.duplicateModelError(providerId, modelId, existing.source);
          }
          await insertManualModelRow(
            tx,
            { providerId, modelId, displayName, input, output, contextWindow, maxTokens, enabled },
            now,
          );
          await this.audit.write(
            {
              actorId: actor,
              action: 'model.create',
              targetType: 'model',
              targetId: modelId,
              idempotencyKey: auditIdempotencyKey,
              detail: {
                providerId,
                modelId,
                displayName,
                api,
                input,
                output,
                contextWindow,
                maxTokens,
                enabled,
                source: 'manual',
              },
            },
            tx,
          );
        });
      } catch (error) {
        // 并发插入绕过预检时，主键冲突（23505）统一翻译成 409，而不是 500。
        const nameConflict = resourceNameDatabaseConflict(error);
        if (nameConflict) throw nameConflict;
        if (isUniqueViolation(error)) throw this.duplicateModelError(providerId, modelId, null);
        throw error;
      }
    }

    this.applyModelToMemory(providerId, descriptor, enabled);
    this.logger.log(
      `手工模型已创建 provider=${providerId} model=${modelId} enabled=${enabled} 操作者=${actor}`,
    );
    return { providerId, model: descriptor, enabled, lastSeenAt: null };
  }

  /**
   * 更新手工模型的可编辑字段（`modelId` 不可变；远程模型只能靠刷新）。
   *
   * - 只有 `source=manual` 的行可编辑，远程行 → 409；
   * - 修改 `displayName` 不改变上游 `modelId`；
   * - 被用途绑定的模型不允许停用（`enabled=false`）→ 409，要求先解绑；
   * - 落库成功后同步内存快照，live 重启可从库中恢复。
   */
  async updateManualModel(
    providerId: string,
    modelIdInput: string,
    body: UpdateManualModelInput,
    actor: string,
    auditIdempotencyKey: string,
  ): Promise<AdminModelResponse> {
    const state = this.providers.get(providerId);
    if (state === undefined) throw new NotFoundException(`供应商不存在：${providerId}`);
    const modelId = requireModelId(modelIdInput);

    const displayName =
      body.displayName === undefined ? undefined : requireDisplayName(body.displayName);
    const api = body.api === undefined ? undefined : normaliseApi(body.api, state.api);
    const input = body.input === undefined ? undefined : normaliseModalities(body.input, 'input');
    const output =
      body.output === undefined ? undefined : normaliseModalities(body.output, 'output');
    const contextWindow =
      body.contextWindow === undefined
        ? undefined
        : normaliseOptionalInt(body.contextWindow, 'contextWindow');
    const maxTokens =
      body.maxTokens === undefined
        ? undefined
        : normaliseOptionalInt(body.maxTokens, 'maxTokens');
    const enabled =
      body.enabled === undefined ? undefined : normaliseEnabled(body.enabled, true);

    if (
      displayName === undefined &&
      api === undefined &&
      input === undefined &&
      output === undefined &&
      contextWindow === undefined &&
      maxTokens === undefined &&
      enabled === undefined
    ) {
      throw new BadRequestException(
        '没有可更新的字段（displayName/api/input/output/contextWindow/maxTokens/enabled）',
      );
    }

    if (displayName !== undefined) assertResourceNameAvailable('model', displayName,
      this.modelEntryIds(state).map(id => ({ id, name: this.modelEntry(state, id)!.descriptor.name })), modelId);
    const patch: ManualModelPatch = {};
    if (displayName !== undefined) patch.displayName = displayName;
    if (input !== undefined) patch.input = input;
    if (output !== undefined) patch.output = output;
    if (contextWindow !== undefined) patch.contextWindow = contextWindow;
    if (maxTokens !== undefined) patch.maxTokens = maxTokens;
    if (enabled !== undefined) patch.enabled = enabled;

    let updatedDescriptor: ModelDescriptor | null = null;
    let updatedEnabled = enabled ?? true;

    if (this.db) {
      const now = new Date();
      await withTransaction(this.db, async (tx) => {
        const providerRow = await loadProviderRow(tx, providerId);
        if (providerRow === null) throw new NotFoundException(`供应商不存在：${providerId}`);
        const row = await loadModelRow(tx, providerId, modelId);
        if (row === null) throw new NotFoundException(`模型不存在：${providerId}/${modelId}`);
        if (row.source !== 'manual') {
          throw new ConflictException(
            `模型 ${providerId}/${modelId} 来自自动拉取（remote），只能通过刷新更新，不能手工编辑`,
          );
        }
        if (enabled === false) {
          const usageIds = await listBindingUsageIdsForModel(tx, providerId, modelId);
          const agentIds = await listAgentIdsForModel(tx, providerId, modelId);
          if (usageIds.length > 0 || agentIds.length > 0) {
            throw new ConflictException(
              `模型 ${providerId}/${modelId} 已被 Agent 配置引用（${agentIds.join('、')}），请先在 AI 运行时清空模型选择`,
            );
          }
        }
        await updateManualModelRow(tx, providerId, modelId, patch, now);
        const after = await loadModelRow(tx, providerId, modelId);
        if (after === null) throw new NotFoundException(`模型不存在：${providerId}/${modelId}`);
        updatedDescriptor = this.descriptorFromRow(asModelApi(providerRow.api), after);
        updatedEnabled = after.enabled;
        await this.audit.write(
          {
            actorId: actor,
            action: 'model.update',
            targetType: 'model',
            targetId: modelId,
            idempotencyKey: auditIdempotencyKey,
            detail: {
              providerId,
              modelId,
              changed: Object.keys(patch),
              displayName: updatedDescriptor.name,
              enabled: updatedEnabled,
            },
          },
          tx,
        );
      });
    } else {
      const entry = state.manual.get(modelId);
      if (entry === undefined) throw new NotFoundException(`模型不存在：${providerId}/${modelId}`);
      updatedDescriptor = {
        ...entry.descriptor,
        ...(displayName !== undefined ? { name: displayName } : {}),
        ...(input !== undefined ? { input } : {}),
        ...(output !== undefined ? { output } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
      };
      updatedEnabled = enabled ?? entry.enabled;
    }

    if (updatedDescriptor === null) {
      throw new ServiceUnavailableException('模型更新未产生结果，请重试');
    }
    this.applyModelToMemory(providerId, updatedDescriptor, updatedEnabled);
    this.logger.log(
      `手工模型已更新 provider=${providerId} model=${modelId} enabled=${updatedEnabled} 操作者=${actor}`,
    );
    return { providerId, model: updatedDescriptor, enabled: updatedEnabled, lastSeenAt: null };
  }

  /**
   * 物理删除一个**未被绑定**的手工模型。
   *
   * 远程模型（刷新管理）与已被用途引用的模型都拒绝：前者 409，后者 409。
   * 需要「下线但保留」时改用 PATCH `enabled=false`。
   */
  async deleteManualModel(
    providerId: string,
    modelIdInput: string,
    actor: string,
    auditIdempotencyKey: string,
  ): Promise<{ providerId: string; modelId: string }> {
    const state = this.providers.get(providerId);
    if (state === undefined) throw new NotFoundException(`供应商不存在：${providerId}`);
    const modelId = requireModelId(modelIdInput);

    if (this.db) {
      await withTransaction(this.db, async (tx) => {
        const row = await loadModelRow(tx, providerId, modelId);
        if (row === null) throw new NotFoundException(`模型不存在：${providerId}/${modelId}`);
        if (row.source !== 'manual') {
          throw new ConflictException(
            `模型 ${providerId}/${modelId} 来自自动拉取（remote），不能删除；请用刷新更新`,
          );
        }
        const usageIds = await listBindingUsageIdsForModel(tx, providerId, modelId);
        const agentIds = await listAgentIdsForModel(tx, providerId, modelId);
        const frozenVersions = await listFrozenTeamVersionsForModel(tx, providerId, modelId);
        if (usageIds.length > 0 || agentIds.length > 0 || frozenVersions.length > 0) {
          throw new ConflictException(
            `模型 ${providerId}/${modelId} 仍被用途、Agent 或冻结团队版本引用，不能删除（Agent: ${agentIds.join('、') || '无'}；冻结版本: ${frozenVersions.join('、') || '无'}）`,
          );
        }
        await deleteManualModelRow(tx, providerId, modelId);
        await this.audit.write(
          {
            actorId: actor,
            action: 'model.delete',
            targetType: 'model',
            targetId: modelId,
            idempotencyKey: auditIdempotencyKey,
            detail: { providerId, modelId, displayName: row.displayName },
          },
          tx,
        );
      });
    } else if (!state.manual.has(modelId)) {
      throw new NotFoundException(`模型不存在：${providerId}/${modelId}`);
    }

    state.manual.delete(modelId);
    this.logger.log(`手工模型已删除 provider=${providerId} model=${modelId} 操作者=${actor}`);
    return { providerId, modelId };
  }

  /* --------------------------- 连接测试 --------------------------- */

  /**
   * Provider 级连接测试：用**已保存**的 `baseUrl` + 解密后的 Key + 协议适配
   * 路径，发起一次受 SSRF / 超时 / 响应体上限保护的 `/models` 探测。
   *
   * 这是「配置 / 认证 / 模型发现」连通性测试，**不是**一次推理调用。
   * 不修改任何 Provider / Model / Usage 配置，不写审计，也不落 `lastTest`
   * （schema 无该列，故只返回结果）。
   */
  async testProvider(providerId: string, actor: string): Promise<ConnectionTestResponse> {
    const testedAt = new Date().toISOString();
    const state = this.providers.get(providerId);
    if (state === undefined) throw new NotFoundException(`供应商不存在：${providerId}`);

    const blocked = this.testPreconditionError(state);
    if (blocked !== null) {
      return this.finishTest('provider', providerId, actor, this.failedTest(testedAt, blocked));
    }

    const { probe, latencyMs } = await this.executeProbe(state);
    const result = probe.ok
      ? buildConnectionTestResponse({
          ok: true,
          latencyMs,
          testedAt,
          message: `配置与鉴权连通，模型发现正常（${probe.models.length} 个模型）。${CONNECTIVITY_DISCLAIMER}`,
        })
      : this.failedTest(testedAt, probe.error ?? '探测上游模型列表失败', {
          secrets: [state.apiKey],
        });
    return this.finishTest('provider', providerId, actor, result);
  }

  /**
   * Model 级连接测试：先确认 Provider 可探测，再确认 `modelId` 出现在**已启用
   * 的已知模型**或本次可拉取的上游模型列表中。同样不执行推理。
   *
   * 未知 `modelId` → 404；已停用 → `ok=false` 明确不可用。
   */
  async testModel(
    providerId: string,
    modelIdInput: string,
    actor: string,
  ): Promise<ConnectionTestResponse> {
    const testedAt = new Date().toISOString();
    const state = this.providers.get(providerId);
    if (state === undefined) throw new NotFoundException(`供应商不存在：${providerId}`);
    const modelId = requireModelId(modelIdInput);

    const blocked = this.testPreconditionError(state);
    if (blocked !== null) {
      return this.finishTest(
        'model',
        `${providerId}/${modelId}`,
        actor,
        this.failedTest(testedAt, blocked, { modelId }),
      );
    }

    const entry = this.modelEntry(state, modelId);
    // 内存里明确停用：直接判不可用，不再对外发请求。
    if (entry !== null && !entry.enabled) {
      return this.finishTest(
        'model',
        `${providerId}/${modelId}`,
        actor,
        this.failedTest(testedAt, `模型 ${modelId} 已停用，无法测试`, { modelId }),
      );
    }

    // live：内存快照不含停用行，回库确认是否「停用」而非「不存在」。
    const dbRow = this.db ? await loadModelRow(this.db, providerId, modelId) : null;
    if (dbRow !== null && !dbRow.enabled) {
      return this.finishTest(
        'model',
        `${providerId}/${modelId}`,
        actor,
        this.failedTest(testedAt, `模型 ${modelId} 已停用，无法测试`, { modelId }),
      );
    }

    const known = entry !== null && entry.enabled;
    const { probe, latencyMs } = await this.executeProbe(state);
    const inUpstream = probe.ok && probe.models.some((model) => model.id === modelId);

    if (probe.ok && (known || dbRow !== null || inUpstream)) {
      const source =
        known && entry !== null && entry.descriptor.source === 'manual'
          ? '手工模型'
          : known
            ? '已知模型'
            : dbRow !== null
              ? '已登记模型'
              : '上游可拉取模型';
      return this.finishTest(
        'model',
        `${providerId}/${modelId}`,
        actor,
        buildConnectionTestResponse({
          ok: true,
          latencyMs,
          testedAt,
          modelId,
          message: `模型 ${modelId} 连通正常（${source}）。${CONNECTIVITY_DISCLAIMER}`,
        }),
      );
    }

    if (!probe.ok) {
      return this.finishTest(
        'model',
        `${providerId}/${modelId}`,
        actor,
        this.failedTest(testedAt, probe.error ?? '探测上游模型列表失败', {
          modelId,
          secrets: [state.apiKey],
        }),
      );
    }

    // 探测成功但没有这个模型，且库中也不存在：确实未知。
    throw new NotFoundException(`模型不存在：${providerId}/${modelId}`);
  }

  /**
   * Usage 级连接测试：**先按 `fallbackTo` 解析**出实际生效的 provider/model，
   * 再测试其连通性。未绑定（含回落）返回 `ok=false`，而不是 404。
   */
  async testUsage(usageId: string, actor: string): Promise<ConnectionTestResponse> {
    const testedAt = new Date().toISOString();
    const usage = USAGES.find((candidate) => candidate.id === usageId);
    if (usage === undefined) throw new NotFoundException(`未知的模型用途：${usageId}`);

    const binding = this.toBinding(usage);
    const resolved = binding.resolved;
    if (resolved === null) {
      return this.finishTest(
        'usage',
        usageId,
        actor,
        this.failedTest(testedAt, `用途「${usage.label}」未绑定或尚未解析到可用模型，请在 AI 运行时为 Agent 配置模型`, {
          usageId,
        }),
      );
    }

    const state = this.providers.get(resolved.providerId);
    if (state === undefined) {
      return this.finishTest(
        'usage',
        usageId,
        actor,
        this.failedTest(testedAt, `用途绑定的供应商不存在：${resolved.providerId}`, {
          usageId,
          modelId: resolved.modelId,
        }),
      );
    }

    const blocked = this.testPreconditionError(state);
    if (blocked !== null) {
      return this.finishTest(
        'usage',
        usageId,
        actor,
        this.failedTest(testedAt, blocked, { usageId, modelId: resolved.modelId }),
      );
    }

    const entry = this.modelEntry(state, resolved.modelId);
    if (entry !== null && !entry.enabled) {
      return this.finishTest(
        'usage',
        usageId,
        actor,
        this.failedTest(testedAt, `用途绑定的模型 ${resolved.modelId} 已停用，无法测试`, {
          usageId,
          modelId: resolved.modelId,
        }),
      );
    }

    const known = entry !== null && entry.enabled;
    const { probe, latencyMs } = await this.executeProbe(state);
    const inUpstream = probe.ok && probe.models.some((model) => model.id === resolved.modelId);
    const viaFallback =
      binding.providerId === null ? `回落自「${usage.fallbackTo}」` : '直接绑定';

    if (probe.ok && (known || inUpstream)) {
      return this.finishTest(
        'usage',
        usageId,
        actor,
        buildConnectionTestResponse({
          ok: true,
          latencyMs,
          testedAt,
          usageId,
          modelId: resolved.modelId,
          message: `用途「${usage.label}」经${viaFallback}解析到 ${resolved.providerId}/${resolved.modelId}，连通正常。${CONNECTIVITY_DISCLAIMER}`,
        }),
      );
    }

    if (!probe.ok) {
      return this.finishTest(
        'usage',
        usageId,
        actor,
        this.failedTest(testedAt, probe.error ?? '探测上游模型列表失败', {
          usageId,
          modelId: resolved.modelId,
          secrets: [state.apiKey],
        }),
      );
    }

    return this.finishTest(
      'usage',
      usageId,
      actor,
      this.failedTest(testedAt, `用途解析到的模型 ${resolved.modelId} 未出现在厂商模型列表中`, {
        usageId,
        modelId: resolved.modelId,
      }),
    );
  }

  /* --------------------------- 内部工具 --------------------------- */

  /** 从库中恢复内存快照；只加载 `enabled` 模型（软下线的远程模型不再对外展示）。 */
  private async hydrate(): Promise<void> {
    const db = this.db;
    if (!db) return;
    const [providerRows, modelRows, bindingRows] = await Promise.all([
      loadProviderRows(db),
      loadModelRows(db),
      loadUsageBindingRows(db),
    ]);

    let masterKey: Buffer | null = null;
    try {
      masterKey = readModelSecretKey();
    } catch (error) {
      // 主密钥存在但格式错误：这是配置错误。不因此让进程起不来，但明确告警，
      // 并在需要密钥的写操作上抛 503。
      this.logger.error(
        `QITU_MODEL_SECRET_KEY 配置无效：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.providers.clear();
    this.bindings.clear();

    for (const row of providerRows) {
      let apiKey: string | null = null;
      if (row.encryptedApiKey !== null && row.encryptedApiKey.length > 0) {
        if (masterKey === null) {
          this.logger.warn(
            `供应商 ${row.id} 存有加密密钥但未配置 QITU_MODEL_SECRET_KEY，无法解密；自动拉取将不带密钥。`,
          );
        } else {
          try {
            apiKey = decryptModelSecret(row.encryptedApiKey, masterKey);
          } catch (error) {
            this.logger.error(
              `供应商 ${row.id} 的密钥解密失败（主密钥不匹配或密文损坏）：${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      this.providers.set(row.id, {
        id: row.id,
        name: row.name,
        baseUrl: row.baseUrl,
        api: asModelApi(row.api),
        authHeader: row.authHeader,
        enabled: row.enabled,
        apiKey,
        encryptedApiKey: row.encryptedApiKey,
        keyFingerprint: row.keyFingerprint,
        fetched: new Map(),
        manual: new Map(),
        modelsFetchedAt: row.modelsFetchedAt === null ? null : row.modelsFetchedAt.toISOString(),
        lastError: row.lastError,
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedBy,
      });
    }

    for (const row of modelRows) {
      if (!row.enabled) continue;
      const state = this.providers.get(row.providerId);
      if (state === undefined) continue;
      const descriptor: ModelDescriptor = {
        id: row.modelId,
        name: row.displayName,
        api: state.api,
        input: asModalities(row.inputModalities),
        output: asModalities(row.outputModalities),
        contextWindow: row.contextWindow,
        maxTokens: row.maxTokens,
        source: row.source === 'manual' ? 'manual' : 'fetched',
      };
      const bucket = row.source === 'manual' ? state.manual : state.fetched;
      bucket.set(row.modelId, { descriptor, enabled: true });
    }

    for (const row of bindingRows) {
      this.bindings.set(row.usageId, { providerId: row.providerId, modelId: row.modelId });
    }
  }

  /**
   * 应用写请求里的 `apiKey`：
   * - 空串 = 清除密钥；
   * - 非空 = live 下必须提供 `QITU_MODEL_SECRET_KEY`，加密后落库；否则 503。
   *   内存模式（无 DB）按旧行为把明文留在进程内。
   */
  private applyApiKey(state: ProviderState, apiKey: string): void {
    if (apiKey.length === 0) {
      state.apiKey = null;
      state.encryptedApiKey = null;
      state.keyFingerprint = null;
      return;
    }

    if (this.db === null) {
      // 显式 demo/test 内存兼容；文档标注不适合 live。
      state.apiKey = apiKey;
      state.encryptedApiKey = null;
      state.keyFingerprint = fingerprintModelSecret(apiKey);
      return;
    }

    let key: Buffer | null;
    try {
      key = readModelSecretKey();
    } catch (error) {
      // 主密钥存在但格式非法：同样属于配置错误，按 503 处理，不落明文。
      throw new ServiceUnavailableException(
        `密钥存储配置无效：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (key === null) {
      throw new ServiceUnavailableException(
        '密钥存储不可用：live 模式保存 apiKey 需要配置 QITU_MODEL_SECRET_KEY（32 字节，hex 或 base64）。' +
          ' 未配置时拒绝写入，绝不落明文或假装成功。',
      );
    }
    state.apiKey = apiKey;
    state.encryptedApiKey = encryptModelSecret(apiKey, key);
    state.keyFingerprint = fingerprintModelSecret(apiKey);
  }

  /** 审计写入；内存模式无库可写，直接跳过（文档已注明 demo 不承诺审计持久化）。 */
  private async auditBestEffort(entry: AuditEntry): Promise<void> {
    if (!this.db || !this.audit) return;
    try {
      await this.audit.write(entry);
    } catch (error) {
      this.logger.warn(
        `审计写入失败（best-effort，action=${entry.action} target=${entry.targetType}/${entry.targetId}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** 从库行构造对外描述符；协议统一取供应商协议（schema 无单模型协议列）。 */
  private descriptorFromRow(api: ModelApi, row: ModelRow): ModelDescriptor {
    return {
      id: row.modelId,
      name: row.displayName,
      api,
      input: asModalities(row.inputModalities),
      output: asModalities(row.outputModalities),
      contextWindow: row.contextWindow,
      maxTokens: row.maxTokens,
      source: row.source === 'manual' ? 'manual' : 'fetched',
    };
  }

  /**
   * 写操作提交后同步内存快照：启用则写入 manual 桶，停用则从桶里移除
   * （与 `hydrate` 只加载 enabled 行的行为保持一致）。
   */
  private applyModelToMemory(
    providerId: string,
    descriptor: ModelDescriptor,
    enabled: boolean,
  ): void {
    const state = this.providers.get(providerId);
    if (state === undefined) return;
    if (enabled) state.manual.set(descriptor.id, { descriptor, enabled: true });
    else state.manual.delete(descriptor.id);
  }

  /** 统一构造「重复模型」的 409；远程重名给出去重的指引。 */
  private duplicateModelError(
    providerId: string,
    modelId: string,
    source: string | null,
  ): ConflictException {
    if (source === 'remote' || source === 'fetched') {
      return new ConflictException(
        `模型 ${providerId}/${modelId} 已由自动拉取管理（remote），不能用手工方式重复创建；如需展示请刷新，或先删除远程记录`,
      );
    }
    return new ConflictException(`模型 ${providerId}/${modelId} 已存在，不能重复创建`);
  }

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

  /** 取「可绑定的」模型：手工优先于拉取，且必须 enabled；声明能力覆盖拉取默认。 */
  private modelOf(state: ProviderState, modelId: string): ModelDescriptor | undefined {
    const entry = state.manual.get(modelId) ?? state.fetched.get(modelId);
    if (entry === undefined || !entry.enabled) return undefined;
    return this.withDeclaredCapabilities(entry.descriptor);
  }

  /**
   * 取模型条目（手工优先），**不**按 `enabled` 过滤。
   *
   * 正常流程下内存快照只保留启用行，但连接测试需要区分「停用」（明确不可用）
   * 与「不存在」（404），因此这里返回原始条目，由调用方判断 `enabled`。
   */
  private modelEntry(state: ProviderState, modelId: string): ModelEntry | null {
    return state.manual.get(modelId) ?? state.fetched.get(modelId) ?? null;
  }

  /**
   * 连接测试的**前置条件**检查（不改状态、不联网）：返回不可测原因或 `null`。
   * 停用、缺地址、已存密文但无法解密都在这里明确暴露。
   */
  private testPreconditionError(state: ProviderState): string | null {
    if (!state.enabled) return '供应商已停用，无法测试';
    if (state.baseUrl.length === 0) return '请先填写网关地址';
    if (
      state.encryptedApiKey !== null &&
      state.encryptedApiKey.length > 0 &&
      state.apiKey === null
    ) {
      return '已保存的密钥无法解密（缺少或不匹配 QITU_MODEL_SECRET_KEY），无法验证鉴权';
    }
    return null;
  }

  /**
   * 复用现有 SSRF / 超时 / 大小受限的 `/models` 探测，并计时。
   * 失败时按契约把 `latencyMs` 置为 `null`。
   */
  private async executeProbe(state: ProviderState): Promise<{
    probe: ProviderModelsProbe;
    latencyMs: number | null;
  }> {
    const started = Date.now();
    const probe = await probeProviderModels({
      baseUrl: state.baseUrl,
      api: state.api,
      apiKey: state.apiKey ?? '',
      authHeader: state.authHeader,
    });
    return { probe, latencyMs: probe.ok ? Date.now() - started : null };
  }

  /** 构造失败结果：统一 `ok=false` / `latencyMs=null` / 错误脱敏。 */
  private failedTest(
    testedAt: string,
    error: string,
    options: {
      usageId?: string | null;
      modelId?: string | null;
      secrets?: readonly (string | null | undefined)[];
    } = {},
  ): ConnectionTestResponse {
    return buildConnectionTestResponse({
      ok: false,
      latencyMs: null,
      testedAt,
      error: redactConnectionError(error, options.secrets ?? []),
      usageId: options.usageId ?? null,
      modelId: options.modelId ?? null,
    });
  }

  /** 记录连接测试结论（不写审计）；错误已脱敏，不含密钥。 */
  private finishTest(
    kind: 'provider' | 'model' | 'usage',
    target: string,
    actor: string,
    result: ConnectionTestResponse,
  ): ConnectionTestResponse {
    const meta = `kind=${kind} target=${target} actor=${actor} ok=${result.ok} latencyMs=${result.latencyMs ?? 'n/a'}`;
    if (result.ok) this.logger.log(`连接测试 ${meta}`);
    else this.logger.warn(`连接测试未通过 ${meta} 原因=${result.error ?? '未知'}`);
    return result;
  }

  private toPublic(state: ProviderState): ProviderConfigPublic {
    // 手填优先，拉取结果补充；同一 id 只出现一次；软下线的模型不展示。
    const merged = new Map<string, ModelDescriptor>();
    for (const entry of state.fetched.values()) {
      if (entry.enabled) merged.set(entry.descriptor.id, entry.descriptor);
    }
    for (const entry of state.manual.values()) {
      if (entry.enabled) merged.set(entry.descriptor.id, entry.descriptor);
    }

    const models = [...merged.values()].map((model) => this.withDeclaredCapabilities(model));

    return {
      id: state.id,
      name: state.name,
      baseUrl: state.baseUrl,
      api: state.api,
      authHeader: state.authHeader,
      enabled: state.enabled,
      auth: {
        configured: state.keyFingerprint !== null,
        keyFingerprint: state.keyFingerprint,
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
  private withDeclaredCapabilities(model: ModelDescriptor): ModelDescriptor {
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
function isAudioModel(model: Pick<ModelDescriptor, 'input' | 'output'>): boolean {
  return model.input.includes('audio') || model.output.includes('audio');
}

function voiceOperationsFor(
  input: readonly ModelModality[],
  output: readonly ModelModality[],
): ('transcribe' | 'synthesize')[] {
  const operations: ('transcribe' | 'synthesize')[] = [];
  if (input.includes('audio')) operations.push('transcribe');
  if (output.includes('audio')) operations.push('synthesize');
  return operations;
}

function normaliseBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  if (!/^https?:\/\//.test(trimmed)) {
    throw new BadRequestException('网关地址必须以 http:// 或 https:// 开头');
  }
  return trimmed.replace(/\/+$/, '');
}

/** 把任意库值收敛到三种协议之一；未知值保守回落到 openai-completions。 */
function asModelApi(value: string): ModelApi {
  return (MODEL_APIS as readonly string[]).includes(value) ? (value as ModelApi) : 'openai-completions';
}

/** 把 jsonb 模态数组收敛到合法值；空/未知回落到 `['text']`（与拉取默认一致）。 */
function asModalities(value: unknown): ModelModality[] {
  if (!Array.isArray(value)) return ['text'];
  const out = value.filter(
    (item): item is ModelModality =>
      typeof item === 'string' && (MODEL_MODALITIES as readonly string[]).includes(item),
  );
  return out.length > 0 ? out : ['text'];
}

/** 供其他地方复用的模态判断，避免各写一份。 */
export function supportsModality(model: ModelDescriptor, modality: ModelModality): boolean {
  return model.input.includes(modality) || model.output.includes(modality);
}

/** Postgres 唯一约束冲突（重复主键 / 唯一索引）。 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
}
