import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { authSessions, users, type Database } from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';
import type { SessionRecord } from './auth.service';

/** Single API instance: hydrate durable sessions before accepting traffic. */
@Injectable()
export class AuthSessionPersistence {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null) {}

  async load(): Promise<[string, SessionRecord][]> {
    if (!this.db) return [];
    await this.db.delete(authSessions).where(lte(authSessions.expiresAt, new Date()));
    const rows = await this.db
      .select({
        session: authSessions,
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
      })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(and(gt(authSessions.expiresAt, new Date()), isNull(users.disabledAt)))
      .limit(5000);
    return rows.flatMap((r): [string, SessionRecord][] => {
      if (
        r.role !== 'student' &&
        r.role !== 'parent' &&
        r.role !== 'teacher' &&
        r.role !== 'admin' &&
        r.role !== 'support'
      )
        return [];
      return [
        [
          r.session.tokenHash,
          {
            id: r.session.id,
            user: { id: r.id, email: r.email, displayName: r.displayName, role: r.role },
            deviceId: r.session.deviceId,
            deviceName: r.session.deviceName,
            createdAt: r.session.createdAt.getTime(),
            lastSeenAt: r.session.lastSeenAt.getTime(),
            expiresAt: r.session.expiresAt.getTime(),
          },
        ],
      ];
    });
  }

  async saveUser(userId: string, records: [string, SessionRecord][]) {
    if (!this.db) return;
    await this.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      await tx.delete(authSessions).where(eq(authSessions.userId, userId));
      if (records.length)
        await tx
          .insert(authSessions)
          .values(
            records.map(([tokenHash, r]) => ({
              tokenHash,
              id: r.id,
              userId,
              deviceId: r.deviceId,
              deviceName: r.deviceName,
              createdAt: new Date(r.createdAt),
              lastSeenAt: new Date(r.lastSeenAt),
              expiresAt: new Date(r.expiresAt),
            })),
          );
    });
  }

  async remove(tokenHash: string) {
    if (this.db) await this.db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash));
  }
}
