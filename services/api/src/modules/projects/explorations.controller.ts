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
} from '@nestjs/common';
import type {
  CloseExplorationRequest,
  ConfirmIntentRequest,
  ConfirmIntentResponse,
  CreateExplorationRequest,
  CurrentUser,
  ExplorationView,
  UpdateIntentDraftRequest,
} from '@qitu/contracts';
import { AuthService } from '../identity-auth/auth.service';
import { pickFields, requireRole } from '../../common/access/request-auth';
import { ProjectsService } from './projects.service';

/**
 * 学生端探索 / 意图确认接口。
 *
 * 与产品文档 §4.3 的探索 API 对齐：
 * - `POST   /api/v1/explorations`                  新建探索（需幂等键）
 * - `GET    /api/v1/explorations/:id`              读取探索
 * - `PATCH  /api/v1/explorations/:id`              更新候选意图草稿
 * - `POST   /api/v1/explorations/:id/confirm-intent` 确认意图（需幂等键）
 * - `POST   /api/v1/explorations/:id/close`        关闭探索
 *
 * 三条不可越界：
 * 1. 只向 `student` 角色开放（`requireRole`，服务端判定）；
 * 2. 请求体经 `pickFields` 白名单，客户端塞不进 `status` / `confirmedAt` /
 *    项目字段；
 * 3. `confirm-intent` 必须以 `Idempotency-Key` 头调用。
 */
@Controller('explorations')
export class ExplorationsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  async create(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ): Promise<{ data: ExplorationView }> {
    const user = this.requireStudent(cookieHeader);
    const request = pickFields<CreateExplorationRequest>(body, ['source', 'templateVersionId']);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.projects.createExploration(user.id, request, key) };
  }

  @Get(':id')
  async get(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
  ): Promise<{ data: ExplorationView }> {
    const user = this.requireStudent(cookieHeader);
    return { data: await this.projects.getExploration(user.id, id) };
  }

  @Patch(':id')
  async updateIntentDraft(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ data: ExplorationView }> {
    const user = this.requireStudent(cookieHeader);
    const request = pickFields<UpdateIntentDraftRequest>(body, [
      'goalUser',
      'coreInterests',
      'preferredForm',
      'targetBeneficiary',
    ]);
    return { data: await this.projects.updateIntentDraft(user.id, id, request) };
  }

  @Post(':id/confirm-intent')
  async confirmIntent(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ data: ConfirmIntentResponse }> {
    const user = this.requireStudent(cookieHeader);
    const request = pickFields<ConfirmIntentRequest>(body, ['note']);
    const key = requireIdempotencyKey(idempotencyKey);
    return { data: await this.projects.confirmIntent(user.id, id, key, request) };
  }

  @Post(':id/close')
  @HttpCode(200)
  async close(
    @Headers('cookie') cookieHeader: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ data: ExplorationView }> {
    const user = this.requireStudent(cookieHeader);
    const request = pickFields<CloseExplorationRequest>(body, ['reason']);
    return { data: await this.projects.closeExploration(user.id, id, request) };
  }

  private requireStudent(cookieHeader: string | undefined): CurrentUser {
    return requireRole(this.auth, cookieHeader, 'student', '探索与意图确认仅向学生开放');
  }
}

/** `Idempotency-Key` 有值且去掉空白后非空，否则 400 + 稳定错误码。 */
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
