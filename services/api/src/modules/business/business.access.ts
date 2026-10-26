import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { businessOffers, businessOrders, guardianLinks, type Database } from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';
import type { BusinessTransaction } from './business.store';

@Injectable()
export class BusinessAccess {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null) {}

  async assertCanStart(
    studentId: string,
    versionId: string | null,
    tx?: BusinessTransaction,
  ): Promise<void> {
    const executor = tx ?? this.db;
    if (!versionId) return;
    if (!executor)
      throw new ServiceUnavailableException({
        code: 'BUSINESS_UNAVAILABLE',
        message: '课程权益暂时无法核验，请稍后重试',
      });
    const controlled = await executor
      .select({ id: businessOffers.id })
      .from(businessOffers)
      .where(
        and(
          eq(businessOffers.templateVersionId, versionId),
          eq(businessOffers.requiresPurchase, true),
          isNotNull(businessOffers.publishedAt),
        ),
      )
      .for('share');
    if (controlled.length === 0) return;
    const entitled = await executor
      .select({ id: businessOrders.id })
      .from(businessOrders)
      .innerJoin(
        guardianLinks,
        and(
          eq(guardianLinks.studentUserId, businessOrders.studentId),
          eq(guardianLinks.parentUserId, businessOrders.buyerId),
          eq(guardianLinks.status, 'active'),
        ),
      )
      .where(
        and(
          eq(businessOrders.studentId, studentId),
          eq(businessOrders.templateVersionId, versionId),
          inArray(businessOrders.status, ['paid', 'refund_requested', 'refunding']),
          gt(businessOrders.accessUntil, new Date()),
        ),
      )
      .for('share');
    if (entitled.length === 0)
      throw new ForbiddenException({
        code: 'BUSINESS_ENTITLEMENT_REQUIRED',
        message: '此课程需要由已授权监护人开通后再确认项目',
      });
  }
}
