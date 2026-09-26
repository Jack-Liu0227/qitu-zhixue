'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { CurrentUser, LoginResponse, Role } from '@qitu/contracts';
import { OfflineBanner } from '@qitu/ui';

// 本地一键预览开关：脚本里设置 NEXT_PUBLIC_DEV_BYPASS_AUTH=1 时跳过真实登录。
// 生产构建不会设置该变量，行为不受影响。
const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1';

export type AuthState = 'anonymous' | 'authenticated' | 'refreshing';

// 向后兼容：既有的 `CurrentUser` 类型名继续可用。
export type { CurrentUser } from '@qitu/contracts';

export interface AuthSession {
  user: CurrentUser;
  expiresAt: string;
}

const SESSION_STORAGE_KEY = 'qitu.auth.session';
const SESSION_CHANGED_EVENT = 'qitu:auth-session-changed';

function nowIso(): number {
  return Date.now();
}

function isSessionValid(session: AuthSession | null): session is AuthSession {
  if (!session) return false;
  const expiresAt = new Date(session.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > nowIso();
}

function emitSessionChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

/**
 * 读取缓存的会话（不校验过期时间）。
 *
 * 缓存只存放 `{ id, email, displayName, role }` 与 `expiresAt`，
 * 绝不存放 token——token 由 httpOnly cookie 持有，JavaScript 读不到。
 */
export function readCachedSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.expiresAt !== 'string' ||
      !parsed.user ||
      typeof parsed.user.id !== 'string' ||
      typeof parsed.user.email !== 'string' ||
      typeof parsed.user.displayName !== 'string' ||
      typeof parsed.user.role !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readCachedUser(): CurrentUser | null {
  const session = readCachedSession();
  return isSessionValid(session) ? session.user : null;
}

export function writeCachedSession(session: AuthSession): void {
  if (typeof window === 'undefined') return;
  // 最小化可见范围：只写入公开投影字段，多余字段一律丢弃。
  const safe: AuthSession = {
    user: {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      role: session.user.role,
    },
    expiresAt: session.expiresAt,
  };
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(safe));
  emitSessionChanged();
}

export function clearCachedSession(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  emitSessionChanged();
}

function subscribeToSession(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(SESSION_CHANGED_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(SESSION_CHANGED_EVENT, callback);
  };
}

export function useCurrentUser(): CurrentUser | null {
  return useSyncExternalStore(subscribeToSession, readCachedUser, () => null);
}

type LeaveReason = 'anonymous' | 'expired' | 'forbidden';

export function AuthGuard({
  expectedRole,
  redirectTo = '/',
  children,
  onUnauthenticated,
}: {
  expectedRole: Role;
  redirectTo?: string;
  children: ReactNode;
  /** 可选：未登录 / 会话过期 / 角色不匹配被带离前的回调。 */
  onUnauthenticated?: (reason: LeaveReason) => void;
}) {
  const [state, setState] = useState<AuthState>('refreshing');
  const [offline, setOffline] = useState(false);
  const [recheckNonce, setRecheckNonce] = useState(0);
  const onUnauthenticatedRef = useRef(onUnauthenticated);

  useEffect(() => {
    onUnauthenticatedRef.current = onUnauthenticated;
  }, [onUnauthenticated]);

  useEffect(() => {
    if (DEV_BYPASS_AUTH) {
      writeCachedSession({
        user: {
          id: 'dev-preview',
          email: `dev-${expectedRole}@qtxz.local`,
          displayName: '本地预览',
          role: expectedRole,
        },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      setState('authenticated');
      return;
    }

    let active = true;

    function leave(reason: LeaveReason): void {
      if (!active) return;
      clearCachedSession();
      setState('anonymous');
      onUnauthenticatedRef.current?.(reason);
      window.location.assign(redirectTo);
    }

    async function revalidateInBackground(): Promise<void> {
      try {
        const response = await fetch('/api/v1/auth/me', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!active) return;

        if (!response.ok) {
          // 401/403 说明服务端会话已失效或无权限，清缓存并回登录页。
          if (response.status === 401 || response.status === 403) {
            leave('forbidden');
            return;
          }
          // 其他非 2xx 一律当作服务端抖动：保留缓存继续渲染。
          setOffline(true);
          return;
        }

        const payload = (await response.json()) as { data?: LoginResponse };
        if (!active) return;

        const data = payload.data;
        if (!data?.user) {
          setOffline(true);
          return;
        }
        if (data.user.role !== expectedRole) {
          leave('forbidden');
          return;
        }

        writeCachedSession(data);
        setOffline(false);
        setState('authenticated');
      } catch {
        // 网络失败：保留缓存继续渲染，只给出可重连提示，不把学生踢出去。
        if (!active) return;
        setOffline(true);
      }
    }

    const cached = readCachedSession();
    // 角色必须在“立即渲染”之前就核对。否则一份被偽造或角色错误的缓存
    // 会在后台复查失败（断网 / 5xx）时一直把不属于本应用的界面挂在那里。
    // 这只影响前端展示，真正的权限仍由服务端逐次校验。
    const cachedRoleOk =
      cached !== null && (expectedRole === undefined || cached.user.role === expectedRole);

    if (cached !== null && cachedRoleOk && isSessionValid(cached)) {
      // 有有效缓存：立即渲染 children，同时在后台静默复查。
      setState('authenticated');
      void revalidateInBackground();
      return () => {
        active = false;
      };
    }

    if (cached !== null && !cachedRoleOk) {
      // 缓存里的角色不是这个应用要的，缓存没有任何参考价值。
      clearCachedSession();
      leave('forbidden');
      return () => {
        active = false;
      };
    }

    if (cached && !isSessionValid(cached)) {
      clearCachedSession();
      leave('expired');
      return () => {
        active = false;
      };
    }

    // 无缓存：全屏验证。
    setState('refreshing');
    fetch('/api/v1/auth/me', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('anonymous');
        return (await response.json()) as { data?: LoginResponse };
      })
      .then((payload) => {
        if (!active) return;
        const data = payload.data;
        if (!data?.user) throw new Error('anonymous');
        if (data.user.role !== expectedRole) {
          leave('forbidden');
          return;
        }
        writeCachedSession(data);
        setState('authenticated');
      })
      .catch(() => {
        if (!active) return;
        leave('anonymous');
      });

    return () => {
      active = false;
    };
  }, [expectedRole, redirectTo, recheckNonce]);

  if (state === 'refreshing') {
    return (
      <main className="auth-loading" aria-busy="true">
        正在验证登录状态…
      </main>
    );
  }

  if (state === 'anonymous') {
    return <main className="auth-loading">正在前往登录页…</main>;
  }

  return (
    <>
      {offline ? (
        <div className="auth-offline" role="status">
          <OfflineBanner
            readOnly={false}
            onRetry={() => {
              setOffline(false);
              setRecheckNonce((value) => value + 1);
            }}
          />
        </div>
      ) : null}
      {children}
    </>
  );
}

export function LogoutButton({ redirectTo = '/' }: { redirectTo?: string }) {
  async function logout(): Promise<void> {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // 即使服务端不可达，也要清掉本机缓存并跳回登录页。
    }
    clearCachedSession();
    window.location.assign(redirectTo);
  }

  return (
    <button className="auth-logout" type="button" onClick={logout}>
      退出登录
    </button>
  );
}
