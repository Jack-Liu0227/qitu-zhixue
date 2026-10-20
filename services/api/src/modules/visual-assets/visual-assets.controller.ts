import { BadRequestException, Body, Controller, Get, Headers, Patch, Query } from '@nestjs/common';
import type { VisualBindingResult } from '@qitu/contracts';
import { requireRole } from '../../common/access/request-auth';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { AuthService } from '../identity-auth/auth.service';
import { VisualAssetsService } from './visual-assets.service';
import { parseVisualOwner, parseVisualPatch, parseVisualUsage } from './visual-assets.policy';

@Controller('admin/visual-assets')
export class VisualAssetsController {
  constructor(private readonly auth: AuthService, private readonly visuals: VisualAssetsService, private readonly idempotency: IdempotencyStore) {}

  @Get()
  catalog(@Headers('cookie') cookie: string | undefined, @Query('usage') usage?: string) {
    requireRole(this.auth, cookie, 'admin', '素材库仅向管理员开放');
    return { data: this.visuals.catalog(usage ? parseVisualUsage(usage) : undefined) };
  }

  @Get('binding')
  async binding(@Headers('cookie') cookie: string | undefined, @Query('kind') kind: string, @Query('id') id: string, @Query('usage') usage: string) {
    requireRole(this.auth, cookie, 'admin', '素材库仅向管理员开放');
    return { data: await this.visuals.read(parseVisualOwner({ kind, id }), parseVisualUsage(usage)) };
  }

  @Patch('bindings')
  async save(@Headers('cookie') cookie: string | undefined, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    const actor = requireRole(this.auth, cookie, 'admin', '素材选择仅向管理员开放');
    if (!key?.trim() || key.length > 160) throw new BadRequestException('缺少有效的 Idempotency-Key');
    if (!Array.isArray(body) || !body.length || body.length > 100) throw new BadRequestException('每批请选择 1–100 个展示对象');
    const inputs = body.map(parseVisualPatch);
    if (new Set(inputs.map((item) => `${item.owner.kind}:${item.owner.id}:${item.usage}`)).size !== inputs.length) throw new BadRequestException('批量选择包含重复对象');
    const scope = 'admin.visual.bindings';
    try {
      const result = await this.idempotency.execute(scope, key, hashIdempotentInput(scope, { actorId: actor.id }, inputs), async () => {
        const results: VisualBindingResult[] = [];
        for (const input of inputs) {
          try { results.push({ kind: 'saved', binding: await this.visuals.save(actor, input, key) }); }
          catch (error) {
            const status = error instanceof Error && 'getStatus' in error && typeof error.getStatus === 'function' ? error.getStatus() : 500;
            results.push({ kind: 'failed', owner: input.owner, code: status === 409 ? 'VISUAL_REVISION_CONFLICT' : 'VISUAL_SAVE_FAILED', message: status === 409 ? '配置已变化，请刷新后重试' : '未能保存此对象的素材选择' });
          }
        }
        return { status: 200, body: results };
      });
      return { data: result.body };
    } catch (error) { throwHttpForIdempotencyError(error); }
  }
}
