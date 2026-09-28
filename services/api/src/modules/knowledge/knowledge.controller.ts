import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { pickFields, requireAnyRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { KnowledgeService } from './knowledge.service';
import type {
  KnowledgeDocumentUpsertInput,
  KnowledgeMutationResult,
  KnowledgeSearchResponse,
} from './knowledge.types';

/**
 * 作用域知识接口。
 *
 * - `GET  /api/v1/knowledge/search?q=&projectId=&limit=`  作用域内检索（仅已校验知识）
 * - `GET  /api/v1/knowledge/documents/:id`                 读取文档（可读者或可维护者）
 * - `POST /api/v1/knowledge/documents`                     新建 / 修订（需幂等键）
 * - `POST /api/v1/knowledge/documents/:id/verify`          校验（需幂等键）
 *
 * 权限边界：
 * 1. 四个接口都要求**已登录**（`requireAnyRole`）；
 * 2. 具体作用域授权由 `KnowledgeService` 的服务端规则判定；控制器不区分角色，
 *    因为同一路由对不同作用域（system/school/project/student）的合法角色不同；
 * 3. 写入体经 `pickFields` 白名单，客户端塞不进 `status` / `verifiedBy` /
 *    `version` / `checksum` 等服务端字段；
 * 4. 两个写接口强制 `Idempotency-Key`。
 */
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly auth: AuthService,
  ) {}

  @Get('search')
  async search(
    @Headers('cookie') cookieHeader: string | undefined,
    @Query('q') q: string | undefined,
    @Query('projectId') projectId: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<{ data: KnowledgeSearchResponse }> {
    const user = this.requireUser(cookieHeader);
    return { data: await this.knowledge.search(user, { text: q, projectId, limit }) };
  }

  @Get('documents/:id')
  async getDocument(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: KnowledgeMutationResult['document'] }> {
    const user = this.requireUser(cookieHeader);
    return { data: await this.knowledge.getDocument(user, id) };
  }

  @Post('documents')
  async upsertDocument(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<{ data: KnowledgeMutationResult }> {
    const user = this.requireUser(cookieHeader);
    const request = pickFields<KnowledgeDocumentUpsertInput>(body, [
      'id',
      'scope',
      'schoolId',
      'ownerUserId',
      'projectId',
      'title',
      'summary',
      'tags',
      'content',
      'source',
      'sourceRef',
    ]);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.knowledge.upsertDocument(user, request, key) };
  }

  @Post('documents/:id/verify')
  @HttpCode(200)
  async verifyDocument(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: KnowledgeMutationResult }> {
    const user = this.requireUser(cookieHeader);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.knowledge.verifyDocument(user, id, key) };
  }

  private requireUser(cookieHeader: string | undefined): CurrentUser {
    return requireAnyRole(this.auth, cookieHeader);
  }
}

/** `Idempotency-Key` 有值且去空白后非空，否则 400 + 稳定错误码。 */
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
