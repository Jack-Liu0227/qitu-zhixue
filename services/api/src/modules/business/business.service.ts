import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  businessOffers,
  businessOrders,
  businessSettings,
  guardianLinks,
  pblTemplateTeamBindings,
  projectTemplates,
  projectTemplateVersions,
} from '@qitu/database';
import type {
  BusinessCatalog,
  BusinessSettings,
  CreateBusinessOrder,
  CurrentUser,
  ProjectOffer,
  SaveProjectOffer,
} from '@qitu/contracts';
import { DirectoryService } from '../directory/directory.service';
import { BusinessStore, orderView, type BusinessTransaction } from './business.store';
import { assertSalesSettings } from './business.validation';
import { WechatPayment } from './wechat-payment';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';

@Injectable()
export class BusinessService {
  constructor(
    private readonly store: BusinessStore,
    private readonly directory: DirectoryService,
    private readonly payment: WechatPayment,
  ) {}

  async catalog(): Promise<BusinessCatalog> {
    const settings = await this.store.settings();
    const rows = await this.store
      .database()
      .select({ content: businessOffers.content })
      .from(businessOffers)
      .innerJoin(
        projectTemplateVersions,
        eq(projectTemplateVersions.id, businessOffers.templateVersionId),
      )
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
          eq(businessOffers.status, 'published'),
          eq(projectTemplateVersions.status, 'published'),
          eq(projectTemplates.status, 'published'),
          isNull(projectTemplates.schoolId),
        ),
      );
    const {
      operatorName,
      supportEmail,
      registrationInfo,
      privacyText,
      termsText,
      refundText,
      revision,
    } = settings;
    const configured = this.payment.status().configured;
    return {
      offers: rows.map((r) => r.content),
      operator: {
        operatorName,
        supportEmail,
        registrationInfo,
        privacyText,
        termsText,
        refundText,
        revision,
      },
      purchasing: {
        available: settings.salesEnabled && configured,
        reason: !settings.salesEnabled
          ? '项目包暂未开放购买'
          : !configured
            ? '支付服务尚未开放'
            : '微信扫码支付',
      },
    };
  }

  async saveSettings(actor: CurrentUser, key: string, input: BusinessSettings) {
    return this.store.mutate(actor, key, 'settings.save', input, async (tx) => {
      const current = await this.store.lockSettings(tx);
      if (current.revision !== input.revision) throw changed();
      if (input.salesEnabled && !this.payment.status().configured)
        throw new ConflictException({
          code: 'BUSINESS_NOT_READY',
          message: '请先完成服务器支付商户配置',
        });
      const saved = { ...input, revision: current.revision + 1 };
      await tx
        .update(businessSettings)
        .set({ revision: saved.revision, content: saved, updatedAt: new Date() })
        .where(eq(businessSettings.id, 'platform'));
      return saved;
    });
  }

  async saveOffer(actor: CurrentUser, key: string, input: SaveProjectOffer): Promise<ProjectOffer> {
    return this.store.mutate(actor, key, 'offer.save', input, async (tx) => {
      const settings = await this.store.lockSettings(tx);
      const [existing] = input.id
        ? await tx
            .select()
            .from(businessOffers)
            .where(eq(businessOffers.id, input.id))
            .for('update')
        : [];
      if ((existing?.revision ?? 0) !== input.revision || (input.id && !existing)) throw changed();
      if (
        existing?.publishedAt &&
        (existing.templateVersionId !== input.templateVersionId ||
          existing.requiresPurchase !== input.requiresPurchase)
      ) {
        throw new ConflictException({
          code: 'BUSINESS_CONFLICT',
          message: '曾发布商品的课程版本和购买门槛不可替换，请创建新项目包',
        });
      }
      await this.assertSellableVersion(input.templateVersionId, tx);
      if (input.status === 'published') assertSalesSettings(settings);
      const publishedAt =
        existing?.publishedAt ?? (input.status === 'published' ? new Date() : null);
      const saved: ProjectOffer = {
        ...input,
        id: existing?.id ?? `offer-${randomUUID()}`,
        revision: input.revision + 1,
        publishedAt: publishedAt?.toISOString() ?? null,
      };
      await tx
        .insert(businessOffers)
        .values({
          id: saved.id,
          revision: saved.revision,
          templateVersionId: saved.templateVersionId,
          status: saved.status,
          requiresPurchase: saved.requiresPurchase,
          content: saved,
          publishedAt,
        })
        .onConflictDoUpdate({
          target: businessOffers.id,
          set: {
            revision: saved.revision,
            status: saved.status,
            content: saved,
            publishedAt,
            updatedAt: new Date(),
          },
        });
      return saved;
    });
  }

  async assertGuardian(parentId: string, studentId: string) {
    const permitted = (await this.directory.childrenOfParent(parentId)).some(
      (child) => child.userId === studentId,
    );
    if (!permitted)
      throw new ForbiddenException({
        code: 'BUSINESS_ACCESS_DENIED',
        message: '当前监护关系不允许访问该孩子的订单',
      });
  }

  async orders(actor: CurrentUser, studentId: string) {
    await this.assertGuardian(actor.id, studentId);
    return (
      await this.store
        .database()
        .select()
        .from(businessOrders)
        .where(and(eq(businessOrders.buyerId, actor.id), eq(businessOrders.studentId, studentId)))
        .orderBy(desc(businessOrders.createdAt))
        .limit(100)
    ).map(orderView);
  }

  async createOrder(actor: CurrentUser, key: string, input: CreateBusinessOrder) {
    await this.assertGuardian(actor.id, input.studentId);
    return this.store.mutate(actor, key, 'order.create', input, async (tx) => {
      // Serialize purchases for this exact child and version before allocating an order.
      const settings = await this.store.lockSettings(tx);
      assertSalesSettings(settings);
      if (!settings.salesEnabled || !this.payment.status().configured)
        throw new ConflictException({
          code: 'BUSINESS_NOT_READY',
          message: '购买尚未开放，请联系平台',
        });
      const [offer] = await tx
        .select()
        .from(businessOffers)
        .where(eq(businessOffers.id, input.offerId))
        .for('update');
      if (!offer || offer.status !== 'published') throw new NotFoundException('项目包已下架');
      if (offer.revision !== input.offerRevision || settings.revision !== input.settingsRevision)
        throw changed();
      await this.assertSellableVersion(offer.templateVersionId, tx);
      const [link] = await tx
        .select()
        .from(guardianLinks)
        .where(
          and(
            eq(guardianLinks.parentUserId, actor.id),
            eq(guardianLinks.studentUserId, input.studentId),
            eq(guardianLinks.status, 'active'),
          ),
        )
        .for('share');
      if (!link) throw new ForbiddenException('监护关系已失效');
      const requestHash = hashIdempotentInput('business.order', {}, input);
      const previous = await tx
        .select()
        .from(businessOrders)
        .where(and(eq(businessOrders.buyerId, actor.id), eq(businessOrders.requestKey, key)));
      if (previous[0]) {
        if (previous[0].requestHash !== requestHash) throw changed();
        return orderView(previous[0]);
      }
      const active = await tx
        .select()
        .from(businessOrders)
        .where(
          and(
            eq(businessOrders.studentId, input.studentId),
            eq(businessOrders.templateVersionId, offer.templateVersionId),
          ),
        );
      const now = new Date();
      if (
        active.some(
          (o) =>
            ['paid', 'refund_requested', 'refunding'].includes(o.status) &&
            o.accessUntil &&
            o.accessUntil > now,
        )
      )
        throw new ConflictException({
          code: 'BUSINESS_ALREADY_ENTITLED',
          message: '孩子已开通此课程，无需重复购买',
        });
      if (active.some((o) => o.status === 'pending'))
        throw new ConflictException({
          code: 'BUSINESS_ORDER_PENDING',
          message: '此课程已有待支付或待核对订单，请先查询原订单状态',
        });
      const { operatorName, supportEmail, privacyText, termsText, refundText, revision } = settings;
      const [created] = await tx
        .insert(businessOrders)
        .values({
          id: randomUUID().replaceAll('-', ''),
          buyerId: actor.id,
          studentId: input.studentId,
          offerId: offer.id,
          templateVersionId: offer.templateVersionId,
          offerSnapshot: offer.content,
          termsSnapshot: {
            operatorName,
            supportEmail,
            privacyText,
            termsText,
            refundText,
            revision,
          },
          amountFen: offer.content.priceFen,
          status: 'pending',
          requestKey: key,
          requestHash,
          checkoutExpiresAt: new Date(now.getTime() + 30 * 60_000),
        })
        .returning();
      if (!created) throw new Error('订单创建未返回记录');
      return orderView(created);
    });
  }

  async assertSellableVersion(versionId: string, tx: BusinessTransaction) {
    const [version] = await tx
      .select({ id: projectTemplateVersions.id })
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
          eq(projectTemplateVersions.id, versionId),
          eq(projectTemplateVersions.status, 'published'),
          eq(projectTemplates.status, 'published'),
          isNull(projectTemplates.schoolId),
        ),
      );
    if (!version)
      throw new ConflictException({
        code: 'BUSINESS_COURSE_UNAVAILABLE',
        message: '请选择已发布且教学安排有效的平台课程版本',
      });
  }
}

export function changed() {
  return new ConflictException({
    code: 'BUSINESS_CONFLICT',
    message: '内容已更新，请刷新并核对后重试',
  });
}
