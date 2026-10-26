import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import type { Database } from '@qitu/database';
import { sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashRequest } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { TemplateDeleteProtectedError } from './templates.store';
import { collectTemplateDeletion, assertTemplateDeletionIdle } from './template-deletion.scope';
import { deleteTemplateRecords } from './template-deletion.sql';

export interface DeleteTemplateRecordsInput {
  includeLearningData: true; expectedFingerprint: string; confirmedTitle: string;
}

@Injectable()
export class TemplateDeletionService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly audit: AuditWriter, private readonly idempotency: IdempotencyStore) {}

  private database(actor: CurrentUser) {
    if (actor.role !== 'admin') throw new ForbiddenException('仅管理员可删除课程及关联学习数据');
    if (!this.db) throw new ServiceUnavailableException('课程删除服务暂不可用');
    return this.db;
  }

  async preview(actor: CurrentUser, templateId: string) {
    const db = this.database(actor);
    try {
      return await db.transaction(async tx => (await collectTemplateDeletion(tx, templateId, false)).impact,
        { isolationLevel: 'repeatable read', accessMode: 'read only' });
    } catch (error) { this.rethrow(error); }
  }

  async remove(actor: CurrentUser, templateId: string, input: DeleteTemplateRecordsInput, key: string | undefined) {
    const db = this.database(actor);
    if (input?.includeLearningData !== true || typeof input.expectedFingerprint !== 'string'
      || !/^[a-f0-9]{64}$/.test(input.expectedFingerprint) || typeof input.confirmedTitle !== 'string'
      || !input.confirmedTitle.trim() || !key?.trim() || key.length > 160) {
      throw new BadRequestException({ code: 'TEMPLATE_DELETE_CONFIRMATION_REQUIRED', message: '请先核对删除范围并输入完整课程名称确认。' });
    }
    const scope = `template.delete-records:${actor.id}:${templateId}`;
    try {
      const result = await this.idempotency.execute(scope, key, hashRequest({ templateId, ...input }), async () => {
        const body = await db.transaction(async tx => {
          await tx.execute(sql`SET LOCAL lock_timeout='5s'`);
          const selected = await collectTemplateDeletion(tx, templateId, true);
          if (selected.impact.fingerprint !== input.expectedFingerprint || selected.impact.title !== input.confirmedTitle.trim()) {
            throw new ConflictException({ code: 'TEMPLATE_DELETE_STALE', message: '课程或关联记录已变化，请重新核对删除范围并确认。' });
          }
          await assertTemplateDeletionIdle(tx, selected);
          await deleteTemplateRecords(tx, selected);
          await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'template.delete',
            targetType: 'project_template', targetId: templateId, idempotencyKey: `${scope}:${key}`,
            reason: '管理员确认删除课程及关联学习数据',
            detail: { includeLearningData: true, from: selected.template.status, counts: selected.impact.counts,
              fingerprint: selected.impact.fingerprint } }, tx);
          return { success: true, id: templateId, deletedCounts: selected.impact.counts };
        });
        return { status: 200, body };
      });
      return result.body;
    } catch (error) { this.rethrow(error); }
  }

  private rethrow(error: unknown): never {
    if (error instanceof TemplateDeleteProtectedError) throw new ConflictException({ code: 'TEMPLATE_DELETE_PROTECTED', message: error.message });
    for (let cause: unknown = error, depth = 0; depth < 5 && cause && typeof cause === 'object'; depth++) {
      const code = (cause as { code?: string }).code;
      if (['23503','23001'].includes(code ?? '')) throw new ConflictException({ code: 'TEMPLATE_DELETE_SHARED', message: '仍有跨课程关联记录，删除已整体回滚，请刷新后重试或检查共享关系。' });
      if (['55P03','40P01','40001'].includes(code ?? '')) throw new ConflictException({ code: 'TEMPLATE_DELETE_BUSY', message: '关联记录正在更新，删除未生效，请稍后重新核对。' });
      cause = (cause as { cause?: unknown }).cause;
    }
    throwHttpForIdempotencyError(error);
    throw error;
  }
}
