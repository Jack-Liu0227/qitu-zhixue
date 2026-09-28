import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { schools } from './tenancy';
import { users } from './identity';
import { learningObjectives, learningPlans, learningSessions } from './learning-plan';

/** 题面选项，与 `@qitu/contracts` 的 `PublicQuestion.options[]` 对齐。 */
export interface PendingQuestionOption {
  id: string;
  label: string;
  body: string;
}

/**
 * Pending questions: 跨轮持久的**未答题**（学习计划推进的 `answer_pending` 来源）。
 *
 * 学习计划契约要求：
 * - `NextAction` 首选 `answer_pending`——有未答题时不推进到复习 / 练习；
 * - `QUESTION_NOT_AWAITING` 错误码：对已答 / 不存在 / 非本人计划的题作答时拒绝；
 * - `PublicQuestion` 投影**结构上不包含** `expected_answer` / `explanation`。
 *
 * 因此题面、标准答案、解析由服务端持有并落库；`expected_answer` / `explanation`
 * 绝不下发。下发前只经 `toPublicQuestion` 投影为 `PublicQuestion`。
 *
 * 硬约束：
 * - **同一路径同时只有一道未答题**：部分唯一索引
 *   `(student_user_id, plan_id) WHERE status = 'awaiting'` 兜底；
 * - `idempotency_key` 唯一：同一出题请求重放不产生第二道题；
 * - 客户端不可写 `status` / `expected_answer` / `attempt`，只提交 `questionId + answer`。
 *
 * `assessment_type`：`'quiz' | 'qualitative' | 'review'`；判分后写回 `answered_at`，
 * 并由服务端追加 `mastery_attempts`（本题 id 作为 `question_id`）。
 */
export const pendingQuestions = pgTable(
  'pending_questions',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id),
    planId: text('plan_id')
      .notNull()
      .references(() => learningPlans.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => learningSessions.id, { onDelete: 'cascade' }),
    objectiveId: text('objective_id')
      .notNull()
      .references(() => learningObjectives.id, { onDelete: 'cascade' }),
    /** `'choice' | 'short' | 'open'`。 */
    questionType: text('question_type').notNull(),
    prompt: text('prompt').notNull(),
    options: jsonb('options')
      .$type<PendingQuestionOption[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** **服务端私密**：标准答案，绝不下发客户端。 */
    expectedAnswer: text('expected_answer').notNull().default(''),
    /** **服务端私密**：判分后才释放的解析。 */
    explanation: text('explanation').notNull().default(''),
    /** `'easy' | 'medium' | 'hard'`，可空。 */
    difficulty: text('difficulty'),
    /** `'quiz' | 'qualitative' | 'review'`。 */
    assessmentType: text('assessment_type').notNull().default('quiz'),
    /** `'awaiting' | 'answered' | 'expired' | 'cancelled'`；仅服务端状态机可写。 */
    status: text('status').notNull().default('awaiting'),
    /** 第几次作答（供 `PublicQuestion.attempt` 投影）。 */
    attempt: integer('attempt').notNull().default(1),
    hintsUsed: integer('hints_used').notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull(),
    askedAt: timestamp('asked_at', { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUniqueIdx: uniqueIndex('pending_questions_idempotency_unique_idx').on(
      table.idempotencyKey,
    ),
    // 「同一路径同时只有一道未答题」由部分唯一索引在 DB 级兜底。
    oneAwaitingPerPlanIdx: uniqueIndex('pending_questions_awaiting_unique_idx')
      .on(table.studentUserId, table.planId)
      .where(sql`${table.status} = 'awaiting'`),
    studentStatusIdx: index('pending_questions_student_status_idx').on(
      table.studentUserId,
      table.status,
    ),
    planIdx: index('pending_questions_plan_idx').on(table.planId),
    sessionIdx: index('pending_questions_session_idx').on(table.sessionId),
    objectiveIdx: index('pending_questions_objective_idx').on(table.objectiveId),
  }),
);
