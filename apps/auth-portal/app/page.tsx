'use client';

import { useState, type FormEvent } from 'react';

const destinations = {
  student: '/student',
  parent: '/parent',
  teacher: '/teacher',
  admin: '/admin',
} as const;

type Role = keyof typeof destinations;

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('student');
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
      const payload = (await response.json()) as { data?: { role: Role }; message?: string };
      if (!response.ok || !payload.data) throw new Error(payload.message ?? '登录失败，请检查账号和密码');
      if (payload.data.role !== role) {
        throw new Error('当前账号角色与所选系统不匹配，请切换入口后重试');
      }
      window.location.assign(destinations[payload.data.role]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请稍后重试');
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-intro">
        <p className="eyebrow">QITU SMART LEARNING</p>
        <h1>一个入口，连接三种学习关系。</h1>
        <p>学生探索和创作，家长看见成长过程，班主任及时提供支持。</p>
        <div className="login-route-list">
          <span>学生学习中心</span>
          <span>家长陪伴中心</span>
          <span>班主任工作台</span>
          <span>平台管理后台</span>
        </div>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">启途智学</div>
        <h2 id="login-title">登录你的工作空间</h2>
        <p className="login-muted">选择身份后，将进入对应的学习系统。</p>
        <div className="role-tabs" role="tablist" aria-label="选择身份">
          {(['student', 'parent', 'teacher', 'admin'] as const).map((item) => (
            <button
              className={role === item ? 'role-tab active' : 'role-tab'}
              key={item}
              type="button"
              onClick={() => setRole(item)}
              role="tab"
              aria-selected={role === item}
            >
              {item === 'student' ? '学生' : item === 'parent' ? '家长' : item === 'teacher' ? '班主任' : '管理员'}
            </button>
          ))}
        </div>
        <form onSubmit={submit}>
          <label>
            邮箱
            <input autoComplete="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="请输入登录邮箱" />
          </label>
          <label>
            密码
            <input autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" />
          </label>
          {error ? <p className="login-error" role="alert">{error}</p> : null}
          <button className="login-submit" disabled={submitting} type="submit">
            {submitting ? '登录中…' : '进入系统'}
          </button>
        </form>
        <p className="login-demo">开发演示账号由服务器环境变量控制。</p>
      </section>
    </main>
  );
}
