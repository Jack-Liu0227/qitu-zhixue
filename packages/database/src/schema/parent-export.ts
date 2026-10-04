import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * 家长成长导出任务（ISSUE-T5 / #7）。
 *
 * 只保存**服务端投影后的脱敏正文**与任务元数据：
 * - `document` 是白名单投影（无原始 AI 对话 / 语音 / 风险标签 / 邮箱 / 模型推断），
 *   由 `ParentGrowthExportService` 生成；客户端无法写入。
 * - 下载时**再次**校验 active 监护关系，因此撤销授权后的旧任务不再可下载
 *   （行本身不删除，保留审计与限时语义）。
 * - `expires_at` 提供限时机制；到期后不再可下载，可被清理任务删除。
 * - `status` 为 text 枚举：`'pending' | 'ready' | 'expired'`（见 contracts）。
 *
 * 该表由 Parent Experience 模块独占写入（见 `docs/admin/database.md` §3）。
 */
export const parentGrowthExports = pgTable(
  'parent_growth_exports',
  {
    id: text('id').primaryKey(),
    parentUserId: text('parent_user_id')
      .notNull()
      .references(() => users.id),
    childUserId: text('child_user_id')
      .notNull()
      .references(() => users.id),
    /** 生成时的孩子展示名快照，避免下载期再查身份目录。 */
    childDisplayName: text('child_display_name').notNull(),
    status: text('status').notNull().default('pending'),
    /** 家长声明的导出目的；审计记录它，但**不**写入导出正文。 */
    reason: text('reason').notNull(),
    /** 脱敏导出正文；`pending` 时为 null。 */
    document: jsonb('document'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    downloadedAt: timestamp('downloaded_at', { withTimezone: true }),
  },
  (table) => ({
    parentIdx: index('parent_growth_exports_parent_idx').on(table.parentUserId),
    childIdx: index('parent_growth_exports_child_idx').on(table.childUserId),
    // 支持限时清理扫描。
    expiresAtIdx: index('parent_growth_exports_expires_at_idx').on(table.expiresAt),
  }),
);
