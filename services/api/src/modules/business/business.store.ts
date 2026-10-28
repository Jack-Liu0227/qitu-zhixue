import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { businessOrders, businessSettings, type Database } from '@qitu/database';
import type { BusinessOrder, CurrentUser } from '@qitu/contracts';
import { eq } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter, type AuditTransaction } from '../../common/audit/audit.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { EMPTY_BUSINESS_SETTINGS } from './business.validation';

export type BusinessTransaction = AuditTransaction;
export type OrderRecord = typeof businessOrders.$inferSelect;

export function orderView(row: OrderRecord): BusinessOrder {
  return {
    id: row.id,
    studentId: row.studentId,
    offer: row.offerSnapshot,
    subscription: row.subscription,
    serviceStartsAt: row.serviceStartsAt?.toISOString() ?? null,
    refundAmountFen: row.refundAmountFen,
    amountFen: row.amountFen,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    accessUntil: row.accessUntil?.toISOString() ?? null,
    checkoutUrl: row.checkoutUrl,
    checkoutExpiresAt: row.checkoutExpiresAt.toISOString(),
    refundReason: row.refundReason,
    terms: row.termsSnapshot,
  };
}

@Injectable()
export class BusinessStore {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly audit: AuditWriter,
    private readonly idempotency: IdempotencyStore,
  ) {}

  database(): Database {
    if (!this.db)
      throw new ServiceUnavailableException({
        code: 'BUSINESS_UNAVAILABLE',
        message: '经营服务尚未连接持久化存储',
      });
    return this.db;
  }

  async settings(executor: Database | BusinessTransaction = this.database()) {
    const [row] = await executor
      .select()
      .from(businessSettings)
      .where(eq(businessSettings.id, 'platform'));
    return row?.content ?? { ...EMPTY_BUSINESS_SETTINGS };
  }

  async lockSettings(tx: BusinessTransaction) {
    await tx
      .insert(businessSettings)
      .values({ id: 'platform', revision: 0, content: { ...EMPTY_BUSINESS_SETTINGS } })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(businessSettings)
      .where(eq(businessSettings.id, 'platform'))
      .for('update');
    if (!row) throw new ServiceUnavailableException('经营配置不可用');
    return row.content;
  }

  async mutate<T>(
    actor: CurrentUser,
    key: string,
    action: string,
    input: unknown,
    handler: (tx: BusinessTransaction) => Promise<T>,
  ): Promise<T> {
    if (!key || key.length > 160)
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '缺少操作幂等标识',
      });
    const scope = `business.${action}:${actor.id}`;
    try {
      const response = await this.idempotency.execute(
        scope,
        key,
        hashIdempotentInput(scope, {}, input),
        async () => ({
          status: 200,
          body: await this.database().transaction(async (tx) => {
            const result = await handler(tx);
            await this.audit.write(
              {
                actorId: actor.id,
                actorRole: actor.role,
                action: `business.${action}`,
                targetType: 'business',
                detail: { requestKeyHash: hashIdempotentInput(scope, {}, { key }) },
              },
              tx,
            );
            return result;
          }),
        }),
      );
      return response.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }
}
