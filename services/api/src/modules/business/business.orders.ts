import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { businessOrders } from '@qitu/database';
import type { CurrentUser } from '@qitu/contracts';
import { BusinessService } from './business.service';
import { BusinessStore, orderView, type OrderRecord } from './business.store';
import { WechatPayment, type PaymentFact, type RefundFact } from './wechat-payment';
import { AuditWriter } from '../../common/audit/audit.service';

/** Reject stale or mismatched gateway facts before changing any commercial access. */
export function validatePaymentFact(
  order: Pick<OrderRecord, 'id' | 'amountFen' | 'transactionId'>,
  fact: PaymentFact,
): void {
  if (
    order.id !== fact.orderId ||
    order.amountFen !== fact.amountFen ||
    (order.transactionId !== null && order.transactionId !== fact.transactionId)
  ) {
    throw new ConflictException({ code: 'PAYMENT_FACT_CONFLICT', message: '支付凭据与订单不一致' });
  }
}

@Injectable()
export class BusinessOrders {
  constructor(
    private readonly store: BusinessStore,
    private readonly business: BusinessService,
    private readonly payment: WechatPayment,
    private readonly audit: AuditWriter,
  ) {}

  async owned(actor: CurrentUser, id: string) {
    const [order] = await this.store
      .database()
      .select()
      .from(businessOrders)
      .where(and(eq(businessOrders.id, id), eq(businessOrders.buyerId, actor.id)));
    if (!order) throw new NotFoundException('订单不存在');
    await this.business.assertGuardian(actor.id, order.studentId);
    return order;
  }

  async checkout(actor: CurrentUser, id: string, key: string) {
    await this.owned(actor, id);
    return this.store.mutate(actor, key, 'order.checkout', { id }, async (tx) => {
      const [order] = await tx
        .select()
        .from(businessOrders)
        .where(eq(businessOrders.id, id))
        .for('update');
      if (
        !order ||
        order.status !== 'pending' ||
        order.checkoutExpiresAt.getTime() <= Date.now() + 60_000
      )
        throw new ConflictException({
          code: 'BUSINESS_ORDER_EXPIRED',
          message: '订单已关闭或支付时间已过，请先查询付款结果',
        });
      if (order.checkoutUrl) return orderView(order);
      const code = await this.payment.create({
        id,
        amountFen: order.amountFen,
        title: order.offerSnapshot.title,
        expiresAt: order.checkoutExpiresAt,
      });
      const [saved] = await tx
        .update(businessOrders)
        .set({ checkoutUrl: code, updatedAt: new Date() })
        .where(eq(businessOrders.id, id))
        .returning();
      if (!saved) throw new Error('支付信息保存失败');
      return orderView(saved);
    });
  }

  async reconcile(actor: CurrentUser, id: string) {
    const order = await this.owned(actor, id);
    if (order.status === 'pending' || order.status === 'cancelled') {
      const fact = await this.payment.query(id);
      if (fact) await this.acceptPayment(fact);
      else if (order.status === 'pending' && order.checkoutExpiresAt <= new Date()) {
        await this.payment.close(id);
        await this.store.database().transaction(async (tx) => {
          const changed = await tx
            .update(businessOrders)
            .set({ status: 'cancelled', checkoutUrl: null, updatedAt: new Date() })
            .where(and(eq(businessOrders.id, id), eq(businessOrders.status, 'pending')))
            .returning({ id: businessOrders.id });
          if (changed.length)
            await this.audit.write(
              {
                actorId: actor.id,
                actorRole: actor.role,
                action: 'business.order.closed',
                targetType: 'business_order',
                targetId: id,
                detail: { reason: 'expired-verified-closed' },
              },
              tx,
            );
        });
      }
    } else if (order.status === 'refunding' && order.refundId) {
      await this.acceptRefund(await this.payment.queryRefund(order.refundId));
    }
    return orderView(await this.owned(actor, id));
  }

  async requestRefund(actor: CurrentUser, id: string, reason: string, key: string) {
    await this.owned(actor, id);
    return this.store.mutate(actor, key, 'refund.request', { id, reason }, async (tx) => {
      const [order] = await tx
        .select()
        .from(businessOrders)
        .where(eq(businessOrders.id, id))
        .for('update');
      if (!order || !['paid', 'refund_requested'].includes(order.status))
        throw new ConflictException({
          code: 'BUSINESS_REFUND_INVALID',
          message: '当前订单不能申请退款',
        });
      if (order.status === 'refund_requested') return orderView(order);
      const [saved] = await tx
        .update(businessOrders)
        .set({ status: 'refund_requested', refundReason: reason, updatedAt: new Date() })
        .where(eq(businessOrders.id, id))
        .returning();
      if (!saved) throw new Error('退款申请保存失败');
      return orderView(saved);
    });
  }

  async approveRefund(actor: CurrentUser, id: string, key: string) {
    // Persist intent before contacting WeChat. Retrying uses the same refund id.
    const order = await this.store.mutate(actor, key, 'refund.approve', { id }, async (tx) => {
      const [current] = await tx
        .select()
        .from(businessOrders)
        .where(eq(businessOrders.id, id))
        .for('update');
      if (!current || !['refund_requested', 'refunding', 'refunded'].includes(current.status))
        throw new ConflictException({
          code: 'BUSINESS_REFUND_INVALID',
          message: '订单没有待处理退款',
        });
      if (current.status === 'refunded') return orderView(current);
      const [saved] = await tx
        .update(businessOrders)
        .set({ status: 'refunding', refundId: `rf${id}`, updatedAt: new Date() })
        .where(eq(businessOrders.id, id))
        .returning();
      if (!saved) throw new Error('退款处理保存失败');
      return orderView(saved);
    });
    if (order.status !== 'refunded')
      await this.acceptRefund(
        await this.payment.refund({ id, amountFen: order.amountFen, refundId: `rf${id}` }),
      );
    const [saved] = await this.store
      .database()
      .select()
      .from(businessOrders)
      .where(eq(businessOrders.id, id));
    if (!saved) throw new NotFoundException('订单不存在');
    return { id, status: saved.status };
  }

  async acceptPayment(fact: PaymentFact) {
    await this.store.database().transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(businessOrders)
        .where(eq(businessOrders.id, fact.orderId))
        .for('update');
      if (!order) throw new NotFoundException('订单不存在');
      validatePaymentFact(order, fact);
      if (order.transactionId === fact.transactionId) return;
      if (!['pending', 'cancelled'].includes(order.status))
        throw new ConflictException('订单状态不接受支付回执');
      const paidAt = new Date(fact.paidAt);
      await tx
        .update(businessOrders)
        .set({
          status: 'paid',
          transactionId: fact.transactionId,
          paidAt,
          accessUntil: new Date(paidAt.getTime() + order.offerSnapshot.accessDays * 86_400_000),
          checkoutUrl: null,
          updatedAt: new Date(),
        })
        .where(eq(businessOrders.id, order.id));
      await this.audit.write(
        {
          action: 'business.payment.verified',
          targetType: 'business_order',
          targetId: order.id,
          detail: { amountFen: order.amountFen },
        },
        tx,
      );
    });
  }

  async acceptRefund(fact: RefundFact) {
    await this.store.database().transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(businessOrders)
        .where(eq(businessOrders.id, fact.orderId))
        .for('update');
      if (!order || order.refundId !== fact.refundId || order.amountFen !== fact.amountFen)
        throw new ConflictException({
          code: 'PAYMENT_FACT_CONFLICT',
          message: '退款凭据与订单不一致',
        });
      if (order.status === 'refunded' || fact.status === 'PROCESSING') return;
      if (fact.status !== 'SUCCESS') {
        await tx
          .update(businessOrders)
          .set({ status: 'refund_requested', updatedAt: new Date() })
          .where(eq(businessOrders.id, order.id));
        return;
      }
      await tx
        .update(businessOrders)
        .set({ status: 'refunded', checkoutUrl: null, updatedAt: new Date() })
        .where(eq(businessOrders.id, order.id));
      await this.audit.write(
        {
          action: 'business.refund.verified',
          targetType: 'business_order',
          targetId: order.id,
          detail: { amountFen: order.amountFen },
        },
        tx,
      );
    });
  }
}
