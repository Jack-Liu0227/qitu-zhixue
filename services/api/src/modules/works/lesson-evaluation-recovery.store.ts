import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import { outbox, users, type Database } from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';
import type { LessonQualityStatus } from '@qitu/contracts';

export interface LessonEvaluationRecoveryRequest {
  studentId: string;
  projectId: string;
  planId: string;
  planRevision: number;
  learningSessionId: string;
  evidenceRef: string;
}
export interface LessonEvaluationRecoveryJob {
  id: string;
  leaseOwner: string;
  attempts: number;
  request: LessonEvaluationRecoveryRequest;
}
const TOPIC = 'learning.lesson-evaluation.recover';
export const LESSON_RECOVERY_MAX_ATTEMPTS = 3;
const identity = (input: LessonEvaluationRecoveryRequest) => `lesson-recovery:${createHash('sha256')
  .update(JSON.stringify([input.studentId, input.projectId, input.planId, input.planRevision, input.learningSessionId, input.evidenceRef])).digest('hex')}`;

export function readLessonRecoveryRequest(value: unknown): LessonEvaluationRecoveryRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!('studentId' in value && 'projectId' in value && 'planId' in value && 'planRevision' in value
    && 'learningSessionId' in value && 'evidenceRef' in value)) return null;
  const { studentId, projectId, planId, planRevision, learningSessionId, evidenceRef } = value;
  if (typeof studentId !== 'string' || !studentId || studentId.length > 200
    || typeof projectId !== 'string' || !projectId || projectId.length > 200
    || typeof planId !== 'string' || !planId || planId.length > 200
    || typeof learningSessionId !== 'string' || !learningSessionId || learningSessionId.length > 400
    || typeof evidenceRef !== 'string' || !/^(task_submission|reflection|experiment_observation):[^\s]{1,450}$/u.test(evidenceRef)
    || typeof planRevision !== 'number' || !Number.isSafeInteger(planRevision) || planRevision < 1) return null;
  return { studentId, projectId, planId, planRevision, learningSessionId, evidenceRef };
}

/** Only recovery delivery lives in outbox. Evidence and decisions remain in Works. */
@Injectable()
export class LessonEvaluationRecoveryStore {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null) {}

  async schedule(request: LessonEvaluationRecoveryRequest): Promise<boolean> {
    if (!this.db) return false;
    // Persist before the first model call. A crash or lost browser cannot lose recovery.
    await this.db.insert(outbox).values({ id: identity(request), topic: TOPIC, payload: request,
      status: 'pending', attempts: 0, leaseUntil: new Date(Date.now() + 120_000) })
      .onConflictDoNothing({ target: outbox.id });
    return true;
  }

  async student(studentId: string) {
    if (!this.db) return null;
    const [user] = await this.db.select({ id: users.id, email: users.email, displayName: users.displayName }).from(users)
      .where(and(eq(users.id, studentId), eq(users.role, 'student'), isNull(users.disabledAt))).limit(1);
    return user ? { ...user, role: 'student' as const } : null;
  }

  async read(request: LessonEvaluationRecoveryRequest): Promise<LessonQualityStatus['recovery']> {
    if (!this.db) return undefined;
    const [row] = await this.db.select().from(outbox).where(and(eq(outbox.id, identity(request)), eq(outbox.topic, TOPIC))).limit(1);
    if (!row || row.status === 'published') return undefined;
    return { status: row.status === 'failed' ? 'failed' : row.status === 'processing' ? 'retrying' : 'scheduled',
      attempts: row.attempts, maxAttempts: LESSON_RECOVERY_MAX_ATTEMPTS, nextAttemptAt: row.leaseUntil?.toISOString() ?? null };
  }

  async claim(): Promise<LessonEvaluationRecoveryJob | null> {
    if (!this.db) return null;
    return this.db.transaction(async tx => {
      const [row] = await tx.select().from(outbox).where(and(eq(outbox.topic, TOPIC),
        or(eq(outbox.status, 'pending'), eq(outbox.status, 'processing')),
        or(isNull(outbox.leaseUntil), lte(outbox.leaseUntil, new Date()))))
        .orderBy(asc(outbox.createdAt)).limit(1).for('update', { skipLocked: true });
      if (!row) return null;
      const request = readLessonRecoveryRequest(row.payload);
      if (!request || row.attempts >= LESSON_RECOVERY_MAX_ATTEMPTS) {
        await tx.update(outbox).set({ status: 'failed', lastError: request ? 'LESSON_RECOVERY_EXHAUSTED' : 'LESSON_RECOVERY_INVALID',
          leaseOwner: null, leaseUntil: null }).where(eq(outbox.id, row.id));
        return null;
      }
      const leaseOwner = randomUUID(), attempts = row.attempts + 1;
      await tx.update(outbox).set({ status: 'processing', attempts, leaseOwner,
        leaseUntil: new Date(Date.now() + 300_000) }).where(eq(outbox.id, row.id));
      return { id: row.id, leaseOwner, attempts, request };
    });
  }

  async finish(job: LessonEvaluationRecoveryJob, errorCode?: string, terminal = false) {
    if (!this.db) return;
    const failed = !!errorCode && (terminal || job.attempts >= LESSON_RECOVERY_MAX_ATTEMPTS);
    await this.db.update(outbox).set({ status: errorCode ? failed ? 'failed' : 'pending' : 'published',
      publishedAt: errorCode ? null : new Date(), lastError: errorCode ?? null, leaseOwner: null,
      leaseUntil: errorCode && !failed ? new Date(Date.now() + (job.attempts === 1 ? 30_000 : 120_000)) : null })
      .where(and(eq(outbox.id, job.id), eq(outbox.status, 'processing'), eq(outbox.leaseOwner, job.leaseOwner)));
  }
}
