import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import type { AuthService } from '../../modules/identity-auth/auth.service';

/**
 * 从会话 cookie 解析当前用户并做角色校验。
 *
 * 这是**服务端**的权限判定，前端只负责显示，不构成授权依据。
 * 放在 `common/access/` 是为了让所有控制器共用同一份实现——权限逻辑
 * 一旦有多份拷贝，早晚会有一份漏掉校验。
 */

export const SESSION_COOKIE = 'qitu_session';

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/** 任意已登录角色。 */
export function requireAnyRole(authService: AuthService, cookieHeader: string | undefined): CurrentUser {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (token === undefined) throw new UnauthorizedException('请先登录');
  return authService.getSession(token).user;
}

/** 指定角色；不满足时按「已登录但无权限」处理（403 而非 401）。 */
export function requireRole(
  authService: AuthService,
  cookieHeader: string | undefined,
  role: CurrentUser['role'],
  message: string,
): CurrentUser {
  const user = requireAnyRole(authService, cookieHeader);
  if (user.role !== role) throw new ForbiddenException(message);
  return user;
}

/**
 * 只挑选契约里声明过的字段。
 *
 * 直接信任请求体会让调用方塞进服务端字段（`updatedAt`、`updatedBy`、
 * `source` ……）来污染状态，所以每个写接口都要过一道白名单。
 */
export function pickFields<T extends object>(body: unknown, keys: readonly (keyof T)[]): T {
  const out = {} as T;
  if (body === null || typeof body !== 'object') return out;
  const source = body as Record<string, unknown>;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      out[key] = source[key as string] as T[keyof T];
    }
  }
  return out;
}
