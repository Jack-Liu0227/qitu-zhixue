import { BadRequestException, Body, Controller, Get, Header, Headers, Patch } from '@nestjs/common';
import { requireRole } from '../../common/access/request-auth';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { AuthService } from '../identity-auth/auth.service';
import { ToolBindingMigrationService } from './tool-binding-migration.service';

@Controller('admin/ai-runtime/tools/bindings-migration')
export class ToolBindingMigrationController {
  constructor(private readonly auth: AuthService, private readonly migration: ToolBindingMigrationService, private readonly idempotency: IdempotencyStore) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async preview(@Headers('cookie') cookie?: string) {
    const actor = requireRole(this.auth, cookie, 'admin', '工具绑定迁移仅向管理员开放');
    return { data: await this.migration.preview(actor) };
  }

  @Patch()
  async apply(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    const actor = requireRole(this.auth, cookie, 'admin', '工具绑定迁移仅向管理员开放');
    if (!key?.trim() || key.length > 160) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: '缺少或无效的 Idempotency-Key' });
    if (typeof body !== 'object' || body === null || !('revision' in body) || typeof body.revision !== 'string'
      || !/^[a-f0-9]{64}$/.test(body.revision) || Object.keys(body).some(field => field !== 'revision')) {
      throw new BadRequestException('请提交有效的迁移预览 revision');
    }
    const revision = body.revision;
    const scope = 'admin.ai-runtime.tools.bindings-migration';
    try {
      const result = await this.idempotency.execute(scope, key, hashIdempotentInput(scope, { actorId: actor.id }, { revision }), async () => ({
        status: 200, body: await this.migration.apply(actor, revision),
      }));
      return { data: result.body };
    } catch (error) { throwHttpForIdempotencyError(error); }
  }
}
