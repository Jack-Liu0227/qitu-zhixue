import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import type { AdminBindingMutationResponse, AdminBindingPreview, CurrentUser } from '@qitu/contracts';
import type { TeachingBundleDraft } from '@qitu/contracts';
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

  @Get(':id/versions/:versionId/bindings/:bindingId/teaching-bundle')
  async teachingBundle(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Param('bindingId') bindingId: string,
  ) {
    const actor = this.requireGovernanceActor(cookieHeader);
    return { data: await this.bindings.getTeachingBundle(actor, id, versionId, bindingId) };
  }

  @Patch(':id/versions/:versionId/bindings/:bindingId/teaching-bundle')
  @HttpCode(200)
  async patchTeachingBundle(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Param('bindingId') bindingId: string,
    @Body() body: unknown,
  ): Promise<AdminBindingMutationResponse> {
    const actor = this.requireGovernanceActor(cookieHeader);
    const key = requireIdempotencyKey(idempotencyKey);
    const draft = parseTeachingBundleDraft(body);
    return { data: await this.bindings.saveTeachingBundleDraft(actor, id, versionId, bindingId, draft, key) };
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

function parseTeachingBundleDraft(body: unknown): TeachingBundleDraft {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException({ code: 'BUNDLE_DRAFT_INVALID', message: 'Teaching Bundle 草稿必须为对象' });
  }
  const value = body as Record<string, unknown>;
  const requiredStrings = ['templateVersionId', 'teamVersionId', 'scheduleProfileId', 'approvalPolicyVersion'] as const;
  for (const key of requiredStrings) {
    if (typeof value[key] !== 'string' || !(value[key] as string).trim()) {
      throw new BadRequestException({ code: 'BUNDLE_DRAFT_INVALID', message: `${key} 必填` });
    }
  }
  const arrays = ['roleMap', 'skillPins', 'toolIds', 'mcpServerIds', 'knowledgeBaseIds'] as const;
  for (const key of arrays) if (!Array.isArray(value[key])) {
    throw new BadRequestException({ code: 'BUNDLE_DRAFT_INVALID', message: `${key} 必须为数组` });
  }
  if (value.modelByPurpose === null || typeof value.modelByPurpose !== 'object' || Array.isArray(value.modelByPurpose)) {
    throw new BadRequestException({ code: 'BUNDLE_DRAFT_INVALID', message: 'modelByPurpose 必须为对象' });
  }
  // Do not accept instructions, URLs, credentials or resolved tool payloads.
  const allowed = new Set([...requiredStrings, ...arrays, 'modelByPurpose']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new BadRequestException({ code: 'BUNDLE_DRAFT_INVALID', message: '草稿包含非 canonical 引用字段' });
  }
  const roleMap = (value.roleMap as unknown[]).map((item, index) => {
    const row = draftRecord(item, `roleMap[${index}]`);
    exactKeys(row, ['roleSlotId', 'memberId', 'purposes'], `roleMap[${index}]`);
    const roleSlotId = draftId(row.roleSlotId, `roleMap[${index}].roleSlotId`);
    const memberId = draftId(row.memberId, `roleMap[${index}].memberId`);
    if (!Array.isArray(row.purposes) || row.purposes.length === 0 || row.purposes.some((purpose) => !TEACHING_PURPOSES.has(purpose))) {
      throw new BadRequestException({ code: 'BUNDLE_DRAFT_INVALID', message: `roleMap[${index}].purposes 必须是受支持的教学用途` });
    }
    return { roleSlotId, memberId, purposes: [...new Set(row.purposes)] as TeachingBundleDraft['roleMap'][number]['purposes'] };
  });
  if (new Set(roleMap.map((role) => role.roleSlotId)).size !== roleMap.length) {
    throw new BadRequestException({ code: 'BUNDLE_DRAFT_INVALID', message: 'roleMap 不得重复 roleSlotId' });
  }
  const skillPins = (value.skillPins as unknown[]).map((item, index) => {
    const row = draftRecord(item, `skillPins[${index}]`);
    exactKeys(row, ['roleSlotId', 'canonicalId', 'version', 'packageDigest'], `skillPins[${index}]`);
    return {
      roleSlotId: draftId(row.roleSlotId, `skillPins[${index}].roleSlotId`),
      canonicalId: draftId(row.canonicalId, `skillPins[${index}].canonicalId`),
      version: draftId(row.version, `skillPins[${index}].version`),
      packageDigest: draftDigest(row.packageDigest, `skillPins[${index}].packageDigest`),
    };
  });
  const toolIds = (value.toolIds as unknown[]).map((item, index) => {
    const row = draftRecord(item, `toolIds[${index}]`);
    exactKeys(row, ['roleSlotId', 'toolId'], `toolIds[${index}]`);
    return { roleSlotId: draftId(row.roleSlotId, `toolIds[${index}].roleSlotId`), toolId: draftId(row.toolId, `toolIds[${index}].toolId`) };
  });
  const mcpServerIds = draftIds(value.mcpServerIds, 'mcpServerIds');
  const knowledgeBaseIds = draftIds(value.knowledgeBaseIds, 'knowledgeBaseIds');
  const modelByPurpose: TeachingBundleDraft['modelByPurpose'] = {};
  for (const [roleSlotId, rawPurposes] of Object.entries(value.modelByPurpose as Record<string, unknown>)) {
    draftId(roleSlotId, `modelByPurpose.${roleSlotId}`);
    const purposes = draftRecord(rawPurposes, `modelByPurpose.${roleSlotId}`);
    exactKeys(purposes, ['outline', 'session', 'dialogue'], `modelByPurpose.${roleSlotId}`);
    const selection: Record<string, { modelProviderId: string; modelId: string }> = {};
    for (const [purpose, rawSelection] of Object.entries(purposes)) {
      const row = draftRecord(rawSelection, `modelByPurpose.${roleSlotId}.${purpose}`);
      exactKeys(row, ['modelProviderId', 'modelId'], `modelByPurpose.${roleSlotId}.${purpose}`);
      selection[purpose] = {
        modelProviderId: draftId(row.modelProviderId, `modelByPurpose.${roleSlotId}.${purpose}.modelProviderId`),
        modelId: draftId(row.modelId, `modelByPurpose.${roleSlotId}.${purpose}.modelId`),
      };
    }
    modelByPurpose[roleSlotId] = selection;
  }
  return {
    templateVersionId: draftId(value.templateVersionId, 'templateVersionId'),
    teamVersionId: draftId(value.teamVersionId, 'teamVersionId'),
    scheduleProfileId: draftId(value.scheduleProfileId, 'scheduleProfileId'),
    roleMap,
    skillPins,
    toolIds,
    mcpServerIds,
    knowledgeBaseIds,
    modelByPurpose,
    approvalPolicyVersion: draftId(value.approvalPolicyVersion, 'approvalPolicyVersion'),
  };
}

const TEACHING_PURPOSES = new Set(['outline', 'session', 'dialogue']);
const HEX_DIGEST = /^[a-f0-9]{64}$/u;

function draftRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException({ code: 'BUNDLE_DRAFT_INVALID', message: `${path} 必须为对象` });
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key))) {
    throw new BadRequestException({ code: 'BUNDLE_DRAFT_INVALID', message: `${path} 包含非 canonical 字段` });
  }
}

function draftId(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value.trim() !== value) {
    throw new BadRequestException({ code: 'BUNDLE_DRAFT_INVALID', message: `${path} 必须是 canonical ID` });
  }
  return value;
}

function draftIds(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new BadRequestException({ code: 'BUNDLE_DRAFT_INVALID', message: `${path} 必须为数组` });
  const ids = value.map((item, index) => draftId(item, `${path}[${index}]`));
  if (new Set(ids).size !== ids.length) throw new BadRequestException({ code: 'BUNDLE_DRAFT_INVALID', message: `${path} 不得重复` });
  return ids;
}

function draftDigest(value: unknown, path: string): string {
  const digest = draftId(value, path);
  if (!HEX_DIGEST.test(digest)) throw new BadRequestException({ code: 'BUNDLE_DRAFT_INVALID', message: `${path} 必须是 SHA-256 digest` });
  return digest;
}
