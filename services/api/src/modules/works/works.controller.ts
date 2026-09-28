import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { pickFields, requireAnyRole, requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import {
  WorksService,
  type ArtifactListQuery,
  type ArtifactVersionInput,
  type ArtifactVersionView,
  type ArtifactView,
  type CreateArtifactRequest,
  type PresignUploadRequest,
  type UpdateArtifactRequest,
} from './works.service';
import type { PresignUploadResult } from './object-storage.presigner';
import type { ArtifactStatus } from './artifact-state-machine';

/** 客户端**永远不能**提交的字段：服务端独占状态与派生数据。 */
const SERVER_OWNED_FIELDS = [
  'id',
  'studentId',
  'status',
  'publishedAt',
  'visibility',
  'currentVersionIndex',
  'createdAt',
  'updatedAt',
  'reviewStatus',
  'evidence',
  'likeCount',
  'views',
  'audit',
] as const;

const VERSION_FIELDS = ['note', 'objectKey', 'thumbnailRef', 'capturedAt'] as const;

const ARTIFACT_STATUSES = new Set<ArtifactStatus>([
  'draft',
  'submitted',
  'in_review',
  'published',
  'changes_requested',
  'archived',
]);

/**
 * 作品（Works）HTTP 接口。
 *
 * | 方法 | 路径 | 角色 | 幂等键 | 状态码 |
 * |------|------|------|--------|--------|
 * | POST   | `/api/v1/files/presign` | student | 是 | 201 |
 * | POST   | `/api/v1/artifacts` | student | 是 | 201 |
 * | GET    | `/api/v1/artifacts` | student/teacher/parent | - | 200 |
 * | GET    | `/api/v1/artifacts/:id` | 同上（对象级） | - | 200 |
 * | PATCH  | `/api/v1/artifacts/:id` | student（本人） | 是 | 200 / 409 |
 * | GET    | `/api/v1/artifacts/:id/versions` | 同上（对象级） | - | 200 |
 * | POST   | `/api/v1/artifacts/:id/publish` | student（本人） | 是 | 200 |
 * | POST   | `/api/v1/artifacts/:id/withdraw` | student（本人） | 是 | 200 |
 *
 * 说明：
 * - `status` / `publishedAt` / `visibility` 等提交即 400（`assertNoServerOwnedFields`），
 *   不是静默丢弃；
 * - `PATCH` 支持 `If-Match: <revision>`，不匹配返回 409 + 当前 revision；
 * - 对象级授权在 `WorksService` 再校验一次（前端隐藏不算数）；
 * - 没有任何「写证据」接口（项目证据由服务端物化，见 `ProjectEvidenceController`）。
 */
@Controller('artifacts')
export class ArtifactsController {
  constructor(
    private readonly works: WorksService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  async create(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<{ data: ArtifactView }> {
    const user = this.requireStudent(cookieHeader);
    assertNoServerOwnedFields(body);
    const request = pickFields<CreateArtifactRequest>(body, [
      'projectId',
      'title',
      'summary',
      'tags',
      'version',
    ]);
    request.version = pickVersion(body);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.works.createArtifact(user.id, request, key) };
  }

  @Get()
  async list(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
  ): Promise<{ data: ArtifactView[] }> {
    const user = requireAnyRole(this.auth, cookieHeader);
    const query: ArtifactListQuery = {
      projectId: nonEmpty(projectId),
      status: parseStatus(status),
    };
    return { data: await this.works.listArtifacts(user, query) };
  }

  @Get(':id')
  async get(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: ArtifactView }> {
    const user = requireAnyRole(this.auth, cookieHeader);
    return { data: await this.works.getArtifact(user, id) };
  }

  @Get(':id/versions')
  async versions(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: ArtifactVersionView[] }> {
    const user = requireAnyRole(this.auth, cookieHeader);
    return { data: await this.works.listVersions(user, id) };
  }

  @Patch(':id')
  @HttpCode(200)
  async update(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('if-match') ifMatch: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ data: ArtifactView }> {
    const user = this.requireStudent(cookieHeader);
    assertNoServerOwnedFields(body);
    const request = pickFields<UpdateArtifactRequest>(body, [
      'title',
      'summary',
      'tags',
      'version',
    ]);
    request.version = pickVersion(body);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.works.updateArtifact(user.id, id, request, key, ifMatch) };
  }

  @Post(':id/publish')
  @HttpCode(200)
  async publish(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ data: ArtifactView }> {
    const user = this.requireStudent(cookieHeader);
    assertNoServerOwnedFields(body);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.works.publishArtifact(user.id, id, key) };
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  async withdraw(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ data: ArtifactView }> {
    const user = this.requireStudent(cookieHeader);
    assertNoServerOwnedFields(body);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.works.withdrawArtifact(user.id, id, key) };
  }

  private requireStudent(cookieHeader: string | undefined): CurrentUser {
    return requireRole(this.auth, cookieHeader, 'student', '作品写操作仅向学生开放');
  }
}

/** 文件上传签名 URL。对象存储凭据不下发，仅返回限时地址。 */
@Controller('files')
export class FilesController {
  constructor(
    private readonly works: WorksService,
    private readonly auth: AuthService,
  ) {}

  @Post('presign')
  async presign(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<{ data: PresignUploadResult }> {
    const user = requireRole(this.auth, cookieHeader, 'student', '上传仅向学生开放');
    const request = pickFields<PresignUploadRequest>(body, [
      'filename',
      'contentType',
      'sizeBytes',
      'purpose',
    ]);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.works.presignUpload(user.id, request, key) };
  }
}

/** 显式拒绝服务端字段，避免客户端「塞进来被静默忽略」的错觉。 */
function assertNoServerOwnedFields(body: unknown): void {
  if (body === null || typeof body !== 'object') return;
  const source = body as Record<string, unknown>;
  const offenders = SERVER_OWNED_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(source, field),
  );
  if (offenders.length > 0) {
    throw new BadRequestException({
      code: 'ARTIFACT_SERVER_OWNED_FIELD',
      message: `以下字段由服务端管理，不能提交：${offenders.join(', ')}`,
    });
  }
}

function pickVersion(body: unknown): ArtifactVersionInput | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const raw = (body as Record<string, unknown>).version;
  if (raw === undefined) return undefined;
  return pickFields<ArtifactVersionInput>(raw, VERSION_FIELDS);
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

function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value.trim().length === 0 ? null : value.trim();
}

function parseStatus(raw: string | undefined): ArtifactStatus | null {
  const value = nonEmpty(raw);
  if (value === null) return null;
  if (!ARTIFACT_STATUSES.has(value as ArtifactStatus)) {
    throw new BadRequestException({ code: 'ARTIFACT_INVALID', message: 'status 非法' });
  }
  return value as ArtifactStatus;
}
