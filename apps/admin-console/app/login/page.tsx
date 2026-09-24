'use client';

import { useState, type FormEvent } from 'react';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      const payload = (await response.json()) as { data?: { role?: string }; message?: string };
      if (!response.ok || !payload.data) throw new Error(payload.message ?? '登录失败，请检查账号和密码');
      if (payload.data.role !== 'admin') throw new Error('当前账号不是管理员，请使用管理员账号登录');
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
        <p className="admin-login-muted">仅限平台管理员登录。登录后可管理账户、项目模板、AI 策略和审计。</p>
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
