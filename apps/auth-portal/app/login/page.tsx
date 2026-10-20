'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { BrandMark, OfflineBanner, VisualAsset } from '@qitu/ui';
import type { CurrentUser, LoginRequest, LoginResponse, Role, TestLoginAccount } from '@qitu/contracts';
import { getOrCreateDeviceId, readCachedSession, writeCachedSession, safeRoleDestination } from '@qitu/auth';
import { parseTestLoginOptions } from './test-accounts';

const REMEMBERED_ACCOUNT_KEY = 'qitu.auth.rememberedAccount';

type LoginRole = Exclude<Role, 'support'>;

interface RoleOption {
  role: LoginRole;
  label: string;
  destination: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    role: 'student',
    label: '学生',
    destination: '/student',
  },
  {
    role: 'parent',
    label: '家长',
    destination: '/parent',
  },
  {
    role: 'teacher',
    label: '班主任',
    destination: '/teacher',
  },
  {
    role: 'admin',
    label: '管理员',
    destination: '/admin',
  },
];

function makeIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `login-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function requestLogin(body: LoginRequest, idempotencyKey: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      if (attempt < 2 && [502, 503, 504].includes(response.status)) {
        await new Promise((resolve) => window.setTimeout(resolve, 450 * (attempt + 1)));
        continue;
      }
      return response;
    } catch (cause) {
      lastError = cause;
      if (attempt === 2) throw cause;
      await new Promise((resolve) => window.setTimeout(resolve, 450 * (attempt + 1)));
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('登录请求失败');
}

type SubmitStatus = 'idle' | 'submitting' | 'error';
type ErrorKind = 'invalid' | 'role' | 'network' | 'rate' | 'other' | null;
type TestAccountState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; accounts: TestLoginAccount[] };

const ERROR_MESSAGES: Record<Exclude<ErrorKind, null>, string> = {
  invalid: '账号或密码错误，请检查后重试。',
  role: '当前账号角色与所选身份不匹配，请切换身份后重试。',
  network: '网络不可达，请检查网络连接后重试。',
  rate: '尝试过于频繁，请稍后再试。',
  other: '登录失败，请稍后重试。',
};

function getErrorMessage(kind: Exclude<ErrorKind, null>): string {

  return ERROR_MESSAGES[kind];
}

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
  const [testAccounts, setTestAccounts] = useState<TestAccountState>({ status: 'loading' });
  const [testAccountRetry, setTestAccountRetry] = useState(0);

  const [nextPath, setNextPath] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setTestAccounts({ status: 'loading' });
    void fetch('/api/v1/auth/test-accounts', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Test login unavailable');
        const payload: unknown = await response.json();
        return parseTestLoginOptions(payload);
      })
      .then(options => { if (!controller.signal.aborted) setTestAccounts({ status: 'ready', accounts: options.accounts }); })
      .catch(() => { if (!controller.signal.aborted) setTestAccounts({ status: 'error' }); });
    return () => controller.abort();
  }, [testAccountRetry]);

  // 挂载时：预填记住的邮箱 + 读取可能存在的有效会话。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(params.get('next'));
    const requestedRole = params.get('role');
    if (ROLE_OPTIONS.some((option) => option.role === requestedRole)) setRole(requestedRole as LoginRole);
    if (params.get('reason') === 'forbidden') setNotice('请使用有权访问此页面的账号登录。');
    let rememberedEmail = '';
    try {
      rememberedEmail = window.localStorage.getItem(REMEMBERED_ACCOUNT_KEY) ?? '';
    } catch {
      rememberedEmail = '';
    }
    if (rememberedEmail) {
      setEmail(rememberedEmail);
      setRememberAccount(true);
    }

    const session = readCachedSession();
    const now = Date.now();
    const valid =
      session !== null &&
      Number.isFinite(new Date(session.expiresAt).getTime()) &&
      new Date(session.expiresAt).getTime() > now;
    setCachedUser(valid ? session.user : null);
  }, []);

  // 断网检测：断网时禁用提交并提示。
  useEffect(() => {
    function update(): void {
      setOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
    }
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  function persistRememberedEmail(nextEmail: string, nextRemember: boolean): void {
    try {
      if (nextRemember) {
        window.localStorage.setItem(REMEMBERED_ACCOUNT_KEY, nextEmail);
      } else {
        window.localStorage.removeItem(REMEMBERED_ACCOUNT_KEY);
      }
    } catch {
      // localStorage 不可用时静默降级：本次登录仍可用，只是无法记住账号。
    }
  }


  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (offline) {
      setErrorKind('network');
      setStatus('error');
      return;
    }

    setStatus('submitting');
    setErrorKind(null);
    setNotice('');

    const idempotencyKey = makeIdempotencyKey();
    try {
      const response = await requestLogin({
        email,
        password,
        rememberMe: rememberAccount,
        deviceId: getOrCreateDeviceId(),
      }, idempotencyKey);

      const payload = (await response.json().catch(() => null)) as {
        data?: LoginResponse;
        message?: string;
      } | null;

      if (!response.ok) {
        if (response.status === 401) setErrorKind('invalid');
        else if (response.status === 409) { setErrorKind('other'); setNotice('此学生账号已登录两台设备，请先在“个人画像 → 登录设备”退出一台设备。'); }
        else if (response.status === 429) setErrorKind('rate');
        else setErrorKind('other');
        setStatus('error');
        return;
      }

      const data = payload?.data;
      if (!data?.user) {
        setErrorKind('other');
        setStatus('error');
        return;
      }

      if (data.user.role !== role) {
        setErrorKind('role');
        setStatus('error');
        return;
      }

      writeCachedSession(data);
      persistRememberedEmail(email, rememberAccount);
      // 登录成功后跳转到对应的系统；仅当 next 属于该角色命名空间时才继承 next
      const targetPath = safeRoleDestination(nextPath, data.user.role);
      window.location.assign(targetPath);
    } catch (cause) {
      if (
        cause instanceof TypeError ||
        (typeof navigator !== 'undefined' && navigator.onLine === false)
      ) {
        setErrorKind('network');
      } else {
        setErrorKind('other');
      }
      setStatus('error');
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand-row">
          <div className="login-brand">
            <BrandMark size={36} decorative />
            <span>启途智学</span>
          </div>
          <VisualAsset assetId="brand-collaboration-v1" size={72} />
        </div>
        <h2 id="login-title">登录你的工作空间</h2>
        <p className="login-muted">选择身份后，将进入对应的学习系统。</p>

        {cachedUser ? (
          <div className="login-session-banner" role="status">
            <span>检测到上次登录的会话</span>
            <button
              type="button"
              className="login-continue"
              onClick={() => window.location.assign(safeRoleDestination(nextPath, cachedUser.role))}
            >
              继续进入上次的空间
            </button>
          </div>
        ) : null}

        {offline ? (
          <div className="login-offline">
            <OfflineBanner readOnly message="当前处于离线状态，无法验证账号。登录请求不会缓存在本机，请恢复网络后重新提交。" />
          </div>
        ) : null}

        <div className="role-tabs" role="tablist" aria-label="选择身份">
          {ROLE_OPTIONS.map((option) => (
            <button
              className={role === option.role ? 'role-tab active' : 'role-tab'}
              key={option.role}
              type="button"
              onClick={() => {
                setRole(option.role);
                setErrorKind(null);
                setStatus('idle');
                setNotice('');
              }}
              role="tab"
              aria-selected={role === option.role}
            >
              {option.label}
            </button>
          ))}
        </div>

        <form onSubmit={submit} aria-busy={status === 'submitting'}>
          <label htmlFor="login-email">
            邮箱
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setStatus('idle');
                setErrorKind(null);
                setNotice('');
                persistRememberedEmail(event.target.value, rememberAccount);
              }}
              placeholder="请输入学校统一发放的登录邮箱"
            />
          </label>

          <label htmlFor="login-password">
            密码
            <span className="login-password-wrap">
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setStatus('idle');
                  setErrorKind(null);
                  setNotice('');
                }}
                placeholder="请输入密码"
              />
              <button
                type="button"
                className="login-password-toggle"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? '隐藏' : '显示'}
              </button>
            </span>
          </label>

          <label className="login-remember">
            <input
              type="checkbox"
              name="rememberAccount"
              checked={rememberAccount}
              onChange={(event) => {
                setRememberAccount(event.target.checked);
                persistRememberedEmail(email, event.target.checked);
              }}
            />
            <span>记住账号（仅在本机保存邮箱，不保存密码）</span>
          </label>

          {status === 'error' && errorKind ? (
            <p className="login-error" role="alert">
              {getErrorMessage(errorKind)}
            </p>
          ) : null}

          {notice ? (
            <p className="login-notice" role="status">
              {notice}
            </p>
          ) : null}

          <button
            className="login-submit"
            disabled={status === 'submitting' || offline}
            type="submit"
            aria-busy={status === 'submitting'}
          >
            {status === 'submitting' ? '登录中…' : offline ? '离线，无法登录' : '进入系统'}
          </button>
        </form>

        <p className="login-forgot">
          忘记密码？请联系班主任或学校管理员重置。
        </p>

        {testAccounts.status === 'loading' ? <p className="login-muted" role="status">正在检查测试账号入口…</p> : null}
        {testAccounts.status === 'error' ? <p className="login-muted" role="status">
          测试账号入口暂不可用。<button type="button" disabled={offline} onClick={() => setTestAccountRetry(value => value + 1)}>重试</button>
        </p> : null}
        {testAccounts.status === 'ready' && testAccounts.accounts.length > 0 ? (
          <section className="login-demo" aria-labelledby="test-account-title">
            <h3 id="test-account-title" className="login-demo-title">测试账号快捷填充</h3>
            <div className="login-demo-buttons">
              {testAccounts.accounts.map(account => (
                <button key={account.role} type="button" disabled={offline || status === 'submitting'} onClick={() => {
                  setRole(account.role);
                  setEmail(account.email);
                  setPassword(account.password);
                  setShowPassword(false);
                  setErrorKind(null);
                  setStatus('idle');
                  setNotice('测试账号与密码已填入，点击“进入系统”登录。');
                  persistRememberedEmail(account.email, rememberAccount);
                }}>{ROLE_OPTIONS.find(option => option.role === account.role)?.label}测试账号</button>
              ))}
            </div>
            <p className="login-demo-note">点击按钮填入账号和密码，再点击“进入系统”。测试密码不会保存在本机。</p>
          </section>
        ) : null}

        <p className="login-account-note">
          使用学校或机构发放的账号登录。没有账号？请联系学校管理员，或<a href="/contact">联系启途团队</a>。
        </p>
      </section>
    </main>
  );
}
