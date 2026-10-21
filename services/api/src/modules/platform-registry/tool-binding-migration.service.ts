import { ConflictException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { adminAssistants, type Database, withTransaction } from '@qitu/database';
import type { CurrentUser, ToolBindingMigrationResult } from '@qitu/contracts';
import { asc, eq } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { builtinToolRegistry } from './built-in-tools';
import { buildToolBindingMigrationPlan } from './tool-binding-migration.plan';

const columns = { id: adminAssistants.id, name: adminAssistants.name, toolIds: adminAssistants.toolIds, updatedAt: adminAssistants.updatedAt };

@Injectable()
export class ToolBindingMigrationService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null, private readonly audit: AuditWriter) {}

  async preview(actor: CurrentUser) {
    this.requireAdmin(actor);
    if (!this.db) throw new ServiceUnavailableException('工具绑定存储不可用');
    const rows = await this.db.select(columns).from(adminAssistants).orderBy(asc(adminAssistants.id));
    return buildToolBindingMigrationPlan(rows, builtinToolRegistry.list().map(tool => tool.id));
  }

  async apply(actor: CurrentUser, revision: string): Promise<ToolBindingMigrationResult> {
    this.requireAdmin(actor);
    if (!this.db) throw new ServiceUnavailableException('工具绑定存储不可用');
    return withTransaction(this.db, async tx => {
      const rows = await tx.select(columns).from(adminAssistants).orderBy(asc(adminAssistants.id)).for('update');
      const known = builtinToolRegistry.list().map(tool => tool.id);
      const plan = buildToolBindingMigrationPlan(rows, known);
      if (plan.revision !== revision) throw new ConflictException({ code: 'TOOL_BINDINGS_CHANGED', message: '助手或工具目录已变化，请刷新迁移预览后重试' });
      const migratedAssistantIds: string[] = [];
      const auditIds: string[] = [];
      let retiredBindingCount = 0;
      for (const entry of plan.entries) {
        const [saved] = await tx.update(adminAssistants).set({ toolIds: entry.afterToolIds, updatedBy: actor.id, updatedAt: new Date() })
          .where(eq(adminAssistants.id, entry.assistantId)).returning(columns);
        if (!saved || JSON.stringify(saved.toolIds) !== JSON.stringify(entry.afterToolIds)) {
          throw new ConflictException({ code: 'TOOL_BINDING_READBACK_FAILED', message: '历史绑定写入未确认，迁移已回滚' });
        }
        auditIds.push(await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.assistant.tools.migrate',
          targetType: 'admin_assistant', targetId: entry.assistantId,
          detail: { policyVersion: plan.policyVersion, previousToolIds: entry.beforeToolIds, currentToolIds: saved.toolIds,
            retired: entry.retired, frozenVersionsChanged: false } }, tx));
        const index = rows.findIndex(row => row.id === saved.id);
        if (index >= 0) rows[index] = saved;
        migratedAssistantIds.push(saved.id);
        retiredBindingCount += entry.retired.length;
      }
      return { migratedAssistantIds, retiredBindingCount, auditIds, remaining: buildToolBindingMigrationPlan(rows, known) };
    });
  }

  private requireAdmin(actor: CurrentUser) {
    if (actor.role !== 'admin') throw new ForbiddenException('工具绑定迁移仅向管理员开放');
  }
}
