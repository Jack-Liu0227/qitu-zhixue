/**
 * 四端基础偏好契约（ISSUE-T4 / #9）。
 *
 * 边界（与产品文档、ADR 0008 一致）：
 * - 只覆盖「字号、预设主题、动效、通知」四类**基础偏好**；
 * - 主题只允许**设计令牌里已存在的预设 id**，不接受任意颜色值；
 * - 偏好属于账号自身（self-only），不存在「读 / 写别人的偏好」的入口；
 * - 不包含任何未成年人敏感数据、风险设置或平台级 AI 设置。
 */

/** 允许的字号预设。与 `@qitu/design-tokens` 的 `preferenceFontSizes` 一一对应。 */
export const PREFERENCE_FONT_SIZES = ['sm', 'md', 'lg'] as const;
export type FontSizePreference = (typeof PREFERENCE_FONT_SIZES)[number];

/** 允许的主题预设。每个 id 必须对应设计令牌里的主题预设。 */
export const PREFERENCE_THEMES = ['default', 'focus', 'calm'] as const;
export type ThemePreference = (typeof PREFERENCE_THEMES)[number];

/** 服务端存储并经四端共用的偏好快照。 */
export interface UserPreferences {
  fontSize: FontSizePreference;
  theme: ThemePreference;
  /** 用户显式要求减弱动效；与系统 `prefers-reduced-motion` 取并集。 */
  reducedMotion: boolean;
  /** 是否接收通知。仅是一个开关，不承载通知内容。 */
  notifications: boolean;
  /** 服务端最近一次写入时间；从未写过时为 `null`。 */
  updatedAt: string | null;
}

/** 允许的偏好默认值。服务端在无记录时返回它（不落库）。 */
export const DEFAULT_USER_PREFERENCES: Omit<UserPreferences, 'updatedAt'> = {
  fontSize: 'md',
  theme: 'default',
  reducedMotion: false,
  notifications: true,
};

/**
 * 局部更新请求。所有字段可选，未提供的字段保持不变。
 * 客户端**不得**携带 `userId` 之类目标账号字段——服务端只认会话身份。
 */
export interface UpdateUserPreferencesRequest {
  fontSize?: FontSizePreference;
  theme?: ThemePreference;
  reducedMotion?: boolean;
  notifications?: boolean;
}

export interface UserPreferencesResponse {
  preferences: UserPreferences;
}
