import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  COMMERCE_DEFAULT_PRODUCTS,
  type CommerceCatalog,
  type CommerceCreateOrder,
  type CommercePolicy,
  type CommerceProduct,
  type CurrentUser,
} from '@qitu/contracts';
import {
  businessOrders,
  commerceGrants,
  commerceOrganizations,
  commercePolicies,
  commerceProducts,
  guardianLinks,
  projectTemplateVersions,
  users,
} from '@qitu/database';
import { BusinessStore, orderView, type BusinessTransaction } from './business.store';
import { BusinessService, changed } from './business.service';
import { WechatPayment } from './wechat-payment';
import { assertSalesSettings, integerInput, objectInput, textInput } from './business.validation';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';

export const EMPTY_COMMERCE_POLICY: CommercePolicy = {
  revision: 0,
  enabled: false,
  freeTemplateVersionIds: [],
};
export const isOrganizationProduct = (id: string) =>
  ['pilot', 'institution', 'school'].includes(id);

@Injectable()
export class CommerceService {
  constructor(
    private readonly store: BusinessStore,
    private readonly business: BusinessService,
    private readonly payment: WechatPayment,
  ) {}

  async policy(
    tx: BusinessTransaction | ReturnType<BusinessStore['database']> = this.store.database(),
  ) {
    const [row] = await tx
      .select()
      .from(commercePolicies)
      .where(eq(commercePolicies.id, 'platform'));
    return row?.content ?? EMPTY_COMMERCE_POLICY;
  }

  async catalog(): Promise<CommerceCatalog> {
    const [rows, policy, settings] = await Promise.all([
      this.store.database().select().from(commerceProducts),
      this.policy(),
      this.store.settings(),
    ]);
    return {
      products: COMMERCE_DEFAULT_PRODUCTS.map((p) => rows.find((r) => r.id === p.id)?.content ?? p),
      policy,
      settingsRevision: settings.revision,
      purchasing: {
        available: policy.enabled && settings.salesEnabled && this.payment.status().configured,
        reason: !policy.enabled
          ? '订阅尚未开放'
          : !settings.salesEnabled
            ? '购买尚未开放'
            : this.payment.status().reason,
      },
    };
  }

  async saveProduct(actor: CurrentUser, key: string, body: unknown) {
    if (actor.role !== 'admin') throw new ForbiddenException('商品发布需要 Admin 权限');
    const v = objectInput(body, ['id', 'revision', 'status', 'templateVersionIds']);
    const base = COMMERCE_DEFAULT_PRODUCTS.find((p) => p.id === v.id);
    if (!base) throw new BadRequestException('未知产品');
    const revision = integerInput(v.revision, '版本', 0, 2_000_000_000);
    if (!['draft', 'published', 'conditional', 'archived'].includes(String(v.status)))
      throw new BadRequestException('产品状态无效');
    if (!Array.isArray(v.templateVersionIds) || v.templateVersionIds.length > 200)
      throw new BadRequestException('课程目录无效');
    const ids = [...new Set(v.templateVersionIds.map((id) => textInput(id, '课程版本', 200)))];
    if (['year', 'institution', 'school'].includes(base.id) && v.status === 'published')
      throw new ConflictException({
        code: 'COMMERCE_CONDITIONAL',
        message: '该方案尚未确定收款安排，暂不能发布售卖',
      });
    return this.store.mutate(actor, key, 'commerce.product.save', body, async (tx) => {
      const settings = await this.store.lockSettings(tx);
      const [old] = await tx
        .select()
        .from(commerceProducts)
        .where(eq(commerceProducts.id, base.id));
      if ((old?.revision ?? 0) !== revision) throw changed();
      if (v.status === 'published') {
        assertSalesSettings(settings);
        if (!ids.length || (['trial', 'pilot'].includes(base.id) && ids.length !== 1))
          throw new BadRequestException('体验课和试点需要一个独立课程；会员需要配置目录');
        for (const id of ids) await this.business.assertSellableVersion(id, tx);
        if (base.id === 'trial') {
          const [version] = await tx
            .select({ content: projectTemplateVersions.content })
            .from(projectTemplateVersions)
            .where(eq(projectTemplateVersions.id, ids[0]!));
          const content = version?.content as
            | {
                pbl?: {
                  schedules?: { lessonCount?: number; lessonMinutes?: number }[];
                  curriculum?: {
                    profiles?: { schedule?: { lessonCount?: number; lessonMinutes?: number } }[];
                  };
                };
              }
            | undefined;
          const schedules = [
            ...(content?.pbl?.schedules ?? []),
            ...(content?.pbl?.curriculum?.profiles?.map((p) => p.schedule) ?? []),
          ].filter(Boolean);
          if (
            !schedules.length ||
            schedules.some(
              (s) =>
                s?.lessonCount !== 1 ||
                !s.lessonMinutes ||
                s.lessonMinutes < 20 ||
                s.lessonMinutes > 30,
            )
          )
            throw new ConflictException({
              code: 'COMMERCE_TRIAL_COURSE_REQUIRED',
              message: '体验商品必须绑定独立的 1 课时、20–30 分钟冻结教学版本',
            });
        }
        if (base.id === 'month') {
          const [trial] = await tx
            .select()
            .from(commerceProducts)
            .where(eq(commerceProducts.id, 'trial'));
          if (
            trial?.content.status === 'published' &&
            trial.content.templateVersionIds.some((id) => !ids.includes(id))
          )
            throw new ConflictException('会员目录须包含已发布的体验课版本');
        }
      }
      const content: CommerceProduct = {
        ...base,
        revision: revision + 1,
        status: v.status as CommerceProduct['status'],
        templateVersionIds: ids,
      };
      await tx
        .insert(commerceProducts)
        .values({ id: base.id, revision: content.revision, content })
        .onConflictDoUpdate({
          target: commerceProducts.id,
          set: { revision: content.revision, content },
        });
      return content;
    });
  }

  async savePolicy(actor: CurrentUser, key: string, body: unknown) {
    if (actor.role !== 'admin') throw new ForbiddenException('订阅策略需要 Admin 权限');
    const v = objectInput(body, ['revision', 'enabled', 'freeTemplateVersionIds']);
    if (
      typeof v.enabled !== 'boolean' ||
      !Array.isArray(v.freeTemplateVersionIds) ||
      v.freeTemplateVersionIds.length > 20
    )
      throw new BadRequestException('订阅策略无效');
    const content: CommercePolicy = {
      revision: integerInput(v.revision, '版本', 0, 2_000_000_000),
      enabled: v.enabled,
      freeTemplateVersionIds: [
        ...new Set(v.freeTemplateVersionIds.map((id) => textInput(id, '免费课程版本', 200))),
      ],
    };
    return this.store.mutate(actor, key, 'commerce.policy.save', content, async (tx) => {
      await this.store.lockSettings(tx);
      if ((await this.policy(tx)).revision !== content.revision) throw changed();
      if (content.enabled && !content.freeTemplateVersionIds.length)
        throw new BadRequestException('先选择免费入门课程');
      for (const id of content.freeTemplateVersionIds)
        await this.business.assertSellableVersion(id, tx);
      const saved = { ...content, revision: content.revision + 1 };
      await tx
        .insert(commercePolicies)
        .values({ id: 'platform', content: saved })
        .onConflictDoUpdate({ target: commercePolicies.id, set: { content: saved } });
      return saved;
    });
  }

  async createOrder(actor: CurrentUser, key: string, body: unknown) {
    const v = objectInput(body, [
      'productId',
      'productRevision',
      'settingsRevision',
      'studentId',
      'organizationId',
      'seats',
      'acceptedTerms',
      'guardianConsent',
    ]);
    const base = COMMERCE_DEFAULT_PRODUCTS.find((p) => p.id === v.productId);
    if (!base || v.acceptedTerms !== true || v.guardianConsent !== true)
      throw new BadRequestException('请确认产品、服务条款及购买授权');
    const organization = isOrganizationProduct(base.id);
    if (organization && actor.role !== 'admin')
      throw new ForbiddenException('机构合同当前由平台管理员开通');
    if (!organization && actor.role !== 'parent')
      throw new ForbiddenException('请由家长购买学生权益');
    const studentId = organization ? null : textInput(v.studentId, '学生', 100);
    const organizationId = organization ? textInput(v.organizationId, '机构', 100) : null;
    const seats = organization
      ? integerInput(v.seats ?? base.seats, '席位', base.seats, base.id === 'pilot' ? 30 : 10000)
      : 1;
    if (studentId) await this.business.assertGuardian(actor.id, studentId);
    return this.store.mutate(actor, key, 'commerce.order.create', body, async (tx) => {
      const settings = await this.store.lockSettings(tx);
      if (
        !(await this.policy(tx)).enabled ||
        !settings.salesEnabled ||
        !this.payment.status().configured
      )
        throw new ConflictException({ code: 'BUSINESS_NOT_READY', message: '订阅购买尚未开放' });
      assertSalesSettings(settings);
      const [row] = await tx
        .select()
        .from(commerceProducts)
        .where(eq(commerceProducts.id, base.id));
      if (!row || row.content.status !== 'published') throw new ConflictException('产品尚未发布');
      const product = row.content;
      if (product.revision !== v.productRevision || settings.revision !== v.settingsRevision)
        throw changed();
      for (const id of product.templateVersionIds)
        await this.business.assertSellableVersion(id, tx);
      if (studentId) {
        const [link] = await tx
          .select({ id: guardianLinks.id })
          .from(guardianLinks)
          .where(
            and(
              eq(guardianLinks.parentUserId, actor.id),
              eq(guardianLinks.studentUserId, studentId),
              eq(guardianLinks.status, 'active'),
            ),
          )
          .for('share');
        if (!link) throw new ForbiddenException('监护关系已失效');
      } else {
        const [org] = await tx
          .select()
          .from(commerceOrganizations)
          .where(eq(commerceOrganizations.id, organizationId!));
        if (!org) throw new NotFoundException('机构不存在');
      }
      const requestHash = hashIdempotentInput('commerce.order', {}, body);
      const [previous] = await tx
        .select()
        .from(businessOrders)
        .where(and(eq(businessOrders.buyerId, actor.id), eq(businessOrders.requestKey, key)));
      if (previous) {
        if (previous.requestHash !== requestHash) throw changed();
        return orderView(previous);
      }
      const prior = studentId
        ? await tx.select().from(businessOrders).where(eq(businessOrders.studentId, studentId))
        : [];
      if (prior.some((o) => o.subscription && o.status === 'pending'))
        throw new ConflictException('已有待支付订阅，请先核对原订单');
      const trial = prior.find((o) => o.subscription?.product.id === 'trial' && o.paidAt !== null);
      if (base.id === 'trial' && trial) throw new ConflictException('每位学生只能购买一次体验课');
      const now = new Date();
      if (
        base.id === 'trial' &&
        prior.some(
          (o) =>
            ['month', 'year'].includes(o.subscription?.product.id ?? '') &&
            ['paid', 'refund_requested', 'refunding'].includes(o.status) &&
            o.accessUntil &&
            o.accessUntil > now,
        )
      )
        throw new ConflictException('会员已包含体验，无需购买体验课');
      const eligible =
        base.id === 'month' &&
        trial &&
        trial.status === 'paid' &&
        trial.paidAt &&
        now.getTime() < trial.paidAt.getTime() + 7 * 86_400_000 &&
        !prior.some(
          (o) =>
            (o.subscription?.discountOrderId === trial.id && o.status !== 'cancelled') ||
            (['month', 'year'].includes(o.subscription?.product.id ?? '') && o.paidAt !== null),
        );
      const originalAmountFen = product.priceFen + product.seatPriceFen * seats;
      const discountFen = eligible ? trial.amountFen : 0;
      const { operatorName, supportEmail, privacyText, termsText, refundText, revision } = settings;
      const [order] = await tx
        .insert(businessOrders)
        .values({
          id: randomUUID().replaceAll('-', ''),
          buyerId: actor.id,
          studentId,
          subscription: {
            product,
            seats,
            originalAmountFen,
            discountFen,
            discountOrderId: eligible ? trial.id : null,
            organizationId,
          },
          termsSnapshot: {
            operatorName,
            supportEmail,
            privacyText,
            termsText,
            refundText,
            revision,
          },
          amountFen: originalAmountFen - discountFen,
          status: 'pending',
          requestKey: key,
          requestHash,
          checkoutExpiresAt: new Date(now.getTime() + 30 * 60_000),
        })
        .returning();
      return orderView(order!);
    });
  }

  async organizations() {
    const db = this.store.database();
    const [organizations, orders, grants] = await Promise.all([
      db.select().from(commerceOrganizations),
      db
        .select()
        .from(businessOrders)
        .where(sql`${businessOrders.subscription}->>'organizationId' IS NOT NULL`)
        .orderBy(desc(businessOrders.createdAt))
        .limit(200),
      db
        .select({
          id: commerceGrants.id,
          orderId: commerceGrants.orderId,
          studentId: commerceGrants.studentId,
          organizationId: commerceGrants.organizationId,
          startsAt: commerceGrants.startsAt,
          endsAt: commerceGrants.endsAt,
          revokedAt: commerceGrants.revokedAt,
        })
        .from(commerceGrants)
        .where(sql`${commerceGrants.organizationId} IS NOT NULL`)
        .limit(5000),
    ]);
    return { organizations, orders: orders.map(orderView), seats: grants };
  }

  async createOrganization(actor: CurrentUser, key: string, body: unknown) {
    if (actor.role !== 'admin') throw new ForbiddenException('机构创建需要 Admin 权限');
    const v = objectInput(body, ['name']);
    const name = textInput(v.name, '机构名称', 120);
    return this.store.mutate(actor, key, 'commerce.organization.create', { name }, async (tx) => {
      const [row] = await tx
        .insert(commerceOrganizations)
        .values({ id: randomUUID(), name, createdBy: actor.id })
        .returning();
      return row;
    });
  }

  async assignSeat(actor: CurrentUser, key: string, body: unknown) {
    if (actor.role !== 'admin') throw new ForbiddenException('机构席位管理需要 Admin 权限');
    const v = objectInput(body, ['orderId', 'studentId']);
    const orderId = textInput(v.orderId, '订单', 100),
      studentId = textInput(v.studentId, '学生', 100);
    return this.store.mutate(
      actor,
      key,
      'commerce.seat.assign',
      { orderId, studentId },
      async (tx) => {
        await this.store.lockSettings(tx);
        const [order] = await tx
          .select()
          .from(businessOrders)
          .where(eq(businessOrders.id, orderId))
          .for('update');
        if (
          !order?.subscription?.organizationId ||
          order.status !== 'paid' ||
          !order.serviceStartsAt ||
          !order.accessUntil ||
          order.accessUntil <= new Date()
        )
          throw new ConflictException('机构合同未生效或已到期');
        const [student] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, studentId), eq(users.role, 'student'), isNull(users.disabledAt)));
        if (!student) throw new NotFoundException('有效学生账号不存在');
        const assigned = await tx
          .select()
          .from(commerceGrants)
          .where(eq(commerceGrants.orderId, orderId));
        const prior = assigned.find((g) => g.studentId === studentId);
        if (prior) return prior;
        if (assigned.length >= order.subscription.seats)
          throw new ConflictException('合同席位已用完');
        const [grant] = await tx
          .insert(commerceGrants)
          .values({
            id: randomUUID(),
            orderId,
            studentId,
            organizationId: order.subscription.organizationId,
            product: order.subscription.product,
            startsAt: order.serviceStartsAt,
            endsAt: order.accessUntil,
          })
          .returning();
        return grant;
      },
    );
  }
}
