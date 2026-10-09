import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Optional, Param, Patch, Post } from '@nestjs/common';
import type {
  AdminModelResponse,
  AdminModelUsagesResponse,
  AdminProvidersResponse,
  BindUsageRequest,
  ConnectionTestResponse,
  CreateManualModelRequest,
  ModelUsageBinding,
  ProviderConfigPublic,
  RefreshProviderResponse,
  UpdateManualModelRequest,
  UpsertProviderRequest,
} from '@qitu/contracts';
import { pickFields, requireRole } from '../../common/access/request-auth';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { AuthService } from '../identity-auth/auth.service';
import {
  ModelRegistryService,
  type CreateManualModelInput,
  type UpdateManualModelInput,
} from './model-registry.service';
import { QwenVoiceGatewayService } from './qwen-voice-gateway.service';
import { resolveIdempotencyKey } from './manual-model.validation';
import { readPiImportManifest, sanitisePiImportBaseUrl, type PiImportManifest, type PiImportModel, type PiImportProvider, type PiImportResult } from './pi-import';

/**
 * 管理员端「模型接入」接口。
 *
 * 三条产品规则体现在这里的接口形状上：
 *  - **供应商 / 模型 / 用途分开**，所以有三个资源而不是一个大表单。
 *  - **拉取是显式动作**（`POST :id/refresh`），不是保存时的副作用：
 *    管理员应当能保留已配好的模型列表，哪怕上游临时不可达。
 *  - 全部写接口只对 `admin` 开放，且密钥永不回显。
 */
@Controller()
export class ModelRegistryController {
  constructor(
    private readonly registry: ModelRegistryService,
    private readonly authService: AuthService,
    private readonly idempotency: IdempotencyStore,
    @Optional() private readonly voice?: QwenVoiceGatewayService,
  ) {}

  /** 供应商列表 + 预置模板（不区分是否已配置）。 */
  @Get('admin/model-providers')
  listProviders(@Headers('cookie') cookieHeader: string | undefined): { data: AdminProvidersResponse } {
    requireAdmin(this.authService, cookieHeader);
    return { data: this.registry.listProviders() };
  }

  @Post('admin/model-providers/:id')
  async upsertProvider(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Param('id') id: string,
    @Body() body: UpsertProviderRequest,
  ): Promise<{ data: ProviderConfigPublic }> {
    const admin = requireAdmin(this.authService, cookieHeader);
    const key = resolveIdempotencyKey(idempotencyHeader, undefined);
    const scope = `admin.model-registry.provider.upsert:${id}`;
    try {
      const result = await this.idempotency.execute(scope, key, hashIdempotentInput(scope, {}, sanitiseProvider(body)), async () => ({ body: await this.registry.upsertProvider(id, sanitiseProvider(body), admin.id) }));
      return { data: result.body };
    } catch (error) { throwHttpForIdempotencyError(error); }
  }

  @Delete('admin/model-providers/:id')
  async deleteProvider(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: { id: string } }> {
    const admin = requireAdmin(this.authService, cookieHeader);
    const key = resolveIdempotencyKey(idempotencyHeader, undefined);
    const scope = `admin.model-registry.provider.delete:${id}`;
    try {
      const result = await this.idempotency.execute(scope, key, hashIdempotentInput(scope, {}, {}), async () => ({ body: await this.registry.deleteProvider(id, admin.id) }));
      return { data: result.body };
    } catch (error) { throwHttpForIdempotencyError(error); }
  }

  /**
   * 手工创建一个模型（`source=manual`，`modelId` 在供应商内唯一）。
   *
   * 幂等：优先 `Idempotency-Key` 请求头，兼容请求体 `idempotencyKey`；两者不一致
   * 时 400。scope 含 providerId，避免同一个 key 跨供应商误判为重放。业务写入与
   * `model.create` 审计在同一事务。
   */
  @Post('admin/model-providers/:providerId/models')
  async createManualModel(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Param('providerId') providerId: string,
    @Body() body: CreateManualModelRequest,
  ): Promise<{ data: AdminModelResponse }> {
    const admin = requireAdmin(this.authService, cookieHeader);
    const idempotencyKey = resolveIdempotencyKey(idempotencyHeader, body?.idempotencyKey);
    const input = sanitiseManualModelCreate(body);
    const scope = `admin.model-registry.model.create:${providerId}`;
    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        hashIdempotentInput(scope, {}, input),
        async () => ({
          status: 201,
          body: await this.registry.createManualModel(
            providerId,
            input,
            admin.id,
            `${scope}:${idempotencyKey}`,
          ),
        }),
      );
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /**
   * 更新手工模型的可编辑字段；`modelId` 来自路径且不可变（body 里的 `modelId`
   * 会被白名单丢弃）。被用途绑定的模型不允许停用 → 409。
   */
  @Patch('admin/model-providers/:providerId/models/:modelId')
  async updateManualModel(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Param('providerId') providerId: string,
    @Param('modelId') modelId: string,
    @Body() body: UpdateManualModelRequest,
  ): Promise<{ data: AdminModelResponse }> {
    const admin = requireAdmin(this.authService, cookieHeader);
    const idempotencyKey = resolveIdempotencyKey(idempotencyHeader, body?.idempotencyKey);
    const input = sanitiseManualModelUpdate(body);
    const scope = `admin.model-registry.model.update:${providerId}:${modelId}`;
    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        hashIdempotentInput(scope, {}, input),
        async () => ({
          body: await this.registry.updateManualModel(
            providerId,
            modelId,
            input,
            admin.id,
            `${scope}:${idempotencyKey}`,
          ),
        }),
      );
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /**
   * 删除**未被绑定**的手工模型。远程模型只能刷新；已绑定的模型返回 409。
   * 这是物理删除，需要 `Idempotency-Key` 请求头（DELETE 无契约 body）。
   */
  @Delete('admin/model-providers/:providerId/models/:modelId')
  async deleteManualModel(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Param('providerId') providerId: string,
    @Param('modelId') modelId: string,
  ): Promise<{ data: { providerId: string; modelId: string } }> {
    const admin = requireAdmin(this.authService, cookieHeader);
    const idempotencyKey = resolveIdempotencyKey(idempotencyHeader, undefined);
    const scope = `admin.model-registry.model.delete:${providerId}:${modelId}`;
    try {
      const result = await this.idempotency.execute(
        scope,
        idempotencyKey,
        hashIdempotentInput(scope, {}, {}),
        async () => ({
          body: await this.registry.deleteManualModel(
            providerId,
            modelId,
            admin.id,
            `${scope}:${idempotencyKey}`,
          ),
        }),
      );
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /**
   * 自动拉取上游模型列表。
   *
   * 用 POST 而不是 GET：这会对外发起请求、改变服务端状态，不该被预取或缓存。
   * 拉取失败**不返回 4xx/5xx**，而是把原因放在 `provider.lastError` 里，
   * 让管理员看到「已保存的配置 + 失败原因」，而不是整页崩掉。
   */
  @Post('admin/model-providers/:id/refresh')
  @HttpCode(200)
  async refreshProvider(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: RefreshProviderResponse }> {
    const admin = requireAdmin(this.authService, cookieHeader);
    return { data: await this.registry.refreshProvider(id, admin.id) };
  }

  /**
   * Import a redacted pi provider/model manifest. The desktop must send
   * metadata only; credentials stay in the server-side provider upsert flow.
   * Unknown fields (including apiKey/token/auth) are intentionally ignored.
   */
  @Post('admin/model-providers/import/pi')
  async importPiManifest(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Body() body: unknown,
  ): Promise<{ data: PiImportResult }> {
    const admin = requireAdmin(this.authService, cookieHeader);
    const input = parsePiImport(body, idempotencyHeader);
    const scope = 'admin.model-registry.import.pi';
    try {
      const result = await this.idempotency.execute(
        scope,
        input.idempotencyKey,
        hashIdempotentInput(scope, { actorId: admin.id }, input.manifest),
        async () => ({
          status: 200,
          body: await this.withVoiceDefault(await this.registry.importPiManifest(input.manifest, admin.id), admin.id),
        }),
      );
      return { data: result.body };
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /** Read a server-mounted QITU_PI_CONFIG_DIR (models*.json + auth.json). */
  @Post('admin/model-providers/import/pi/server')
  async importPiServerConfig(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
  ): Promise<{ data: PiImportResult }> {
    const admin = requireAdmin(this.authService, cookieHeader);
    const key = resolveIdempotencyKey(idempotencyHeader, undefined);
    const scope = 'admin.model-registry.import.pi.server';
    try {
      const result = await this.idempotency.execute(
        scope,
        key,
        hashIdempotentInput(scope, { actorId: admin.id, configDir: process.env.QITU_PI_CONFIG_DIR ?? null }, {}),
        async () => ({
          status: 200,
          body: await this.withVoiceDefault(await this.registry.importPiConfigFromDirectory(admin.id), admin.id),
        }),
      );
      return { data: result.body };
    } catch (error) {
      throwPiImportConfigError(error);
    }
  }

  /** Read-only audio-capable catalog; no credentials are returned. */
  @Get('admin/model-voice')
  async listVoiceModels(@Headers('cookie') cookieHeader: string | undefined) {
    requireAdmin(this.authService, cookieHeader);
    return { data: await (this.voice?.listModels() ?? Promise.resolve(this.registry.listVoiceModels())) };
  }

  private async withVoiceDefault(result: PiImportResult, actor: string): Promise<PiImportResult> {
    await this.voice?.refreshAvailableModels(actor);
    return { ...result, defaultVoiceModel: await (this.voice?.defaultModel() ?? Promise.resolve(null)) };
  }

  /** 用途列表与当前绑定（含回落后的实际生效模型）。 */
  @Get('admin/model-usages')
  listUsages(@Headers('cookie') cookieHeader: string | undefined): { data: AdminModelUsagesResponse } {
    requireAdmin(this.authService, cookieHeader);
    return { data: this.registry.getUsages() };
  }

  @Patch('admin/model-usages/:usageId')
  async bindUsage(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Param('usageId') usageId: string,
    @Body() body: BindUsageRequest,
  ): Promise<{ data: ModelUsageBinding }> {
    const admin = requireAdmin(this.authService, cookieHeader);
    const key = resolveIdempotencyKey(idempotencyHeader, undefined);
    const input = sanitiseBinding(body);
    const scope = `admin.model-registry.usage.bind:${usageId}`;
    try {
      const result = await this.idempotency.execute(scope, key, hashIdempotentInput(scope, {}, input), async () => ({ body: await this.registry.bindUsage(usageId, input, admin.id) }));
      return { data: result.body };
    } catch (error) { throwHttpForIdempotencyError(error); }
  }

  /**
   * Provider 级连接测试。
   *
   * 用已保存的 `baseUrl` + Key + 协议发起最小 `/models` 探测，验证**配置 /
   * 认证 / 模型发现**；不执行推理。测试失败（网络 / 鉴权 / 上游）返回
   * `200 + ok=false`，不让整页 5xx；未知供应商 404。
   */
  @Post('admin/model-providers/:providerId/test')
  @HttpCode(200)
  async testProvider(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('providerId') providerId: string,
  ): Promise<{ data: ConnectionTestResponse }> {
    const admin = requireAdmin(this.authService, cookieHeader);
    return { data: await this.registry.testProvider(providerId, admin.id) };
  }

  /**
   * Model 级连接测试：探测 Provider 并确认目标 `modelId` 在已知 / 可拉取
   * 模型或手工模型中。未知模型 404，已停用模型返回 `ok=false`。
   */
  @Post('admin/model-providers/:providerId/models/:modelId/test')
  @HttpCode(200)
  async testModel(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('providerId') providerId: string,
    @Param('modelId') modelId: string,
  ): Promise<{ data: ConnectionTestResponse }> {
    const admin = requireAdmin(this.authService, cookieHeader);
    return { data: await this.registry.testModel(providerId, modelId, admin.id) };
  }

  /**
   * Usage 级连接测试：先按 `fallbackTo` 解析出实际生效的 provider/model，
   * 再测试其连通性。未绑定 / 无回落返回 `ok=false`；未知用途 404。
   */
  @Post('admin/model-usages/:usageId/test')
  @HttpCode(200)
  async testUsage(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('usageId') usageId: string,
  ): Promise<{ data: ConnectionTestResponse }> {
    const admin = requireAdmin(this.authService, cookieHeader);
    return { data: await this.registry.testUsage(usageId, admin.id) };
  }
}

function requireAdmin(authService: AuthService, cookieHeader: string | undefined) {
  return requireRole(authService, cookieHeader, 'admin', '模型接入配置仅向管理员开放');
}

function throwPiImportConfigError(error: unknown): never {
  if (error instanceof Error) {
    const code = error.message;
    if (code === 'PI_CONFIG_NOT_CONFIGURED' || code === 'PI_CONFIG_INVALID' || code === 'PI_CONFIG_EMPTY') {
      throw new BadRequestException({
        code,
        message:
          code === 'PI_CONFIG_NOT_CONFIGURED'
            ? '服务器没有配置 Pi 导入目录'
            : code === 'PI_CONFIG_EMPTY'
              ? 'Pi 配置中没有可导入的供应商'
              : 'Pi 配置文件无效，未执行导入',
      });
    }
  }
  throwHttpForIdempotencyError(error);
}

interface ParsedPiImport {
  idempotencyKey: string;
  manifest: PiImportManifest;
}

function parsePiImport(body: unknown, headerKey: string | undefined): ParsedPiImport {
  const value = body !== null && typeof body === 'object' ? body as Record<string, unknown> : {};
  const rawKey = typeof value.idempotencyKey === 'string' ? value.idempotencyKey : headerKey;
  if (!rawKey || rawKey.trim().length === 0 || rawKey.length > 160) {
    throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少 Idempotency-Key' });
  }
  const providersValue = Array.isArray(value.providers) ? value.providers : [];
  if (providersValue.length === 0 || providersValue.length > 100) throw new BadRequestException('providers 数量无效');
  const providers = providersValue.map((entry, index) => parsePiProvider(entry, index));
  return { idempotencyKey: rawKey.trim(), manifest: { providers } };
}

function parsePiProvider(value: unknown, index: number): PiImportProvider {
  if (!value || typeof value !== 'object') throw new BadRequestException(`providers[${index}] 无效`);
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const baseUrl = sanitisePiImportBaseUrl(row.baseUrl);
  const models = Array.isArray(row.models) ? row.models : [];
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/iu.test(id)) throw new BadRequestException(`providers[${index}].id 无效`);
  if (baseUrl === null || baseUrl.length > 500) throw new BadRequestException(`providers[${index}].baseUrl 无效`);
  if (models.length > 500) throw new BadRequestException(`providers[${index}].models 数量无效`);
  return {
    id,
    name: typeof row.name === 'string' ? row.name.slice(0, 120) : undefined,
    baseUrl,
    api: isModelApi(row.api) ? row.api : undefined,
    authHeader: typeof row.authHeader === 'boolean' ? row.authHeader : undefined,
    models: models.map((model, modelIndex) => parsePiModel(model, modelIndex, id)),
  };
}

function parsePiModel(value: unknown, index: number, providerId: string): PiImportModel {
  if (!value || typeof value !== 'object') throw new BadRequestException(`${providerId}.models[${index}] 无效`);
  const row = value as Record<string, unknown>;
  const modelId = typeof row.modelId === 'string' ? row.modelId.trim() : '';
  if (modelId.length < 1 || modelId.length > 200) throw new BadRequestException(`${providerId}.models[${index}].modelId 无效`);
  return {
    modelId,
    displayName: typeof row.displayName === 'string' ? row.displayName.slice(0, 200) : undefined,
    api: isModelApi(row.api) ? row.api : undefined,
    input: parseModalities(row.input),
    output: parseModalities(row.output),
    contextWindow: parseOptionalNumber(row.contextWindow),
    maxTokens: parseOptionalNumber(row.maxTokens),
  };
}

function parseModalities(value: unknown): Array<'text' | 'image' | 'audio'> | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set(['text', 'image', 'audio']);
  const result = [...new Set(value.filter((item): item is 'text' | 'image' | 'audio' => typeof item === 'string' && allowed.has(item)))];
  return result.length > 0 ? result : undefined;
}

function parseOptionalNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isModelApi(value: unknown): value is PiImportProvider['api'] {
  return value === 'openai-completions' || value === 'openai-responses' || value === 'anthropic-messages';
}

/**
 * 白名单：只允许契约声明过的字段。
 * `id` 来自路径，不从请求体取，避免 body 里的 id 与路径不一致。
 */
function sanitiseProvider(body: UpsertProviderRequest | undefined): UpsertProviderRequest {
  if (body === null || typeof body !== 'object') return {};
  const out: UpsertProviderRequest = {};
  if (typeof body.name === 'string') out.name = body.name;
  if (typeof body.baseUrl === 'string') out.baseUrl = body.baseUrl;
  if (body.api === 'openai-completions' || body.api === 'openai-responses' || body.api === 'anthropic-messages') {
    out.api = body.api;
  }
  if (typeof body.authHeader === 'boolean') out.authHeader = body.authHeader;
  if (typeof (body as UpsertProviderRequest & { enabled?: unknown }).enabled === 'boolean') {
    (out as UpsertProviderRequest & { enabled?: boolean }).enabled = (body as UpsertProviderRequest & { enabled: boolean }).enabled;
  }
  // 明文密钥只在这里被读取一次，随后由 service 加密落库并只对外暴露指纹。
  if (typeof body.apiKey === 'string') out.apiKey = body.apiKey;
  return out;
}

function sanitiseBinding(body: BindUsageRequest | undefined): BindUsageRequest {
  if (body === null || typeof body !== 'object') return { providerId: null, modelId: null };
  return {
    providerId: typeof body.providerId === 'string' ? body.providerId : null,
    modelId: typeof body.modelId === 'string' ? body.modelId : null,
  };
}

/**
 * 手工模型创建白名单。`source` / `id` / `updatedAt` 等服务端字段不允许从 body 塞入。
 * 取值范围校验由服务层的纯函数完成（这里只保证「不携带未知字段」）。
 */
function sanitiseManualModelCreate(
  body: CreateManualModelRequest | undefined,
): CreateManualModelInput {
  return pickFields<CreateManualModelInput>(body, [
    'modelId',
    'displayName',
    'api',
    'input',
    'output',
    'contextWindow',
    'maxTokens',
    'enabled',
  ]);
}

/** 手工模型更新白名单；刻意不包含 `modelId`（路径参数才是指纹来源）。 */
function sanitiseManualModelUpdate(
  body: UpdateManualModelRequest | undefined,
): UpdateManualModelInput {
  return pickFields<UpdateManualModelInput>(body, [
    'displayName',
    'api',
    'input',
    'output',
    'contextWindow',
    'maxTokens',
    'enabled',
  ]);
}
