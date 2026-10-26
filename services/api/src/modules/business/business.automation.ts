import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import {
  businessOrders,
  businessSettings,
  businessTasks,
  consultationRequests,
  projects,
} from '@qitu/database';
import { BusinessStore } from './business.store';
import { AuditWriter } from '../../common/audit/audit.service';
import type { CurrentUser } from '@qitu/contracts';

@Injectable()
export class BusinessAutomation implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly logger = new Logger(BusinessAutomation.name);
  constructor(
    private readonly store: BusinessStore,
    private readonly audit: AuditWriter,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.run(false).catch(() => this.logger.warn('经营检查失败，将在下个周期重试'));
    }, 5 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(manual: boolean, actor?: CurrentUser) {
    return this.store.database().transaction(async (tx) => {
      const settings = await this.store.lockSettings(tx);
      if (!manual && !settings.automationEnabled) return { created: 0, skipped: true };
      const now = new Date();
      const leads = await tx
        .select({ id: consultationRequests.id })
        .from(consultationRequests)
        .where(
          sql`${consultationRequests.status} = 'received' and ${consultationRequests.createdAt} < ${new Date(now.getTime() - settings.followupHours * 3_600_000)}`,
        )
        .limit(200);
      const refunds = await tx
        .select({ id: businessOrders.id })
        .from(businessOrders)
        .where(sql`${businessOrders.status} in ('refund_requested','refunding')`)
        .limit(200);
      const delivery = await tx
        .select({ id: businessOrders.id })
        .from(businessOrders)
        .where(
          sql`
        ${businessOrders.status} = 'paid' and ${businessOrders.paidAt} < ${new Date(now.getTime() - settings.inactivityDays * 86_400_000)}
        and ${businessOrders.accessUntil} > ${now}
        and not exists (select 1 from ${projects} where ${projects.studentUserId} = ${businessOrders.studentId}
          and ${projects.templateVersionId} = ${businessOrders.templateVersionId} and ${projects.createdAt} >= ${businessOrders.createdAt})`,
        )
        .limit(200);
      const candidates = [
        ...leads.map((r) => ({
          kind: 'lead' as const,
          referenceId: r.id,
          title: '咨询线索需要跟进',
        })),
        ...refunds.map((r) => ({
          kind: 'refund' as const,
          referenceId: r.id,
          title: '退款申请需要处理或查询',
        })),
        ...delivery.map((r) => ({
          kind: 'delivery' as const,
          referenceId: r.id,
          title: '课程已开通，尚未确认正式项目',
        })),
      ];
      let created = 0;
      for (const task of candidates) {
        const rows = await tx
          .insert(businessTasks)
          .values({ id: randomUUID(), ...task, status: 'open' })
          .onConflictDoNothing()
          .returning({ id: businessTasks.id });
        created += rows.length;
      }
      await tx
        .update(businessSettings)
        .set({ lastAutomationAt: now })
        .where(eq(businessSettings.id, 'platform'));
      await this.audit.write(
        {
          actorId: actor?.id,
          actorRole: actor?.role,
          action: 'business.automation.checked',
          targetType: 'business',
          detail: { manual, candidates: candidates.length, created },
        },
        tx,
      );
      return { created, skipped: false, checkedAt: now.toISOString() };
    });
  }
}
