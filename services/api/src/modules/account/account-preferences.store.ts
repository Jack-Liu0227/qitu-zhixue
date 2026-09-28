import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { userPreferences, type Database } from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';
import { PreferenceStore, type PreferenceRecord } from './account-preferences.types';

/**
 * 偏好的 Postgres 实现（Account 模块独占写入 `user_preferences`）。
 *
 * 无内存回退：`account.module.ts` 只在 `DATABASE_TOKEN` 非空时提供本实现，
 * 否则提供 `null`，由 `AccountPreferencesService` 诚实返回 503。
 */
@Injectable()
export class PostgresPreferenceStore extends PreferenceStore {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {
    super();
  }

  async get(userId: string): Promise<PreferenceRecord | null> {
    const rows = await this.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return toRecord(row);
  }

  async upsert(record: PreferenceRecord): Promise<PreferenceRecord> {
    const rows = await this.db
      .insert(userPreferences)
      .values({
        userId: record.userId,
        fontSize: record.fontSize,
        theme: record.theme,
        reducedMotion: record.reducedMotion,
        notifications: record.notifications,
        updatedAt: record.updatedAt,
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          fontSize: record.fontSize,
          theme: record.theme,
          reducedMotion: record.reducedMotion,
          notifications: record.notifications,
          updatedAt: record.updatedAt,
        },
      })
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error('user_preferences upsert 未返回记录');
    }
    return toRecord(row);
  }
}

type PreferenceRow = typeof userPreferences.$inferSelect;

function toRecord(row: PreferenceRow): PreferenceRecord {
  return {
    userId: row.userId,
    fontSize: row.fontSize as PreferenceRecord['fontSize'],
    theme: row.theme as PreferenceRecord['theme'],
    reducedMotion: row.reducedMotion,
    notifications: row.notifications,
    updatedAt: row.updatedAt,
  };
}
