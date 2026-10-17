import type { GradeValue, LearningErrorType } from '@qitu/contracts';
import type { AuditTransaction } from '../../common/audit/audit.service';

/**
 * 交互题作答证据的持久化边界（F1.4 `answer_attempts`）。
 *
 * 服务层只依赖本抽象；`demo` / `test` 用内存实现，`live` 用 PostgreSQL 实现。
 * 判分、概念→目标解析、掌握度公式全部留在服务层，本边界只负责读写作答证据。
 */

export interface AnswerAttemptRecord {
  id: string;
  schoolId: string | null;
  studentUserId: string;
  tutorSessionId: string;
  /** 不可变题库 questionId。 */
  quizId: string;
  /** 概念未映射时为 null（F1 的 plan-less 永不出现，正常路径非空）。 */
  objectiveId: string | null;
  planId: string | null;
  conceptId: string;
  result: GradeValue;
  isCorrect: boolean;
  assessmentType: 'quiz';
  errorType: LearningErrorType | null;
  /** 作答时的统一会话提示等级（决策 D5），不持有阶梯。 */
  hintsUsed: number;
  attemptCount: number;
  qualityBasisPoints: number | null;
  /** canonical selectedKeys；服务器侧证据，不含预期答案。 */
  userAnswer: string | null;
  idempotencyKey: string;
  createdAt: Date;
}

export abstract class TutorQuizStore {
  /**
   * 是否为真实持久化实现。服务层据此决定是否走跨进程幂等与持久化审计；
   * demo/test 的内存实现返回 `false`，绝不假装持久化。
   */
  abstract readonly durable: boolean;

  /**
   * 追加一条作答证据。`tx` 传入时优先使用（与掌握度写入落在同一事务）；
   * 不传时退回连接池直写（概念未映射的 standalone 路径）。
   */
  abstract appendAttempt(record: AnswerAttemptRecord, tx?: AuditTransaction): Promise<void>;

  /** 同一 `(student, quizId)` 的累计作答次数（含本场景待写的一行前值）。 */
  abstract countAttempts(studentUserId: string, quizId: string): Promise<number>;
}

/** 内存实现：仅用于 demo / test（无数据库），写入前不做重放去重。 */
export class InMemoryTutorQuizStore extends TutorQuizStore {
  readonly durable: boolean = false;
  private readonly rows: AnswerAttemptRecord[] = [];

  async appendAttempt(record: AnswerAttemptRecord, _tx?: AuditTransaction): Promise<void> {
    // 与 Postgres 实现同语义：同一幂等键只落一行（崩溃重放不得重复计数）。
    const duplicate = this.rows.some((row) => (
      row.studentUserId === record.studentUserId &&
      row.quizId === record.quizId &&
      row.idempotencyKey === record.idempotencyKey
    ));
    if (duplicate) return;
    this.rows.push({
      ...record,
      userAnswer: record.userAnswer,
    });
  }

  async countAttempts(studentUserId: string, quizId: string): Promise<number> {
    return this.rows.filter((row) => row.studentUserId === studentUserId && row.quizId === quizId).length;
  }

  /** 测试断言专用：读回全部已写行。 */
  list(): readonly AnswerAttemptRecord[] {
    return this.rows.map((row) => ({ ...row }));
  }
}
