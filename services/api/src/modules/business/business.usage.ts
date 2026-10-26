import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { businessModelUsage, type Database } from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';
import type { ModelCompletionResult } from '../model-registry/model-gateway.types';

@Injectable()
export class BusinessUsage {
  private readonly logger = new Logger(BusinessUsage.name);
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null) {}
  async record(usageId: string, result: ModelCompletionResult): Promise<void> {
    if (!this.db) return;
    try {
      const bounded = (value: number | null | undefined) =>
        typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2_000_000_000
          ? value
          : null;
      await this.db.insert(businessModelUsage).values({
        id: randomUUID(),
        usageId: usageId.slice(0, 150),
        providerId: result.providerId.slice(0, 150),
        modelId: result.modelId.slice(0, 150),
        inputTokens: bounded(result.usage?.inputTokens),
        outputTokens: bounded(result.usage?.outputTokens),
      });
    } catch {
      this.logger.warn('模型用量记录失败，本次用量不会被计为零');
    }
  }
}
