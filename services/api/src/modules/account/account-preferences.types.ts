import type { FontSizePreference, ThemePreference } from '@qitu/contracts';

/**
 * 偏好持久化记录。字段与 `user_preferences` 表一一对应。
 *
 * 主题只存预设 id（`default` / `focus` / `calm`），**不存颜色值**；
 * 颜色由客户端用 `@qitu/design-tokens` 展开。
 */
export interface PreferenceRecord {
  userId: string;
  fontSize: FontSizePreference;
  theme: ThemePreference;
  reducedMotion: boolean;
  notifications: boolean;
  updatedAt: Date;
}

/**
 * 偏好存储抽象，作为 Nest DI 稳定注入令牌。
 *
 * 抽象类（而非 interface）是为了既能 DI 注入、又能作为类型使用。
 * 无内存回退：`account.module.ts` 只在 `DATABASE_TOKEN` 非空时提供 Postgres
 * 实现，否则提供 `null`，由 service 诚实返回 503。
 */
export abstract class PreferenceStore {
  /** 读取某账号的偏好；无记录返回 `null`（由 service 补默认值，不落库）。 */
  abstract get(userId: string): Promise<PreferenceRecord | null>;

  /** 以 `user_id` 为主键 upsert，返回落库后的记录。 */
  abstract upsert(record: PreferenceRecord): Promise<PreferenceRecord>;
}
