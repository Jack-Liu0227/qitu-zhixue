'use client';

import { writeCachedSession } from '@qitu/auth';
import type { LoginResponse } from '@qitu/contracts';
import { colors } from '@qitu/design-tokens';
import { AppShell, BrandLogo, Button, Field, OfflineBanner, PermissionDenied, SectionCard } from '@qitu/ui';
import { useEffect, useState } from 'react';

const PARENT_HOME_HREF = '/parent';

type LoginError =
  | { kind: 'invalid'; message: string }
  | { kind: 'offline' }
  | { kind: 'generic'; message: string }
  | null;

const REDIRECT_REASON_KEY = 'qitu.parent.auth.redirect';

/**
 * `/parent/login` — 家长登录页。
 *
 * 家长账号由学校统一发放，不支持自助注册。未登录访问受保护页面时，
 * `AuthGuard` 会把家长带到这里；非家长账号会被带到这里并显示权限提示。
 */
export default function ParentLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LoginError>(null);
  const [deniedNotice, setDeniedNotice] = useState<string | null>(null);

  useEffect(() => {
    const reason = window.sessionStorage.getItem(REDIRECT_REASON_KEY);
    if (reason === null) return;
    window.sessionStorage.removeItem(REDIRECT_REASON_KEY);
    if (reason === 'forbidden') {
      setDeniedNotice(
        '当前登录账号不是家长账号，家长端仅向家长账号开放。请使用学校发放的家长账号重新登录。',
      );
    } else if (reason === 'expired') {
      setDeniedNotice('登录已过期，请重新登录。');
    }
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          setError({ kind: 'invalid', message: '邮箱或密码错误' });
          return;
        }
        if (response.status === 429) {
          setError({ kind: 'generic', message: '尝试过于频繁，请稍后再试' });
          return;
        }
        setError({ kind: 'generic', message: '登录失败，请稍后再试' });
        return;
      }

      const payload = (await response.json()) as { data?: LoginResponse };
      const data = payload.data;
      if (!data?.user || !data.expiresAt) {
        setError({ kind: 'generic', message: '登录失败，请稍后再试' });
        return;
      }

      // 家长端只接受家长账号；其他角色即使登录成功也必须在这里被明确拒绝。
      if (data.user.role !== 'parent') {
        setDeniedNotice('当前账号不是家长账号，家长端仅向家长账号开放。');
        return;
      }

      // 会话 token 在 httpOnly cookie 里；这里只缓存公开投影，省去进入页面后的首次校验等待。
      writeCachedSession(data);
      window.location.assign(PARENT_HOME_HREF);
    } catch {
      setError({ kind: 'offline' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell title="家长登录" accent={colors.primary}>
      <div className="qitu-parent-login">
        <BrandLogo width={160} className="qitu-parent-login-logo" />
        <SectionCard title="家长账号由学校发放">
          <p className="qitu-parent-login-note">
            启途智学的家长账号由学校统一发放，暂不支持自助注册。请使用学校提供的账号登录。
          </p>

          {deniedNotice ? (
            <PermissionDenied title="家长端仅向家长账号开放" description={deniedNotice} />
          ) : null}

          {error?.kind === 'offline' ? (
            <OfflineBanner readOnly={false} onRetry={() => setError(null)} />
          ) : null}

          <form className="qitu-parent-login-form" onSubmit={handleSubmit}>
            <Field label="邮箱" required>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="parent@qtzx.local"
                required
              />
            </Field>

            <Field label="密码" required>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>

            {error?.kind === 'invalid' || error?.kind === 'generic' ? (
              <p className="qitu-parent-login-error" role="alert">
                {error.message}
              </p>
            ) : null}

            <Button type="submit" variant="primary" loading={submitting}>
              登录
            </Button>
          </form>
        </SectionCard>
      </div>
    </AppShell>
  );
}
