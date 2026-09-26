'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { LoginResponse } from '@qitu/contracts';

/** 与 `app/(console)/layout.tsx` 共享的拒绝原因 key。 */
const DENIED_KEY = 'qitu.admin.auth-denied';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // AuthGuard 会把「未登录 / 会话过期 / 非管理员被拒」的原因写进 sessionStorage，
    // 这里把它转成明确可见的提示，避免静默跳转。
    try {
      const reason = window.sessionStorage.getItem(DENIED_KEY);
      if (reason) {
        window.sessionStorage.removeItem(DENIED_KEY);
        setError(
          reason === 'forbidden'
            ? '当前账号不是管理员，已拒绝访问。请使用管理员账号登录。'
            : '登录已过期或尚未登录，请先登录。',
        );
      }
    } catch {
      // 读不到 sessionStorage 时保持安静即可。
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as { data?: LoginResponse; message?: string };
      if (!response.ok || !payload.data?.user) {
        throw new Error(payload.message ?? '登录失败，请检查账号和密码');
      }
      // 登录响应的角色字段嵌套在 `data.user.role` 下，不是 `data.role`。
      if (payload.data.user.role !== 'admin') {
        throw new Error('当前账号不是管理员，请使用管理员账号登录');
      }
      window.location.assign('/admin');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请稍后重试');
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-login-page">
      <section className="admin-login-panel" aria-labelledby="admin-login-title">
        <p className="eyebrow">ADMIN CONSOLE</p>
        <h1 id="admin-login-title">平台管理后台</h1>
        <p className="admin-login-muted">仅限平台管理员登录。登录后可管理模型配置等平台能力。</p>
        <form onSubmit={submit}>
          <label>
            管理员邮箱
            <input
              autoComplete="username"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="请输入管理员邮箱"
            />
          </label>
          <label>
            密码
            <input
              autoComplete="current-password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
            />
          </label>
          {error ? (
            <p className="admin-login-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="admin-login-submit" disabled={submitting} type="submit">
            {submitting ? '登录中…' : '进入管理后台'}
          </button>
        </form>
      </section>
    </main>
  );
}
