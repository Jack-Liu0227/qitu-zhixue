import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { learningObjectives, learningPlans } from './learning-plan';
import { schools } from './tenancy';
import { tutorSessions } from './tutor-workspace';
import { users } from './identity';

/**
 * 交互题作答证据表（F1.4，迁移 0031）。
 *
 * `user_answer` 只保存学生自己的作答（canonical `selectedKeys`）；
 * 标准答案（`expectedKeys` / `explanation`）只存在于代码级题库，**绝不**落本表。
 * `objective_id` / `plan_id` 在 plan-less（F1 永不出现）或概念未映射时为 null；
 * `hints_used` 记录作答时的统一会话提示等级（决策 D5），不持有阶梯。
 *
 * 索引名与列集合与迁移 0031 逐字一致（answer-attempts.test.ts 做文件级断言防漂移）。
 */
export const answerAttempts = pgTable(
  'answer_attempts',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tutorSessionId: text('tutor_session_id')
      .notNull()
      .references(() => tutorSessions.id, { onDelete: 'restrict' }),
    quizId: text('quiz_id').notNull(),
    objectiveId: text('objective_id').references(() => learningObjectives.id, { onDelete: 'restrict' }),
    planId: text('plan_id').references(() => learningPlans.id, { onDelete: 'restrict' }),
    conceptId: text('concept_id').notNull(),
    result: text('result').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),
    assessmentType: text('assessment_type').notNull().default('quiz'),
    errorType: text('error_type'),
    hintsUsed: integer('hints_used').notNull().default(0),
    attemptCount: integer('attempt_count').notNull().default(1),
    qualityBasisPoints: integer('quality_basis_points'),
    userAnswer: text('user_answer'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    studentQuizKeyUniqueIdx: uniqueIndex('answer_attempts_student_quiz_key_unique_idx').on(
      table.studentUserId,
      table.quizId,
      table.idempotencyKey,
    ),
    studentQuizIdx: index('answer_attempts_student_quiz_idx').on(
      table.studentUserId,
      table.quizId,
    ),
    studentCreatedIdx: index('answer_attempts_student_created_idx').on(
      table.studentUserId,
      table.createdAt,
    ),
    planObjectiveIdx: index('answer_attempts_plan_objective_idx').on(
      table.planId,
      table.objectiveId,
    ),
  }),
);
