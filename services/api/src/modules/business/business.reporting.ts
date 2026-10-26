import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  businessExpenses,
  businessModelUsage,
  businessOffers,
  businessOrders,
  businessSettings,
  businessTasks,
  consultationRequests,
  pblTemplateTeamBindings,
  projects,
  projectTemplates,
  projectTemplateVersions,
} from '@qitu/database';
import type {
  BusinessDashboard,
  BusinessLead,
  CreateBusinessExpense,
  CurrentUser,
} from '@qitu/contracts';
import { randomUUID } from 'node:crypto';
import { BusinessStore, orderView } from './business.store';
import { WechatPayment } from './wechat-payment';
import { AuditWriter } from '../../common/audit/audit.service';

@Injectable()
export class BusinessReporting {
  constructor(
    private readonly store: BusinessStore,
    private readonly payment: WechatPayment,
    private readonly audit: AuditWriter,
  ) {}

  async dashboard(actor: CurrentUser): Promise<BusinessDashboard> {
    const db = this.store.database();
    const [
      settings,
      offerRows,
      templateRows,
      orderRows,
      leadRows,
      tasks,
      orderStats,
      deliveryStats,
      repeatStats,
      leadStats,
      usageStats,
      configRows,
      expenseRows,
      expenseStats,
    ] = await Promise.all([
      this.store.settings(),
      db.select().from(businessOffers).orderBy(desc(businessOffers.updatedAt)).limit(200),
      db
        .select({
          id: projectTemplateVersions.id,
          title: projectTemplates.title,
          version: projectTemplateVersions.version,
        })
        .from(projectTemplateVersions)
        .innerJoin(projectTemplates, eq(projectTemplates.id, projectTemplateVersions.templateId))
        .innerJoin(
          pblTemplateTeamBindings,
          and(
            eq(pblTemplateTeamBindings.templateVersionId, projectTemplateVersions.id),
            eq(pblTemplateTeamBindings.status, 'active'),
          ),
        )
        .where(
          and(
            eq(projectTemplateVersions.status, 'published'),
            eq(projectTemplates.status, 'published'),
            isNull(projectTemplates.schoolId),
          ),
        )
        .limit(200),
      db.select().from(businessOrders).orderBy(desc(businessOrders.createdAt)).limit(50),
      db
        .select()
        .from(consultationRequests)
        .orderBy(desc(consultationRequests.createdAt))
        .limit(100),
      db
        .select()
        .from(businessTasks)
        .where(eq(businessTasks.status, 'open'))
        .orderBy(desc(businessTasks.createdAt))
        .limit(100),
      db
        .select({
          orders: count(),
          paid: sql<number>`count(*) filter (where ${businessOrders.paidAt} is not null)`.mapWith(
            Number,
          ),
          refunds:
            sql<number>`count(*) filter (where ${businessOrders.status} = 'refunded')`.mapWith(
              Number,
            ),
          revenue:
            sql<number>`coalesce(sum(${businessOrders.amountFen}) filter (where ${businessOrders.paidAt} is not null),0)`.mapWith(
              Number,
            ),
          refunded:
            sql<number>`coalesce(sum(${businessOrders.amountFen}) filter (where ${businessOrders.status} = 'refunded'),0)`.mapWith(
              Number,
            ),
        })
        .from(businessOrders),
      db
        .select({
          started: sql<number>`count(distinct ${projects.id})`.mapWith(Number),
          completed:
            sql<number>`count(distinct ${projects.id}) filter (where ${projects.status} = 'completed')`.mapWith(
              Number,
            ),
        })
        .from(projects)
        .innerJoin(
          businessOrders,
          and(
            eq(businessOrders.studentId, projects.studentUserId),
            eq(businessOrders.templateVersionId, projects.templateVersionId),
            sql`${businessOrders.paidAt} is not null and ${projects.createdAt} >= ${businessOrders.createdAt}`,
          ),
        ),
      db
        .select({ buyerId: businessOrders.buyerId })
        .from(businessOrders)
        .where(sql`${businessOrders.paidAt} is not null and ${businessOrders.status} <> 'refunded'`)
        .groupBy(businessOrders.buyerId)
        .having(sql`count(*) > 1`),
      db.select({ total: count() }).from(consultationRequests),
      db
        .select({
          calls: count(),
          input: sql<number>`coalesce(sum(${businessModelUsage.inputTokens}),0)`.mapWith(Number),
          output: sql<number>`coalesce(sum(${businessModelUsage.outputTokens}),0)`.mapWith(Number),
          unknown:
            sql<number>`count(*) filter (where ${businessModelUsage.inputTokens} is null or ${businessModelUsage.outputTokens} is null)`.mapWith(
              Number,
            ),
        })
        .from(businessModelUsage),
      db
        .select({ at: businessSettings.lastAutomationAt })
        .from(businessSettings)
        .where(eq(businessSettings.id, 'platform')),
      db.select().from(businessExpenses).orderBy(desc(businessExpenses.createdAt)).limit(100),
      db
        .select({
          cost: sql<number>`coalesce(sum(${businessExpenses.amountFen}),0)`.mapWith(Number),
          minutes: sql<number>`coalesce(sum(${businessExpenses.minutes}),0)`.mapWith(Number),
        })
        .from(businessExpenses),
    ]);
    await this.audit.write({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'business.dashboard.read',
      targetType: 'business',
      detail: { leadCount: leadRows.length, orderCount: orderRows.length },
    });
    const o = orderStats[0];
    const d = deliveryStats[0];
    const u = usageStats[0];
    return {
      settings,
      offers: offerRows.map((r) => r.content),
      templates: templateRows,
      payment: this.payment.status(),
      metrics: {
        orders: o?.orders ?? 0,
        paidOrders: o?.paid ?? 0,
        refundOrders: o?.refunds ?? 0,
        revenueFen: o?.revenue ?? 0,
        refundedFen: o?.refunded ?? 0,
        learningStarted: d?.started ?? 0,
        learningCompleted: d?.completed ?? 0,
        repeatBuyers: repeatStats.length,
        consultations: leadStats[0]?.total ?? 0,
        modelCalls: u?.calls ?? 0,
        inputTokens: u?.input ?? 0,
        outputTokens: u?.output ?? 0,
        unknownUsageCalls: u?.unknown ?? 0,
        recordedExpenseFen: expenseStats[0]?.cost ?? 0,
        supportMinutes: expenseStats[0]?.minutes ?? 0,
      },
      recentOrders: orderRows.map((r) => {
        const { terms: _terms, checkoutUrl: _url, ...safe } = orderView(r);
        return safe;
      }),
      leads: leadRows.map((r): BusinessLead => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        identity: r.identity,
        message: r.message,
        status:
          r.status === 'contacted' ? 'contacted' : r.status === 'closed' ? 'closed' : 'received',
        createdAt: r.createdAt.toISOString(),
      })),
      tasks: tasks.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      expenses: expenseRows.map(({ requestKey: _key, ...r }) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
      automation: {
        enabled: settings.automationEnabled,
        lastRunAt: configRows[0]?.at?.toISOString() ?? null,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async updateLead(actor: CurrentUser, key: string, id: string, status: BusinessLead['status']) {
    return this.store.mutate(actor, key, 'lead.update', { id, status }, async (tx) => {
      const [lead] = await tx
        .update(consultationRequests)
        .set({
          status,
          updatedAt: new Date(),
          ...(status === 'contacted' ? { contactedAt: new Date() } : {}),
        })
        .where(eq(consultationRequests.id, id))
        .returning({ id: consultationRequests.id });
      if (!lead) throw new NotFoundException('线索不存在');
      if (status !== 'received')
        await tx
          .update(businessTasks)
          .set({ status: 'resolved', resolvedAt: new Date() })
          .where(and(eq(businessTasks.kind, 'lead'), eq(businessTasks.referenceId, id)));
      return { id, status };
    });
  }

  async resolveTask(actor: CurrentUser, key: string, id: string) {
    return this.store.mutate(actor, key, 'task.resolve', { id }, async (tx) => {
      const [task] = await tx
        .update(businessTasks)
        .set({ status: 'resolved', resolvedAt: new Date() })
        .where(eq(businessTasks.id, id))
        .returning({ id: businessTasks.id });
      if (!task) throw new NotFoundException('待办不存在');
      return { id, status: 'resolved' };
    });
  }

  async recordExpense(actor: CurrentUser, key: string, input: CreateBusinessExpense) {
    return this.store.mutate(actor, key, 'expense.create', input, async (tx) => {
      const requestKey = `${actor.id}:${key}`;
      const [prior] = await tx
        .select()
        .from(businessExpenses)
        .where(eq(businessExpenses.requestKey, requestKey));
      if (prior) {
        if (
          prior.category !== input.category ||
          prior.amountFen !== input.amountFen ||
          prior.minutes !== input.minutes ||
          prior.note !== input.note ||
          prior.orderId !== input.orderId
        )
          throw new ConflictException({
            code: 'BUSINESS_CONFLICT',
            message: '成本记录幂等标识与原记录不一致',
          });
        return { id: prior.id };
      }
      const id = randomUUID();
      await tx.insert(businessExpenses).values({ ...input, id, requestKey });
      return { id };
    });
  }
}
