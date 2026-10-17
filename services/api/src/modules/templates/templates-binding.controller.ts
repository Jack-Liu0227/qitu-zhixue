import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import type { AdminBindingMutationResponse, AdminBindingPreview, CurrentUser } from '@qitu/contracts';
import { pickFields, requireAnyRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { TemplateBindingService } from './templates-binding.service';

/**
 * 模板版本 ↔ 团队版本绑定治理接口（F2，Admin / 授权教职工）。
 *
 * ```http
 * GET  /api/v1/admin/project-templates/:id/versions/:versionId/bindings/preview
 * POST /api/v1/admin/project-templates/:id/versions/:versionId/bindings
 * POST /api/v1/admin/project-templates/:id/versions/:versionId/bindings/:bindingId/validate
 * POST /api/v1/admin/project-templates/:id/versions/:versionId/bindings/:bindingId/activate
 * POST /api/v1/admin/project-templates/:id/versions/:versionId/bindings/:bindingId/retire
 * ```
 *
 * 设计要点：
 * - 角色闸门与模板治理控制器一致（admin / teacher）；对象级作用域在服务层
 *   `assertCanGovernTemplate`；
 * - 请求体经 `pickFields` 白名单，客户端塞不进 `id` / `status` / `bindingHash` /
 *   `validation` / 时间戳；校验 / 激活请求体为空；
 * - create / validate / activate / retire 都要求 `Idempotency-Key` 头。
 */
@Controller('admin/project-templates')
export class TemplateBindingController {
  constructor(
    private readonly bindings: TemplateBindingService,
    private readonly auth: AuthService,
  ) {}

  @Get(':id/versions/:versionId/bindings/preview')
  async preview(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ): Promise<{ data: AdminBindingPreview }> {
    const actor = this.requireGovernanceActor(cookieHeader);
    return { data: await this.bindings.previewBindings(actor, id, versionId) };
  }

  @Post(':id/versions/:versionId/bindings')
  async create(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ): Promise<AdminBindingMutationResponse> {
    const actor = this.requireGovernanceActor(cookieHeader);
    const request = pickFields<{ teamVersionId?: string }>(body, ['teamVersionId']);
    if (typeof request.teamVersionId !== 'string' || request.teamVersionId.trim().length === 0) {
      throw new BadRequestException({
        code: 'BINDING_INVALID',
        message: 'teamVersionId 必填',
      });
    }
    const key = requireIdempotencyKey(idempotencyKey);
    return {
      data: await this.bindings.createBinding(
        actor,
        id,
        versionId,
        { teamVersionId: request.teamVersionId.trim() },
        key,
      ),
    };
  }

  @Post(':id/versions/:versionId/bindings/:bindingId/validate')
  @HttpCode(200)
  async validate(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Param('bindingId') bindingId: string,
  ): Promise<AdminBindingMutationResponse> {
    const actor = this.requireGovernanceActor(cookieHeader);
    const key = requireIdempotencyKey(idempotencyKey);
    return {
      data: await this.bindings.validateBinding(actor, id, versionId, bindingId, key),
    };
  }

  @Post(':id/versions/:versionId/bindings/:bindingId/activate')
  @HttpCode(200)
  async activate(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Param('bindingId') bindingId: string,
  ): Promise<AdminBindingMutationResponse> {
    const actor = this.requireGovernanceActor(cookieHeader);
    const key = requireIdempotencyKey(idempotencyKey);
    return {
      data: await this.bindings.activateBinding(actor, id, versionId, bindingId, key),
    };
  }

  @Post(':id/versions/:versionId/bindings/:bindingId/retire')
  @HttpCode(200)
  async retire(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Param('bindingId') bindingId: string,
    @Body() body: unknown,
  ): Promise<AdminBindingMutationResponse> {
    const actor = this.requireGovernanceActor(cookieHeader);
    const request = pickFields<{ reason?: string }>(body, ['reason']);
    const key = requireIdempotencyKey(idempotencyKey);
    return {
      data: await this.bindings.retireBinding(actor, id, versionId, bindingId, request, key),
    };
  }

  private requireGovernanceActor(cookieHeader: string | undefined): CurrentUser {
    const user = requireAnyRole(this.auth, cookieHeader);
    if (user.role !== 'admin' && user.role !== 'teacher') {
      throw new ForbiddenException('模板治理仅向管理员 / 授权教职工开放');
    }
    return user;
  }
}

function requireIdempotencyKey(raw: string | undefined): string {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (key.length === 0) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: '该接口必须携带 Idempotency-Key 请求头',
    });
  }
  return key;
}
