import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { parentGrowthExports, type Database } from '@qitu/database';
import type { ParentGrowthExportDocument, ParentGrowthExportStatus } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { GrowthExportStore, type GrowthExportRecord } from './growth-export.types';

/**
 * 导出任务的 Postgres 实现（Parent Experience 独占写入本表）。
 *
 * 无内存回退：`parent.module.ts` 只在 `DATABASE_TOKEN` 非空时提供本实现，
 * 否则提供 `null`，由 service 诚实返回 503。
 */
@Injectable()
export class PostgresGrowthExportStore extends GrowthExportStore {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {
    super();
  }

  async save(record: GrowthExportRecord): Promise<void> {
    await this.db.insert(parentGrowthExports).values({
      id: record.id,
      parentUserId: record.parentId,
      childUserId: record.childId,
      childDisplayName: record.childDisplayName,
      status: record.status,
      reason: record.reason,
      document: record.document,
      createdAt: record.createdAt,
      readyAt: record.readyAt,
      expiresAt: record.expiresAt,
      downloadedAt: record.downloadedAt,
    });
  }

  async findById(id: string): Promise<GrowthExportRecord | null> {
    const rows = await this.db
      .select()
      .from(parentGrowthExports)
      .where(eq(parentGrowthExports.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      parentId: row.parentUserId,
      childId: row.childUserId,
      childDisplayName: row.childDisplayName,
      status: row.status as ParentGrowthExportStatus,
      reason: row.reason,
      document: (row.document as ParentGrowthExportDocument | null) ?? null,
      createdAt: row.createdAt,
      readyAt: row.readyAt,
      expiresAt: row.expiresAt,
      downloadedAt: row.downloadedAt,
    };
  }

  async markExpired(id: string): Promise<void> {
    await this.db
      .update(parentGrowthExports)
      .set({ status: 'expired' })
      .where(eq(parentGrowthExports.id, id));
  }

  async markDownloaded(id: string, at: Date): Promise<void> {
    await this.db
      .update(parentGrowthExports)
      .set({ downloadedAt: at })
      .where(eq(parentGrowthExports.id, id));
  }
}
