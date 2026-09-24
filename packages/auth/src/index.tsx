'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { Role } from '@qitu/contracts';

export type AuthState = 'anonymous' | 'authenticated' | 'refreshing';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export function AuthGuard({
  expectedRole,
  children,
}: {
  expectedRole: Role;
  children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>('refreshing');
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/v1/auth/me', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('anonymous');
        return (await response.json()) as { data: CurrentUser };
      })
      .then(({ data }) => {
        if (!active) return;
        setUser(data);
        setState('authenticated');
      })
      .catch(() => {
        if (!active) return;
        setState('anonymous');
        window.location.assign('/');
      });
    return () => {
      active = false;
    };
  }, []);

  if (state === 'refreshing') {
    return <main className="auth-loading">正在验证登录状态…</main>;
  }

  if (state === 'anonymous' || !user || user.role !== expectedRole) {
    return <main className="auth-loading">正在返回统一登录页…</main>;
  }

  return <>{children}</>;
}

export function LogoutButton() {
  async function logout() {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.assign('/');
  }

  return (
    <button className="auth-logout" type="button" onClick={logout}>
      退出登录
    </button>
  );
}
