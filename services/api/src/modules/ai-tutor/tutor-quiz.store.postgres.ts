import { and, desc, eq, sql } from 'drizzle-orm';
import { answerAttempts, type Database } from '@qitu/database';
import type { GradeValue, LearningErrorType } from '@qitu/contracts';
import type { AuditTransaction } from '../../common/audit/audit.service';
import { TutorQuizStore, type AnswerAttemptRecord } from './tutor-quiz.store';

/** PostgreSQL 实现：`answer_attempts` 表（迁移 0031）。 */
export class PostgresTutorQuizStore extends TutorQuizStore {
  readonly durable: boolean = true;

  constructor(private readonly db: Database) {
    super();
  }

  /**
   * 写入一条作答证据。**按 `(student, quizId, idempotencyKey)` 幂等**：
   * 崩溃重放（行已落库、幂等记录未完成）时静默去重，不撞唯一索引、不抛 500。
   */
  async appendAttempt(record: AnswerAttemptRecord, tx?: AuditTransaction): Promise<void> {
    const executor = (tx ?? this.db) as Database;
    await executor
      .insert(answerAttempts)
      .values({
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
    })
      .onConflictDoNothing({
        target: [
          answerAttempts.studentUserId,
          answerAttempts.quizId,
          answerAttempts.idempotencyKey,
        ],
      });
  }

  async countAttempts(studentUserId: string, quizId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(answerAttempts)
      .where(and(eq(answerAttempts.studentUserId, studentUserId), eq(answerAttempts.quizId, quizId)));
    return row?.value ?? 0;
  }

  async listRecentAttemptsByConcept(
    studentUserId: string,
    conceptId: string,
    limit: number,
  ): Promise<AnswerAttemptRecord[]> {
    const rows = await this.db
      .select()
      .from(answerAttempts)
      .where(and(
        eq(answerAttempts.studentUserId, studentUserId),
        eq(answerAttempts.conceptId, conceptId),
      ))
      .orderBy(desc(answerAttempts.createdAt))
      .limit(limit);
    return rows.map(mapAttemptRow);
  }
}

function mapAttemptRow(row: typeof answerAttempts.$inferSelect): AnswerAttemptRecord {
  return {
    id: row.id,
    schoolId: row.schoolId,
    studentUserId: row.studentUserId,
    tutorSessionId: row.tutorSessionId,
    quizId: row.quizId,
    objectiveId: row.objectiveId,
    planId: row.planId,
    conceptId: row.conceptId,
    result: row.result as GradeValue,
    isCorrect: row.isCorrect,
    assessmentType: 'quiz',
    errorType: row.errorType as LearningErrorType | null,
    hintsUsed: row.hintsUsed,
    attemptCount: row.attemptCount,
    qualityBasisPoints: row.qualityBasisPoints,
    userAnswer: row.userAnswer,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
  };
}
