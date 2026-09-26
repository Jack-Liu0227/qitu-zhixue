import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type {
  AdminModelUsagesResponse,
  AdminProvidersResponse,
  BindUsageRequest,
  RefreshProviderResponse,
  UpsertProviderRequest,
} from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { ModelRegistryService } from './model-registry.service';

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
  ) {}

  /** 供应商列表 + 预置模板（不区分是否已配置）。 */
  @Get('admin/model-providers')
  listProviders(@Headers('cookie') cookieHeader: string | undefined): { data: AdminProvidersResponse } {
    requireAdmin(this.authService, cookieHeader);
    return { data: this.registry.listProviders() };
  }

  @Post('admin/model-providers/:id')
  upsertProvider(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
    @Body() body: UpsertProviderRequest,
  ) {
    const admin = requireAdmin(this.authService, cookieHeader);
    return { data: this.registry.upsertProvider(id, sanitiseProvider(body), admin.id) };
  }

  @Delete('admin/model-providers/:id')
  deleteProvider(@Headers('cookie') cookieHeader: string | undefined, @Param('id') id: string) {
    requireAdmin(this.authService, cookieHeader);
    return { data: this.registry.deleteProvider(id) };
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
    requireAdmin(this.authService, cookieHeader);
    return { data: await this.registry.refreshProvider(id) };
  }

  /** 用途列表与当前绑定（含回落后的实际生效模型）。 */
  @Get('admin/model-usages')
  listUsages(@Headers('cookie') cookieHeader: string | undefined): { data: AdminModelUsagesResponse } {
    requireAdmin(this.authService, cookieHeader);
    return { data: this.registry.getUsages() };
  }

  @Patch('admin/model-usages/:usageId')
  bindUsage(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('usageId') usageId: string,
    @Body() body: BindUsageRequest,
  ) {
    const admin = requireAdmin(this.authService, cookieHeader);
    return { data: this.registry.bindUsage(usageId, sanitiseBinding(body), admin.id) };
  }
}

function requireAdmin(authService: AuthService, cookieHeader: string | undefined) {
  return requireRole(authService, cookieHeader, 'admin', '模型接入配置仅向管理员开放');
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
  // 明文密钥只在这里被读取一次，随后由 service 转成指纹。
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
