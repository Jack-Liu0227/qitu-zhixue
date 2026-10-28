import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  businessExpenses,
  businessModelUsage,
  businessOrders,
  commerceGrants,
  commerceOrganizations,
  companyTeams,
  companyWork,
  pblTemplateTeamBindings,
  projects,
  projectTemplates,
  projectTemplateVersions,
  users,
} from '@qitu/database';
import {
  COMPANY_DEPARTMENTS,
  type CompanyOverview,
  type CurrentUser,
  type DataMode,
} from '@qitu/contracts';
import { DATA_MODE_TOKEN } from '../../database';
import { BusinessStore } from '../business/business.store';
import { CommerceService } from '../business/commerce.service';
import { CompanyAccess } from './company.access';
import { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { AuditWriter } from '../../common/audit/audit.service';

export function companyWorkView(row: typeof companyWork.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    department: row.department,
    brief: row.brief,
    status: row.status,
    result: row.result,
    error: row.error,
    attempts: row.attempts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
@Injectable()
export class CompanyData {
  constructor(
    private readonly store: BusinessStore,
    private readonly access: CompanyAccess,
    private readonly commerce: CommerceService,
    private readonly registry: PlatformRegistryService,
    private readonly audit: AuditWriter,
    @Optional() @Inject(DATA_MODE_TOKEN) private readonly dataMode: DataMode = 'live',
  ) {}

  /** All values are server aggregates; no prompts, credentials or arbitrary SQL in this API. */
  async metrics() {
    const db = this.store.database();
    const [identity, learning, orders, expenses, usage, members, organizations, pending] =
      await Promise.all([
        db
          .select({ role: users.role, total: count() })
          .from(users)
          .where(isNull(users.disabledAt))
          .groupBy(users.role),
        db
          .select({
            total: count(),
            completed:
              sql<number>`count(*) filter (where ${projects.status} = 'completed')`.mapWith(Number),
          })
          .from(projects),
        db
          .select({
            total: count(),
            paid: sql<number>`count(*) filter (where ${businessOrders.paidAt} is not null)`.mapWith(
              Number,
            ),
            revenue:
              sql<number>`coalesce(sum(${businessOrders.amountFen}) filter (where ${businessOrders.paidAt} is not null),0)`.mapWith(
                Number,
              ),
            refunded:
              sql<number>`coalesce(sum(coalesce(${businessOrders.refundAmountFen},${businessOrders.amountFen})) filter (where ${businessOrders.status} = 'refunded'),0)`.mapWith(
                Number,
              ),
          })
          .from(businessOrders),
        db
          .select({
            total: sql<number>`coalesce(sum(${businessExpenses.amountFen}),0)`.mapWith(Number),
          })
          .from(businessExpenses),
        db
          .select({
            total: count(),
            unknown:
              sql<number>`count(*) filter (where ${businessModelUsage.inputTokens} is null or ${businessModelUsage.outputTokens} is null)`.mapWith(
                Number,
              ),
          })
          .from(businessModelUsage),
        db
          .select({
            total: sql<number>`count(distinct ${commerceGrants.studentId})`.mapWith(Number),
          })
          .from(commerceGrants)
          .where(
            and(
              isNull(commerceGrants.revokedAt),
              isNull(commerceGrants.organizationId),
              sql`${commerceGrants.startsAt} <= now() and ${commerceGrants.endsAt} > now() and ${commerceGrants.product}->>'id' in ('month','year')`,
            ),
          ),
        db.select({ total: count() }).from(commerceOrganizations),
        db
          .select({ total: count() })
          .from(companyWork)
          .where(sql`${companyWork.status} in ('queued','running')`),
      ]);
    return {
      students: identity.find((r) => r.role === 'student')?.total ?? 0,
      parents: identity.find((r) => r.role === 'parent')?.total ?? 0,
      teachers: identity.find((r) => r.role === 'teacher')?.total ?? 0,
      projects: learning[0]?.total ?? 0,
      completedProjects: learning[0]?.completed ?? 0,
      orders: orders[0]?.total ?? 0,
      paidOrders: orders[0]?.paid ?? 0,
      revenueFen: orders[0]?.revenue ?? 0,
      refundedFen: orders[0]?.refunded ?? 0,
      expenseFen: expenses[0]?.total ?? 0,
      aiCalls: usage[0]?.total ?? 0,
      unknownUsage: usage[0]?.unknown ?? 0,
      activeMembers: members[0]?.total ?? 0,
      organizations: organizations[0]?.total ?? 0,
      pendingWork: pending[0]?.total ?? 0,
    };
  }

  async overview(actor: CurrentUser): Promise<CompanyOverview> {
    const role = await this.access.require(actor);
    const db = this.store.database();
    const [metrics, catalog, teams, assistants, templates, work, days] = await Promise.all([
      this.metrics(),
      this.commerce.catalog(),
      db.select().from(companyTeams),
      this.registry.listAssistants(),
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
      db.select().from(companyWork).orderBy(desc(companyWork.createdAt)).limit(50),
      db
        .select({
          day: sql<string>`to_char(${businessOrders.paidAt} at time zone 'Asia/Shanghai','YYYY-MM-DD')`,
          revenueFen: sql<number>`sum(${businessOrders.amountFen})`.mapWith(Number),
          orders: count(),
        })
        .from(businessOrders)
        .where(
          sql`${businessOrders.paidAt} >= (date_trunc('day', now() at time zone 'Asia/Shanghai') - interval '29 days') at time zone 'Asia/Shanghai'`,
        )
        .groupBy(sql`to_char(${businessOrders.paidAt} at time zone 'Asia/Shanghai','YYYY-MM-DD')`),
    ]);
    await this.audit.write({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'company.dashboard.read',
      targetType: 'company',
      detail: { role, scope: 'aggregate', period: 'lifetime-and-30-days' },
    });
    return {
      dataMode: this.dataMode,
      role,
      actor: { id: actor.id, name: actor.displayName, admin: actor.role === 'admin' },
      metrics,
      generatedAt: new Date().toISOString(),
      catalog,
      teams: COMPANY_DEPARTMENTS.map(
        (d) =>
          teams.find((t) => t.department === d.id) ?? {
            department: d.id,
            assistantId: null,
            enabled: false,
            revision: 0,
          },
      ),
      assistants:
        role === 'owner'
          ? assistants.map((a) => ({ id: a.id, name: a.name, enabled: a.enabled }))
          : [],
      templates,
      payment: { configured: catalog.purchasing.available, reason: catalog.purchasing.reason },
      work: work.map(companyWorkView),
      daily: days,
    };
  }
}
