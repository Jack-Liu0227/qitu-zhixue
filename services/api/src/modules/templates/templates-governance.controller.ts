import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { pickFields, requireAnyRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import {
  TemplateGovernanceService,
  type PublishVersionResult,
  type TemplateMutationResult,
  type VerifyVersionResult,
  type VersionMutationResult,
} from './templates-governance.service';
import type {
  CreateTemplateInput,
  CreateTemplateVersionInput,
  TemplateView,
  UpdateTemplateInput,
} from './templates.types';

/**
 * 模板治理写接口（Admin / 授权教职工）。
 *
 * ```http
 * GET    /api/v1/admin/project-templates
 * POST   /api/v1/admin/project-templates
 * PATCH  /api/v1/admin/project-templates/:id
 * POST   /api/v1/admin/project-templates/:id/versions
 * POST   /api/v1/admin/project-templates/:id/versions/:versionId/verify
 * POST   /api/v1/admin/project-templates/:id/versions/:versionId/publish
 * POST   /api/v1/admin/project-templates/:id/archive
 * POST   /api/v1/admin/project-templates/:id/rollback
 * ```
 *
 * 设计要点：
 * - 角色闸门（admin / teacher）在控制器；对象级作用域在服务层 `assertCanGovernTemplate`；
 * - 请求体经 `pickFields` 白名单，客户端塞不进 `status` / `verifiedAt` / 证据 / 时间戳；
 * - 每个写接口都要求 `Idempotency-Key`。
 */
@Controller('admin/project-templates')
export class TemplateGovernanceController {
  constructor(
    private readonly governance: TemplateGovernanceService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(
    @Headers('cookie') cookieHeader: string | undefined,
  ): Promise<{ data: TemplateView[] }> {
    const actor = this.requireGovernanceActor(cookieHeader);
    return { data: await this.governance.listGovernedTemplates(actor) };
  }

  @Post()
  async create(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<{ data: TemplateMutationResult }> {
    const actor = this.requireGovernanceActor(cookieHeader);
    const request = pickFields<CreateTemplateInput>(body, [
      'schoolId',
      'slug',
      'title',
      'summary',
      'domain',
      'ageRange',
      'difficulty',
      'estimatedDurationMinutes',
      'requiredMaterials',
      'learningObjectives',
      'outcomeForm',
      'safetyNotes',
    ]);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.governance.createTemplate(actor, request, key) };
  }

  @Patch(':id')
  @HttpCode(200)
  async update(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ data: TemplateMutationResult }> {
    const actor = this.requireGovernanceActor(cookieHeader);
    const request = pickFields<UpdateTemplateInput>(body, [
      'title',
      'summary',
      'domain',
      'ageRange',
      'difficulty',
      'estimatedDurationMinutes',
      'requiredMaterials',
      'learningObjectives',
      'outcomeForm',
      'safetyNotes',
    ]);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.governance.updateTemplate(actor, id, request, key) };
  }

  @Post(':id/versions')
  async createVersion(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ data: VersionMutationResult }> {
    const actor = this.requireGovernanceActor(cookieHeader);
    const request = pickFields<CreateTemplateVersionInput>(body, ['stages', 'content', 'rubric']);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.governance.createVersion(actor, id, request, key) };
  }

  @Post(':id/versions/:versionId/verify')
  @HttpCode(200)
  async verifyVersion(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ): Promise<{ data: VerifyVersionResult }> {
    const actor = this.requireGovernanceActor(cookieHeader);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.governance.verifyVersion(actor, id, versionId, key) };
  }

  @Post(':id/versions/:versionId/publish')
  @HttpCode(200)
  async publishVersion(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ): Promise<{ data: PublishVersionResult }> {
    const actor = this.requireGovernanceActor(cookieHeader);
    const request = pickFields<{ reason?: string | null }>(body, ['reason']);
    const key = requireIdempotencyKey(idempotencyKey);
    return {
      data: await this.governance.publishVersion(
        actor,
        id,
        versionId,
        key,
        normalizeReason(request.reason),
      ),
    };
  }

  @Post(':id/archive')
  @HttpCode(200)
  async archive(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ data: TemplateMutationResult }> {
    const actor = this.requireGovernanceActor(cookieHeader);
    const request = pickFields<{ reason?: string | null }>(body, ['reason']);
    const key = requireIdempotencyKey(idempotencyKey);
    return {
      data: await this.governance.archiveTemplate(
        actor,
        id,
        key,
        normalizeReason(request.reason),
      ),
    };
  }

  @Post(':id/rollback')
  @HttpCode(201)
  async rollback(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ data: VersionMutationResult }> {
    const actor = this.requireGovernanceActor(cookieHeader);
    const request = pickFields<{ sourceVersionId?: string; reason?: string | null }>(body, [
      'sourceVersionId',
      'reason',
    ]);
    if (typeof request.sourceVersionId !== 'string' || request.sourceVersionId.trim().length === 0) {
      throw new BadRequestException({
        code: 'TEMPLATE_INPUT_INVALID',
        message: 'sourceVersionId 必填',
      });
    }
    const key = requireIdempotencyKey(idempotencyKey);
    return {
      data: await this.governance.rollbackTemplate(
        actor,
        id,
        request.sourceVersionId.trim(),
        key,
        normalizeReason(request.reason),
      ),
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

function normalizeReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length === 0 ? null : value.slice(0, 500);
}
