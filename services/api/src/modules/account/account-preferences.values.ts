import { BadRequestException } from '@nestjs/common';
import type {
  FontSizePreference,
  ThemePreference,
  UpdateUserPreferencesRequest,
} from '@qitu/contracts';

/**
 * 服务端**运行期**允许值（ISSUE-T4 / #9）。
 *
 * 为什么与 `@qitu/contracts` 分开声明：`@qitu/contracts` 是纯类型 / 前端共享包，
 * 其 `exports` 指向 `.ts` 源码，API 在 `node --test` 下无法 `require`。因此 API
 * 运行期只依赖本文件，类型仍以 `import type` 复用契约。三处一致性由
 * `tooling/validate-preferences.mjs` 静态校验。
 */

export const FONT_SIZE_VALUES = ['sm', 'md', 'lg'] as const;
export const THEME_VALUES = ['default', 'focus', 'calm'] as const;

export type PreferencePatch = UpdateUserPreferencesRequest;

/** 无记录时返回的默认值，必须与契约 `DEFAULT_USER_PREFERENCES` 一致。 */
export const DEFAULT_PREFERENCE_VALUES = {
  fontSize: 'md' as FontSizePreference,
  theme: 'default' as ThemePreference,
  reducedMotion: false,
  notifications: true,
};

const FONT_TIMES = new Set<string>(FONT_SIZE_VALUES);
const THEMES = new Set<string>(THEME_VALUES);

/**
 * 解析并校验偏好写入体，**只挑选白名单字段**。
 *
 * - 未知字段（含 `userId` / `targetUserId` / `updatedAt` 等）被忽略：
 *   目标账号永远是会话身份，客户端无法指定；
 * - 字号 / 主题必须是允许集合内的字符串，动效 / 通知必须是布尔；
 * - 任何不合法输入统一返回 `PREFERENCE_INVALID`（400），不透露内部结构。
 */
export function parsePreferenceUpdate(raw: unknown): PreferencePatch {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalid('偏好请求体必须是 JSON 对象');
  }
  const source = raw as Record<string, unknown>;
  const patch: PreferencePatch = {};

  if (Object.prototype.hasOwnProperty.call(source, 'fontSize')) {
    const value = source.fontSize;
    if (typeof value !== 'string' || !FONT_TIMES.has(value)) {
      throw invalid(`fontSize 只能是 ${FONT_SIZE_VALUES.join(' / ')}`);
    }
    patch.fontSize = value as FontSizePreference;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'theme')) {
    const value = source.theme;
    if (typeof value !== 'string' || !THEMES.has(value)) {
      throw invalid(`theme 只能是设计令牌预设 ${THEME_VALUES.join(' / ')}`);
    }
    patch.theme = value as ThemePreference;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'reducedMotion')) {
    if (typeof source.reducedMotion !== 'boolean') {
      throw invalid('reducedMotion 必须是布尔值');
    }
    patch.reducedMotion = source.reducedMotion;
  }

  if (Object.prototype.hasOwnProperty.call(source, 'notifications')) {
    if (typeof source.notifications !== 'boolean') {
      throw invalid('notifications 必须是布尔值');
    }
    patch.notifications = source.notifications;
  }

  return patch;
}

function invalid(message: string): BadRequestException {
  return new BadRequestException({ code: 'PREFERENCE_INVALID', message });
}
