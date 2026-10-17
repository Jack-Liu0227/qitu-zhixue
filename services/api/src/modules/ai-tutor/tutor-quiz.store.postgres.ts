import { and, eq, sql } from 'drizzle-orm';
import { answerAttempts, type Database } from '@qitu/database';
import type { AuditTransaction } from '../../common/audit/audit.service';
import { TutorQuizStore, type AnswerAttemptRecord } from './tutor-quiz.store';

/** PostgreSQL 实现：`answer_attempts` 表（迁移 0031）。 */
export class PostgresTutorQuizStore extends TutorQuizStore {
  readonly durable: boolean = true;

  constructor(private readonly db: Database) {
    super();
  }

  async appendAttempt(record: AnswerAttemptRecord, tx?: AuditTransaction): Promise<void> {
    const executor = (tx ?? this.db) as Database;
    await executor.insert(answerAttempts).values({
      id: record.id,
      schoolId: record.schoolId,
      studentUserId: record.studentUserId,
      tutorSessionId: record.tutorSessionId,
      quizId: record.quizId,
      objectiveId: record.objectiveId,
      planId: record.planId,
      conceptId: record.conceptId,
      result: record.result,
      isCorrect: record.isCorrect,
      assessmentType: record.assessmentType,
      errorType: record.errorType,
      hintsUsed: record.hintsUsed,
      attemptCount: record.attemptCount,
      qualityBasisPoints: record.qualityBasisPoints,
      userAnswer: record.userAnswer,
      idempotencyKey: record.idempotencyKey,
      createdAt: record.createdAt,
    });
  }

  async countAttempts(studentUserId: string, quizId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(answerAttempts)
      .where(and(eq(answerAttempts.studentUserId, studentUserId), eq(answerAttempts.quizId, quizId)));
    return row?.value ?? 0;
  }
}
