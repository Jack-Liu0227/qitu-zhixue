'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { OfflineBanner } from '@qitu/ui';
import type {
  CurrentUser,
  LoginRequest,
  LoginResponse,
  Role,
  TestLoginAccount,
} from '@qitu/contracts';
import {
  getOrCreateDeviceId,
  readCachedSession,
  writeCachedSession,
  safeRoleDestination,
} from '@qitu/auth';
import { parseTestLoginOptions } from './test-accounts';
import { AccountRegistration } from './AccountRegistration';
import { AuthFrame } from './AuthFrame';
import { Icon } from '../home/icons';
import styles from './auth.module.css';

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
type TestAccountState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; accounts: TestLoginAccount[] };

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
  const [registering, setRegistering] = useState(false);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  function showRegistration(value: boolean) {
    setRegistering(value);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set('mode', 'register');
    else url.searchParams.delete('mode');
    window.history.replaceState(null, '', url.pathname + url.search);
  }
  useEffect(() => {
    const readRegistrationLocation = () => {
      const url = new URL(window.location.href);
      const oldInvite = new URLSearchParams(url.hash.slice(1)).has('invite');
      setRegistering(url.searchParams.get('mode') === 'register' || oldInvite);
      if (oldInvite) {
        url.searchParams.set('mode', 'register');
        window.history.replaceState(null, '', url.pathname + url.search);
      }
    };
    readRegistrationLocation();
    window.addEventListener('hashchange', readRegistrationLocation);
    window.addEventListener('popstate', readRegistrationLocation);
    return () => {
      window.removeEventListener('hashchange', readRegistrationLocation);
      window.removeEventListener('popstate', readRegistrationLocation);
    };
  }, []);
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
      .then(async (response) => {
        if (!response.ok) throw new Error('Test login unavailable');
        const payload: unknown = await response.json();
        return parseTestLoginOptions(payload);
      })
      .then((options) => {
        if (!controller.signal.aborted)
          setTestAccounts({ status: 'ready', accounts: options.accounts });
      })
      .catch(() => {
        if (!controller.signal.aborted) setTestAccounts({ status: 'error' });
      });
    return () => controller.abort();
  }, [testAccountRetry]);

  // 挂载时：预填记住的邮箱 + 读取可能存在的有效会话。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(params.get('next'));
    const requestedRole = params.get('role');
    if (ROLE_OPTIONS.some((option) => option.role === requestedRole))
      setRole(requestedRole as LoginRole);
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
    if (status === 'submitting') return;
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
      const response = await requestLogin(
        {
          email,
          password,
          rememberMe: rememberAccount,
          deviceId: getOrCreateDeviceId(),
        },
        idempotencyKey,
      );

      const payload = (await response.json().catch(() => null)) as {
        data?: LoginResponse;
        message?: string;
      } | null;

      if (!response.ok) {
        if (response.status === 401) setErrorKind('invalid');
        else if (response.status === 409) {
          setErrorKind('other');
          setNotice('此学生账号已登录两台设备，请先在“个人画像 → 登录设备”退出一台设备。');
        } else if (response.status === 429) setErrorKind('rate');
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

  function selectRole(value: LoginRole) {
    setRole(value);
    setErrorKind(null);
    setStatus('idle');
    setNotice('');
  }
  return (
    <AuthFrame
      registering={registering}
      busy={status === 'submitting' || registrationBusy}
      onModeChange={showRegistration}
    >
      {registering ? (
        <AccountRegistration
          onBusyChange={setRegistrationBusy}
          onCancel={() => showRegistration(false)}
          onComplete={(result) => {
            showRegistration(false);
            setRole(result.role);
            setEmail(result.login);
            setPassword('');
            setCachedUser(null);
            setStatus('idle');
            setErrorKind(null);
            setNotice('账号已创建，请使用刚设置的密码登录。');
          }}
        />
      ) : (
        <>
          {cachedUser && (
            <div className={styles.session} role="status">
              <span>你有一个可继续使用的登录会话</span>
              <button
                type="button"
                disabled={status === 'submitting'}
                onClick={() =>
                  window.location.assign(safeRoleDestination(nextPath, cachedUser.role))
                }
              >
                继续进入上次的空间 →
              </button>
            </div>
          )}
          {offline && (
            <div className={styles.offline}>
              <OfflineBanner readOnly message="当前已断网，请恢复网络后再登录。" />
            </div>
          )}
          <div className={styles.roles} role="tablist" aria-label="选择身份">
            {ROLE_OPTIONS.map((option, index) => (
              <button
                key={option.role}
                id={'login-role-' + option.role}
                type="button"
                role="tab"
                aria-selected={role === option.role}
                tabIndex={role === option.role ? 0 : -1}
                disabled={status === 'submitting'}
                onClick={() => selectRole(option.role)}
                onKeyDown={(event) => {
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % ROLE_OPTIONS.length
                      : event.key === 'ArrowLeft'
                        ? (index + ROLE_OPTIONS.length - 1) % ROLE_OPTIONS.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? ROLE_OPTIONS.length - 1
                            : null;
                  const option = next === null ? undefined : ROLE_OPTIONS[next];
                  if (option) {
                    event.preventDefault();
                    selectRole(option.role);
                    document.getElementById('login-role-' + option.role)?.focus();
                  }
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <form className={styles.form} onSubmit={submit} aria-busy={status === 'submitting'}>
            <label className={styles.field} htmlFor="login-email">
              手机号或邮箱
              <input
                id="login-email"
                name="email"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                required
                disabled={status === 'submitting'}
                value={email}
                aria-invalid={status === 'error' && errorKind === 'invalid'}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setStatus('idle');
                  setErrorKind(null);
                  setNotice('');
                  persistRememberedEmail(event.target.value, rememberAccount);
                }}
                placeholder="请输入手机号或登录邮箱"
              />
            </label>
            <div className={styles.field}>
              <label htmlFor="login-password">密码</label>
              <span className={styles.password}>
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  disabled={status === 'submitting'}
                  value={password}
                  aria-invalid={status === 'error' && errorKind === 'invalid'}
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
                  disabled={status === 'submitting'}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? '隐藏' : '显示'}
                </button>
              </span>
            </div>
            <div className={styles.options}>
              <label className={styles.remember}>
                <input
                  type="checkbox"
                  name="rememberAccount"
                  checked={rememberAccount}
                  disabled={status === 'submitting'}
                  onChange={(event) => {
                    setRememberAccount(event.target.checked);
                    persistRememberedEmail(email, event.target.checked);
                  }}
                />
                记住账号
              </label>
              <a href="/contact">忘记密码？</a>
            </div>
            {status === 'error' && errorKind && (
              <p className={styles.error} role="alert">
                {getErrorMessage(errorKind)}
              </p>
            )}
            {notice && (
              <p className={styles.message} role="status">
                {notice}
              </p>
            )}
            <button
              className={styles.primary}
              type="submit"
              disabled={status === 'submitting' || offline}
              aria-busy={status === 'submitting'}
            >
              {status === 'submitting' ? '正在登录…' : offline ? '离线，无法登录' : '进入系统'}
              <Icon name="arrowRight" width={18} height={18} />
            </button>
          </form>
          <p className={styles.hint}>记住账号仅在此设备保存登录信息，不保存密码。</p>
          {testAccounts.status === 'loading' && (
            <p className={styles.hint} role="status">
              正在读取快捷账号…
            </p>
          )}
          {testAccounts.status === 'error' && (
            <div className={styles.shortcuts} role="status">
              快捷账号暂不可用。
              <button
                type="button"
                disabled={offline}
                onClick={() => setTestAccountRetry((value) => value + 1)}
              >
                重试
              </button>
            </div>
          )}
          {testAccounts.status === 'ready' && testAccounts.accounts.length > 0 && (
            <details className={styles.shortcuts}>
              <summary>账号快捷填充</summary>
              <div>
                {testAccounts.accounts.map((account) => (
                  <button
                    key={account.role}
                    type="button"
                    disabled={offline || status === 'submitting'}
                    onClick={() => {
                      setRole(account.role);
                      setEmail(account.email);
                      setPassword(account.password);
                      setShowPassword(false);
                      setErrorKind(null);
                      setStatus('idle');
                      setNotice('账号与密码已填入，点击“进入系统”登录。');
                      persistRememberedEmail(account.email, rememberAccount);
                    }}
                  >
                    {ROLE_OPTIONS.find((option) => option.role === account.role)?.label}账号
                  </button>
                ))}
              </div>
              <p>点击填入登录信息，密码不会保存在本机。</p>
            </details>
          )}
          <div className={styles.alternate}>
            <span>还没有账号？</span>
            <button
              type="button"
              disabled={status === 'submitting'}
              onClick={() => showRegistration(true)}
            >
              创建个人账号
            </button>
          </div>
        </>
      )}
    </AuthFrame>
  );
}
