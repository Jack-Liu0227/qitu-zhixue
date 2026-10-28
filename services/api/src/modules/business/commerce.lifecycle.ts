import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { businessOrders, commerceGrants } from '@qitu/database';
import type { BusinessTransaction, OrderRecord } from './business.store';
import { commerceEnd, refundableFen } from './commerce.rules';

export async function activateCommerceOrder(
  tx: BusinessTransaction,
  order: OrderRecord,
  paidAt: Date,
) {
  if (!order.subscription)
    return {
      serviceStartsAt: paidAt,
      accessUntil: new Date(paidAt.getTime() + (order.offerSnapshot?.accessDays ?? 0) * 86_400_000),
    };
  const product = order.subscription.product;
  let startsAt = paidAt;
  if (order.studentId && ['month', 'year'].includes(product.id)) {
    const prior = await tx
      .select()
      .from(commerceGrants)
      .where(
        and(
          eq(commerceGrants.studentId, order.studentId),
          isNull(commerceGrants.revokedAt),
          isNull(commerceGrants.organizationId),
        ),
      );
    for (const grant of prior)
      if (['month', 'year'].includes(grant.product.id) && grant.endsAt > startsAt)
        startsAt = grant.endsAt;
  }
  const endsAt = commerceEnd(startsAt, product);
  if (order.studentId)
    await tx
      .insert(commerceGrants)
      .values({
        id: randomUUID(),
        orderId: order.id,
        studentId: order.studentId,
        product,
        startsAt,
        endsAt,
      })
      .onConflictDoNothing();
  return { serviceStartsAt: startsAt, accessUntil: endsAt };
}

export async function commerceRefundAmount(
  tx: BusinessTransaction,
  order: OrderRecord,
  now = new Date(),
) {
  if (!order.subscription) return order.amountFen;
  const linked = await tx
    .select({ id: businessOrders.id })
    .from(businessOrders)
    .where(
      and(
        sql`${businessOrders.subscription}->>'discountOrderId' = ${order.id}`,
        inArray(businessOrders.status, ['pending', 'paid', 'refund_requested', 'refunding']),
      ),
    );
  if (linked.length)
    throw new ConflictException({
      code: 'COMMERCE_LINKED_REFUND',
      message: '体验优惠已用于其他订单，请先处理关联会员订单，再申请体验课退款',
    });
  if (!order.serviceStartsAt || !order.accessUntil) throw new ConflictException('订单权益尚未核实');
  // Trial refunds are reviewed by the operator, including service failures.
  if (order.subscription.product.id === 'trial') return order.amountFen;
  const amount = refundableFen(order.amountFen, order.serviceStartsAt, order.accessUntil, now);
  if (!amount)
    throw new ConflictException({
      code: 'COMMERCE_REFUND_REVIEW_REQUIRED',
      message: '可退未履行期间为零；服务异常退款请联系客服人工核实',
    });
  return amount;
}

export async function revokeCommerceOrder(tx: BusinessTransaction, id: string) {
  await tx
    .update(commerceGrants)
    .set({ revokedAt: new Date() })
    .where(eq(commerceGrants.orderId, id));
}
