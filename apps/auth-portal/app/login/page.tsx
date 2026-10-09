'use client';

import { useEffect, useMemo, useState, type FormEvent, type CSSProperties } from 'react';
import Link from 'next/link';
import { BrandMark, OfflineBanner } from '@qitu/ui';
import type { CurrentUser, LoginRequest, LoginResponse, Role } from '@qitu/contracts';
import { readCachedSession, writeCachedSession } from '@qitu/auth';

const REMEMBERED_ACCOUNT_KEY = 'qitu.auth.rememberedAccount';

type LoginRole = Exclude<Role, 'support'>;
interface RoleOption {
  role: LoginRole;
  label: string;
  destination: string;
  demoEmail: string;
  demoPassword: string;
}
const ROLE_OPTIONS: RoleOption[] = [
  { role: 'student', label: '学生', destination: '/student', demoEmail: 'student@qtzx.local', demoPassword: 'student123' },
  { role: 'parent', label: '家长', destination: '/parent', demoEmail: 'parent@qtzx.local', demoPassword: 'parent123' },
  { role: 'teacher', label: '班主任', destination: '/teacher', demoEmail: 'teacher@qtzx.local', demoPassword: 'teacher123' },
  { role: 'admin', label: '管理员', destination: '/admin', demoEmail: 'admin@qtzx.local', demoPassword: 'admin123' },
];
function destinationFor(role: Role): string {
  return ROLE_OPTIONS.find((item) => item.role === role)?.destination ?? '/';
}
function resolveNextPath(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || typeof window === 'undefined') return null;
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch { return null; }
}
function makeIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `login-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
type SubmitStatus = 'idle' | 'submitting' | 'error';
type ErrorKind = 'invalid' | 'role' | 'network' | 'rate' | 'other' | null;
const ERROR_MESSAGES: Record<Exclude<ErrorKind, null>, string> = {
  invalid: '账号或密码错误，请检查后重试。',
  role: '当前账号角色与所选身份不匹配，请切换身份后重试。',
  network: '网络不可达，请检查网络连接后重试。',
  rate: '尝试过于频繁，请稍后再试。',
  other: '登录失败，请稍后重试。',
};

export default function LoginPage() {
  const [role, setRole] = useState<LoginRole>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberAccount, setRememberAccount] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const [offline, setOffline] = useState(false);
  const [cachedUser, setCachedUser] = useState<CurrentUser | null>(null);
  const [notice, setNotice] = useState('');
  const nextPath = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return resolveNextPath(new URLSearchParams(window.location.search).get('next'));
  }, []);

  useEffect(() => {
    try {
      const rememberedEmail = window.localStorage.getItem(REMEMBERED_ACCOUNT_KEY) ?? '';
      if (rememberedEmail) { setEmail(rememberedEmail); setRememberAccount(true); }
    } catch { /* localStorage 不可用时仍可登录。 */ }
    const session = readCachedSession();
    const valid = session && Number.isFinite(new Date(session.expiresAt).getTime()) && new Date(session.expiresAt).getTime() > Date.now();
    setCachedUser(valid ? session.user : null);
  }, []);

  useEffect(() => {
    const update = () => setOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  function persistRememberedEmail(value: string, remember: boolean): void {
    try { remember ? window.localStorage.setItem(REMEMBERED_ACCOUNT_KEY, value) : window.localStorage.removeItem(REMEMBERED_ACCOUNT_KEY); } catch { /* 降级为不记住账号。 */ }
  }
  function resetMessage(): void { setStatus('idle'); setErrorKind(null); setNotice(''); }
  function fillDemoAccount(option: RoleOption): void {
    setRole(option.role); setEmail(option.demoEmail); setPassword(option.demoPassword); resetMessage();
    setNotice('已填充演示环境账号，提交后仍会通过服务器登录接口校验。');
  }
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (offline) { setErrorKind('network'); setStatus('error'); return; }
    setStatus('submitting'); setErrorKind(null); setNotice('');
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Idempotency-Key': makeIdempotencyKey() },
        credentials: 'include',
        body: JSON.stringify({ email, password, rememberMe: rememberAccount } satisfies LoginRequest),
      });
      const payload = (await response.json().catch(() => null)) as { data?: LoginResponse } | null;
      if (!response.ok) {
        setErrorKind(response.status === 401 ? 'invalid' : response.status === 429 ? 'rate' : 'other');
        setStatus('error'); return;
      }
      const data = payload?.data;
      if (!data?.user) { setErrorKind('other'); setStatus('error'); return; }
      if (data.user.role !== role) { setErrorKind('role'); setStatus('error'); return; }
      writeCachedSession(data);
      persistRememberedEmail(email, rememberAccount);
      window.location.assign(nextPath ?? destinationFor(data.user.role));
    } catch (cause) {
      setErrorKind(cause instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'network' : 'other');
      setStatus('error');
    }
  }

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <Link className="brand" href="/" aria-label="返回启途智学首页"><span className="logo" aria-hidden="true"><BrandMark size={36} decorative /></span><span>启途智学</span></Link>
        <Link className="home-link" href="/">返回首页 <span aria-hidden="true">↗</span></Link>
      </header>
      <main className="workspace-layout">
        <section className="workspace-card" aria-labelledby="login-title">
          <div className="brand card-brand"><span className="logo" aria-hidden="true"><BrandMark size={42} decorative /></span><span>启途智学</span></div>
          <h1 id="login-title">登录你的工作空间</h1>
          <p className="card-description">选择身份后，将进入对应的学习系统。</p>
          {cachedUser ? <div className="session-note" role="status">检测到上次登录的会话。<button type="button" onClick={() => window.location.assign(destinationFor(cachedUser.role))}>继续进入</button></div> : null}
          {offline ? <div className="offline-note"><OfflineBanner readOnly={false} /></div> : null}
          <div className="role-picker" role="group" aria-label="选择登录身份" style={{ '--role-index': ROLE_OPTIONS.findIndex((item) => item.role === role) } as CSSProperties}>
            {ROLE_OPTIONS.map((option) => <button key={option.role} type="button" className={option.role === role ? 'selected' : ''} aria-pressed={option.role === role} onClick={() => { setRole(option.role); resetMessage(); }}>{option.label}</button>)}
          </div>
          <form onSubmit={submit} aria-busy={status === 'submitting'}>
            <label htmlFor="email">登录邮箱</label>
            <div className="field"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg><input id="email" type="email" autoComplete="username" placeholder="请输入学校统一发放的登录邮箱" required value={email} onChange={(event) => { setEmail(event.target.value); resetMessage(); persistRememberedEmail(event.target.value, rememberAccount); }} /></div>
            <label htmlFor="password">密码</label>
            <div className="field"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg><input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="请输入密码" required value={password} onChange={(event) => { setPassword(event.target.value); resetMessage(); }} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-pressed={showPassword} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? '隐藏' : '显示'}</button></div>
            <div className="form-options"><label className="remember"><input type="checkbox" checked={rememberAccount} onChange={(event) => { setRememberAccount(event.target.checked); persistRememberedEmail(email, event.target.checked); }} />记住账号</label><button type="button" onClick={() => setNotice('请联系班主任或学校管理员重置密码。')}>忘记密码？</button></div>
            <p className="remember-hint">仅在本机保存邮箱，不保存密码</p>
            {status === 'error' && errorKind ? <p className="workspace-message" role="alert">{ERROR_MESSAGES[errorKind]}</p> : null}
            {notice ? <p className="workspace-message" role="status">{notice}</p> : null}
            <button className="workspace-submit" disabled={status === 'submitting' || offline} type="submit">{status === 'submitting' ? '登录中…' : offline ? '离线，无法登录' : '进入学习空间'} <span aria-hidden="true">→</span></button>
          </form>
          <div className="reset-note"><span aria-hidden="true">ⓘ</span><p>本平台不提供自助重置，请联系班主任或管理员重置密码。</p></div>
          <div className="demo-area"><div className="demo-title">演示环境账号 <span>点击填充 · 仅供界面预览</span></div><div className="demo-buttons">{ROLE_OPTIONS.map((option) => <button key={option.role} type="button" onClick={() => fillDemoAccount(option)}>{option.label}演示 ↗</button>)}</div><p>演示数据仍通过真实登录接口校验，正式环境请使用学校统一发放的账号。</p></div>
        </section>
      </main>
      <footer className="workspace-footer"><span>© 2026 启途智学</span><span>专注学习 · 安心成长</span></footer>
    </main>
  );
}

