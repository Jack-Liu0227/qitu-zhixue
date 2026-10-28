import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  businessOrders,
  commerceGrants,
  commerceProjectAccess,
  commerceUsage,
  projects,
  users,
} from '@qitu/database';
import type { CommerceAccount, CommerceEntitlement } from '@qitu/contracts';
import { BusinessStore, type BusinessTransaction } from './business.store';
import { CommerceService } from './commerce.service';
import { commerceCycle, freeCommerceCycle } from './commerce.rules';

type Grant = typeof commerceGrants.$inferSelect;
type Executor = BusinessTransaction | ReturnType<BusinessStore['database']>;
const grantPriority = (g: Grant) =>
  g.organizationId ? 0 : ['month', 'year'].includes(g.product.id) ? 1 : 2;
const missing = () =>
  new ForbiddenException({
    code: 'BUSINESS_ENTITLEMENT_REQUIRED',
    message: '此课程需要有效的会员、体验或机构权益，请由家长查看购买入口',
  });

@Injectable()
export class CommerceAccess {
  constructor(
    private readonly store: BusinessStore,
    private readonly commerce: CommerceService,
  ) {}

  private async lockStudent(tx: BusinessTransaction, studentId: string) {
    const [student] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, studentId), eq(users.role, 'student'), isNull(users.disabledAt)))
      .for('no key update');
    if (!student) throw new ForbiddenException('学生账号不可用');
  }

  private async grants(tx: Executor, studentId: string, now = new Date()) {
    return tx
      .select()
      .from(commerceGrants)
      .where(
        and(
          eq(commerceGrants.studentId, studentId),
          isNull(commerceGrants.revokedAt),
          sql`${commerceGrants.startsAt} <= ${now}`,
          gt(commerceGrants.endsAt, now),
        ),
      );
  }

  private async usage(tx: Executor, studentId: string, bucket: string) {
    const [row] = await tx
      .select({
        used: sql<number>`count(*) filter(where ${commerceUsage.status} = 'committed')`.mapWith(
          Number,
        ),
        reserved:
          sql<number>`count(*) filter(where ${commerceUsage.status} = 'reserved' and ${commerceUsage.leaseUntil} > now())`.mapWith(
            Number,
          ),
      })
      .from(commerceUsage)
      .where(and(eq(commerceUsage.studentId, studentId), eq(commerceUsage.bucket, bucket)));
    return row ?? { used: 0, reserved: 0 };
  }

  private grantCycle(grant: Grant, now = new Date()) {
    const cycle = commerceCycle(grant.startsAt, grant.endsAt, grant.product.months > 0, now);
    return { ...cycle, bucket: `${grant.id}:${cycle.from.toISOString()}` };
  }

  async account(studentId: string): Promise<CommerceAccount> {
    const db = this.store.database();
    const now = new Date();
    const policy = await this.commerce.policy();
    const grants = await db
      .select()
      .from(commerceGrants)
      .where(
        and(
          eq(commerceGrants.studentId, studentId),
          isNull(commerceGrants.revokedAt),
          gt(commerceGrants.endsAt, now),
        ),
      );
    const entitlements: CommerceEntitlement[] = await Promise.all(
      grants.map(async (grant) => {
        const cycle = this.grantCycle(grant, now);
        const [usage, linked] = await Promise.all([
          this.usage(db, studentId, cycle.bucket),
          db
            .select({ id: commerceProjectAccess.projectId })
            .from(commerceProjectAccess)
            .where(eq(commerceProjectAccess.grantId, grant.id)),
        ]);
        return {
          id: grant.id,
          studentId,
          title: grant.product.title,
          source: grant.product.id,
          organizationId: grant.organizationId,
          startsAt: grant.startsAt.toISOString(),
          endsAt: grant.endsAt.toISOString(),
          quota: grant.product.quota,
          ...usage,
          resetsAt: cycle.until.toISOString(),
          templateVersionIds: grant.product.templateVersionIds,
          projectLimit: grant.product.projectLimit,
          projectsUsed: linked.length,
        };
      }),
    );
    const cycle = freeCommerceCycle(now);
    entitlements.push({
      id: 'free',
      studentId,
      title: '基础版',
      source: 'free',
      organizationId: null,
      startsAt: cycle.from.toISOString(),
      endsAt: cycle.until.toISOString(),
      resetsAt: cycle.until.toISOString(),
      quota: 10,
      ...(await this.usage(db, studentId, `free:${cycle.from.toISOString()}`)),
      templateVersionIds: policy.freeTemplateVersionIds,
      projectLimit: 1,
      projectsUsed: (
        await db
          .select({ id: commerceProjectAccess.projectId })
          .from(commerceProjectAccess)
          .where(
            and(
              eq(commerceProjectAccess.studentId, studentId),
              eq(commerceProjectAccess.source, 'free'),
            ),
          )
      ).length,
    });
    const orders = await db
      .select()
      .from(businessOrders)
      .where(eq(businessOrders.studentId, studentId));
    const trial = orders.find((o) => o.subscription?.product.id === 'trial' && o.paidAt);
    const eligible =
      trial?.status === 'paid' &&
      trial.paidAt &&
      now.getTime() < trial.paidAt.getTime() + 7 * 86_400_000 &&
      !orders.some(
        (o) =>
          (o.subscription?.discountOrderId === trial.id && o.status !== 'cancelled') ||
          (['month', 'year'].includes(o.subscription?.product.id ?? '') && o.paidAt !== null),
      );
    return {
      studentId,
      enabled: policy.enabled,
      entitlements,
      trialPurchased: !!trial,
      trialDiscountFen: eligible ? trial.amountFen : 0,
      generatedAt: now.toISOString(),
    };
  }

  /** Returns false while the new policy is disabled, preserving the previous access owner. */
  async start(
    studentId: string,
    versionId: string,
    projectId: string | undefined,
    tx?: BusinessTransaction,
  ): Promise<boolean> {
    if (!tx)
      return this.store
        .database()
        .transaction((inner) => this.start(studentId, versionId, projectId, inner));
    const policy = await this.commerce.policy(tx);
    if (!policy.enabled) return false;
    if (!projectId) throw new ConflictException('权益开通缺少稳定项目标识');
    await this.lockStudent(tx, studentId);
    const [prior] = await tx
      .select()
      .from(commerceProjectAccess)
      .where(eq(commerceProjectAccess.projectId, projectId));
    if (prior) {
      if (prior.studentId !== studentId || prior.templateVersionId !== versionId) throw missing();
      return true;
    }
    const grants = (await this.grants(tx, studentId)).filter((g) =>
      g.product.templateVersionIds.includes(versionId),
    );
    grants.sort(
      (a, b) => grantPriority(a) - grantPriority(b) || a.endsAt.getTime() - b.endsAt.getTime(),
    );
    for (const grant of grants) {
      const linked = await tx
        .select({ id: commerceProjectAccess.projectId })
        .from(commerceProjectAccess)
        .where(eq(commerceProjectAccess.grantId, grant.id));
      if (grant.product.projectLimit !== null && linked.length >= grant.product.projectLimit)
        continue;
      await tx.insert(commerceProjectAccess).values({
        projectId,
        studentId,
        templateVersionId: versionId,
        grantId: grant.id,
        source: 'grant',
      });
      return true;
    }
    const [legacy] = await tx
      .select({ id: businessOrders.id })
      .from(businessOrders)
      .where(
        and(
          eq(businessOrders.studentId, studentId),
          eq(businessOrders.templateVersionId, versionId),
          inArray(businessOrders.status, ['paid', 'refund_requested', 'refunding']),
          gt(businessOrders.accessUntil, new Date()),
        ),
      );
    if (legacy) {
      await tx
        .insert(commerceProjectAccess)
        .values({ projectId, studentId, templateVersionId: versionId, source: 'legacy' });
      return true;
    }
    if (policy.freeTemplateVersionIds.includes(versionId)) {
      const [used] = await tx
        .select({ id: commerceProjectAccess.projectId })
        .from(commerceProjectAccess)
        .where(
          and(
            eq(commerceProjectAccess.studentId, studentId),
            eq(commerceProjectAccess.source, 'free'),
          ),
        );
      if (!used) {
        await tx
          .insert(commerceProjectAccess)
          .values({ projectId, studentId, templateVersionId: versionId, source: 'free' });
        return true;
      }
    }
    throw missing();
  }

  async reserve(
    studentId: string,
    projectId: string | null,
    requestId: string,
  ): Promise<string | null> {
    if (!(await this.commerce.policy()).enabled) return null;
    const id = createHash('sha256').update(`${studentId}:${requestId}`).digest('hex');
    return this.store.database().transaction(async (tx) => {
      await this.lockStudent(tx, studentId);
      const [previous] = await tx.select().from(commerceUsage).where(eq(commerceUsage.id, id));
      if (previous?.status === 'committed') return id;
      if (previous?.status === 'reserved' && previous.leaseUntil > new Date())
        throw new ConflictException('该回合仍在处理中');
      const now = new Date();
      let versionId: string | null = null;
      if (projectId) {
        const [project] = await tx
          .select({ version: projects.templateVersionId })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.studentUserId, studentId)));
        if (!project) throw missing();
        versionId = project.version;
        const [link] = await tx
          .select()
          .from(commerceProjectAccess)
          .where(eq(commerceProjectAccess.projectId, projectId));
        if (link?.source === 'legacy') return null;
        // Existing purchased course projects retain their original delivery entitlement.
        if (!link && versionId) {
          const [legacy] = await tx
            .select({ id: businessOrders.id })
            .from(businessOrders)
            .where(
              and(
                eq(businessOrders.studentId, studentId),
                eq(businessOrders.templateVersionId, versionId),
                inArray(businessOrders.status, ['paid', 'refund_requested', 'refunding']),
              ),
            );
          if (legacy) return null;
        }
      }
      const grants = (await this.grants(tx, studentId, now)).filter((g) =>
        versionId
          ? g.product.templateVersionIds.includes(versionId)
          : !g.organizationId && ['month', 'year'].includes(g.product.id),
      );
      grants.sort(
        (a, b) => grantPriority(a) - grantPriority(b) || a.endsAt.getTime() - b.endsAt.getTime(),
      );
      // One request uses one entitlement, never a combined pool.
      const grant = grants[0];
      const policy = await this.commerce.policy(tx);
      if (versionId && !grant && !policy.freeTemplateVersionIds.includes(versionId))
        throw missing();
      const cycle = grant
        ? this.grantCycle(grant, now)
        : {
            ...freeCommerceCycle(now),
            bucket: `free:${freeCommerceCycle(now).from.toISOString()}`,
          };
      const usage = await this.usage(tx, studentId, cycle.bucket);
      if (usage.used + usage.reserved >= (grant?.product.quota ?? 10))
        throw new ForbiddenException({
          code: 'COMMERCE_QUOTA_EXHAUSTED',
          message: '本周期 AI 交互额度已用完；作品和已有记录仍可查看',
          resetsAt: cycle.until.toISOString(),
        });
      await tx
        .insert(commerceUsage)
        .values({
          id,
          studentId,
          grantId: grant?.id ?? null,
          bucket: cycle.bucket,
          status: 'reserved',
          leaseUntil: new Date(now.getTime() + 15 * 60_000),
        })
        .onConflictDoUpdate({
          target: commerceUsage.id,
          set: {
            status: 'reserved',
            grantId: grant?.id ?? null,
            bucket: cycle.bucket,
            leaseUntil: new Date(now.getTime() + 15 * 60_000),
          },
        });
      return id;
    });
  }

  async settle(id: string | null, successful: boolean) {
    if (!id) return;
    await this.store
      .database()
      .update(commerceUsage)
      .set({ status: successful ? 'committed' : 'released' })
      .where(and(eq(commerceUsage.id, id), eq(commerceUsage.status, 'reserved')));
  }
}
