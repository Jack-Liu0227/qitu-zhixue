import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import type { AdminFeishuSettings, FeishuQrSession } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { FeishuService, parseFeishuPatch } from './feishu.service';

@Controller('admin/integrations/feishu')
export class FeishuController {
  constructor(private readonly auth: AuthService, private readonly feishu: FeishuService, private readonly idempotency: IdempotencyStore) {}

  @Get()
  async get(@Headers('cookie') cookie: string | undefined): Promise<{ data: AdminFeishuSettings }> {
    requireRole(this.auth, cookie, 'admin', '飞书配置仅向管理员开放');
    return { data: await this.feishu.getSettings() };
  }

  @Patch()
  async update(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown): Promise<{ data: AdminFeishuSettings }> {
    const actor = requireRole(this.auth, cookie, 'admin', '飞书配置仅向管理员开放');
    const idempotencyKey = key?.trim();
    if (!idempotencyKey || idempotencyKey.length > 160) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少或无效的 Idempotency-Key' });
    const input = parseFeishuPatch(body);
    const scope = 'admin.feishu.update';
    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id }, input), async () => ({ status: 200, body: await this.feishu.update(actor, input) }));
      return { data: result.body };
    } catch (error) { throwHttpForIdempotencyError(error); }
  }

  @Post('qr-sessions')
  async createQr(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined): Promise<{ data: FeishuQrSession }> {
    const actor = requireRole(this.auth, cookie, 'admin', '飞书配置仅向管理员开放');
    const idempotencyKey = key?.trim();
    if (!idempotencyKey || idempotencyKey.length > 160) throw new BadRequestException('缺少或无效的 Idempotency-Key');
    const scope = 'admin.feishu.qr.create';
    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, hashIdempotentInput(scope, { actorId: actor.id }, {}), async () => ({ status: 201, body: await this.feishu.createQrSession(actor) }));
      return { data: result.body };
    } catch (error) { throwHttpForIdempotencyError(error); }
  }

  @Get('qr-sessions/:id')
  async getQr(@Headers('cookie') cookie: string | undefined, @Param('id') id: string): Promise<{ data: FeishuQrSession }> {
    requireRole(this.auth, cookie, 'admin', '飞书配置仅向管理员开放');
    return { data: await this.feishu.getQrSession(id) };
  }
}

/** Feishu OAuth callback; code is exchanged by the server and never persisted. */
@Controller('integrations/feishu/oauth')
export class FeishuOAuthController {
  constructor(private readonly feishu: FeishuService) {}

  @Get('callback')
  async callback(@Query('state') state: string, @Query('code') code: string): Promise<{ ok: true }> {
    await this.feishu.completeQrSession(state, code);
    return { ok: true };
  }
}
