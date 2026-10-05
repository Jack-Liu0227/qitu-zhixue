import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Param, Patch } from '@nestjs/common';
import type {
  AdminModelsResponse,
  ModelConfigPublic,
  ModelRuntimeResponse,
  ModelSlot,
  UpdateModelConfigRequest,
} from '@qitu/contracts';
import { requireAnyRole, requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { ModelConfigService } from './model-config.service';
import { ModelRegistryService } from '../model-registry/model-registry.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';

const SLOTS = new Set<ModelSlot>(['text', 'live']);

/**
 * 「我的模型 / Live 模型」配置接口。
 *
 * - 写接口只对 `admin` 开放：模型与密钥属于平台级配置，任何学生/家长/班主任
 *   都不得改动。
 * - 读运行时信息对所有已登录角色开放，且只返回模型标识，不含任何密钥材料。
 *
 * 注意：`apiKey` 会出现在请求体里，但**不会**出现在任何响应、日志或错误
 * 信息里；对外只给不可逆指纹（见 `ModelConfigService`）。
 */
@Controller()
export class ModelConfigController {
  constructor(
    private readonly models: ModelConfigService,
    private readonly registry: ModelRegistryService,
    private readonly authService: AuthService,
    private readonly idempotency: IdempotencyStore,
  ) {}

  @Get('admin/models')
  getAdminModels(@Headers('cookie') cookieHeader: string | undefined): { data: AdminModelsResponse } {
    requireRole(this.authService, cookieHeader, 'admin', '模型配置仅向管理员开放');
    return { data: { slots: this.models.listPublic(), options: this.models.getOptions() } };
  }

  @Patch('admin/models/:slot')
  updateModel(
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
    const scope = `legacy-model-config:${slot}`;
    const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, sanitiseBody(body), {}), async () => ({ status: 200, body: this.models.update(slot as ModelSlot, sanitiseBody(body), admin.id) }));
    return { data: result.body };
  }

  /** 学生端 / 家长端 / 班主任端用来显示「当前跑的是哪个模型、Live 能不能用」。 */
  @Get('models/runtime')
  getRuntime(@Headers('cookie') cookieHeader: string | undefined): { data: ModelRuntimeResponse } {
    requireAnyRole(this.authService, cookieHeader);
    return { data: this.registry.getRuntimeSummary() };
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
