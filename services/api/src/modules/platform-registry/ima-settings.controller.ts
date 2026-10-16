import { BadRequestException, Body, Controller, Get, Headers, Patch, Post } from '@nestjs/common';
import { requireRole } from '../../common/access/request-auth';
import { AuthService } from '../identity-auth/auth.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { ImaSettingsService, parseImaPatch } from './ima-settings.service';

@Controller('admin/ai-runtime/mcp/ima-knowledge')
export class ImaSettingsController {
  constructor(private readonly auth: AuthService, private readonly settings: ImaSettingsService, private readonly idempotency: IdempotencyStore) {}

  @Get()
  async get(@Headers('cookie') cookie: string | undefined) {
    requireRole(this.auth, cookie, 'admin', 'MCP 设置仅向管理员开放');
    return { data: await this.settings.getSettings() };
  }

  @Patch()
  async update(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    const actor = requireRole(this.auth, cookie, 'admin', 'MCP 设置仅向管理员开放');
    const patch = parseImaPatch(body);
    return this.mutate('update', key, actor, patch, () => this.settings.update(actor, patch));
  }

  @Post('check')
  async check(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined) {
    const actor = requireRole(this.auth, cookie, 'admin', 'MCP 设置仅向管理员开放');
    return this.mutate('check', key, actor, {}, () => this.settings.probe(actor));
  }

  private async mutate(action: string, key: string | undefined, actor: { id: string }, body: unknown, run: () => Promise<unknown>) {
    if (!key?.trim() || key.length > 160) throw new BadRequestException('缺少或无效的 Idempotency-Key');
    const scope = `admin.mcp.ima.${action}`;
    try {
      const result = await this.idempotency.execute(scope, key, hashIdempotentInput(scope, { actorId: actor.id }, body), async () => ({ status: 200, body: await run() }));
      return { data: result.body };
    } catch (error) { throwHttpForIdempotencyError(error); }
  }
}
