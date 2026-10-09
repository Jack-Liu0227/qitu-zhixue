import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Public consultation requests: 站点首页「预约体验课 / 院校机构合作」的落库真源。
 *
 * 归属：`public-content` 模块（`services/api/src/modules/public-content/`）。
 * 与 `feedback_tickets` 区分：工单必须绑定「家长 + 孩子」关系，由 Mentor Ops
 * 独占写入；本表是**访客**提交的线索，没有账号、没有学生关系，两者不能混用。
 *
 * 个人信息最小化（AGENTS.md「涉及未成年人数据时默认最小化可见范围」）：
 * - 只存联系所需的最少字段：`name` / `phone` / `identity` / 可选 `message`；
 * - **不存** IP、User-Agent、原始请求体、来源页面之外的任何设备信息；
 * - 提交行为写 `audit_logs`（`action = public.consultation.submit`），
 *   审计 detail 只含身份与留言长度，**不含**姓名与电话；
 * - 删除 / 导出走运维流程，不提供公开 API。
 *
 * 幂等：`idempotency_key` 唯一。用户重复点击或网络重试只落一行。
 */
export const consultationRequests = pgTable(
  'consultation_requests',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** 归一化后的联系电话（去掉空格 / 连字符），仅用于回访。 */
    phone: text('phone').notNull(),
    /** `'student' | 'parent' | 'school'`；由服务端白名单校验。 */
    identity: text('identity').notNull(),
    message: text('message'),
    /** `'received' | 'contacted' | 'closed'`；由咨询专员在后台推进（本模块不写入）。 */
    status: text('status').notNull().default('received'),
    /** 来源标识，便于区分站内不同入口；当前固定 `'public-home'`。 */
    source: text('source').notNull().default('public-home'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    contactedAt: timestamp('contacted_at', { withTimezone: true }),
  },
  (table) => ({
    idempotencyUniqueIdx: uniqueIndex('consultation_requests_idempotency_key_idx').on(
      table.idempotencyKey,
    ),
    statusIdx: index('consultation_requests_status_idx').on(table.status, table.createdAt),
  }),
);
