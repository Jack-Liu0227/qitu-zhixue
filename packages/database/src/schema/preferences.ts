import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './identity';

/**
 * 四端基础偏好（ISSUE-T4 / #9）。
 *
 * - 一个账号一行，主键即 `user_id`：偏好天然 self-only，不存在跨账号写入路径；
 * - 主题只存设计令牌预设 id，不存颜色值，颜色由客户端用令牌展开；
 * - 不存放任何未成年人敏感数据、风险设置或平台级 AI 设置。
 *
 * 默认值与 `@qitu/contracts` 的 `DEFAULT_USER_PREFERENCES` 保持一致：
 * 服务端在无记录时也返回同样的默认值（读取不落库）。
 */
export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  fontSize: text('font_size').notNull().default('md'), // 'sm' | 'md' | 'lg'
  theme: text('theme').notNull().default('default'), // 'default' | 'focus' | 'calm'
  reducedMotion: boolean('reduced_motion').notNull().default(false),
  notifications: boolean('notifications').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
