import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { schools } from './tenancy';
import { users } from './identity';
import { projects } from './projects';

/**
 * Mentor reviews: 班主任对项目 / 作品的复核记录 (文档 7.4 / ADR 0008).
 *
 * 归属：班主任日常（Mentor Operations）。权限来自
 * `mentor_assignments(status=active, mentor_user_id=自己)`，后端每次读取都要重新判定。
 *
 * 硬规则衔接：
 * - 复核是**服务端状态机**：`requested → in_review → approved | changes_requested |
 *   rejected`，客户端不能直接写 `status` / `decision`。
 * - `idempotency_key` 唯一：同一复核请求重试只产生一条记录。
 * - `comment` 是给学生的结构化建议；不含原始 AI 对话。
 *
 * `kind`：`'project' | 'artifact' | 'stage' | 'reflection'`；
 * `project_id` / `artifact_ref` 至少有一个，由服务端校验。
 */
export const mentorReviews = pgTable(
  'mentor_reviews',
  {
    id: text('id').primaryKey(),
    schoolId: text('school_id').references(() => schools.id, { onDelete: 'restrict' }),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id),
    mentorUserId: text('mentor_user_id')
      .notNull()
      .references(() => users.id),
    projectId: text('project_id').references(() => projects.id),
    artifactRef: text('artifact_ref'),
    kind: text('kind').notNull().default('project'),
    /** `'requested' | 'in_review' | 'approved' | 'changes_requested' | 'rejected'`。 */
    status: text('status').notNull().default('requested'),
    decision: text('decision'),
    comment: text('comment'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUniqueIdx: uniqueIndex('mentor_reviews_idempotency_unique_idx').on(
      table.idempotencyKey,
    ),
    mentorStatusIdx: index('mentor_reviews_mentor_status_idx').on(
      table.mentorUserId,
      table.status,
    ),
    studentIdx: index('mentor_reviews_student_idx').on(table.studentUserId),
    projectIdx: index('mentor_reviews_project_idx').on(table.projectId),
  }),
);
