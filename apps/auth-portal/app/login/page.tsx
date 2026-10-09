'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { colors } from '@qitu/design-tokens';
import { BrandMark, HandwrittenNote, OfflineBanner, RobotMascot } from '@qitu/ui';
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
  {
    role: 'student',
    label: '学生',
    destination: '/student',
    demoEmail: 'student@qtzx.local',
    demoPassword: 'student123',
  },
  {
    role: 'parent',
    label: '家长',
    destination: '/parent',
    demoEmail: 'parent@qtzx.local',
    demoPassword: 'parent123',
  },
  {
    role: 'teacher',
    label: '班主任',
    destination: '/teacher',
    demoEmail: 'teacher@qtzx.local',
    demoPassword: 'teacher123',
  },
  {
    role: 'admin',
    label: '管理员',
    destination: '/admin',
    demoEmail: 'admin@qtzx.local',
    demoPassword: 'admin123',
  },
];

function destinationFor(role: Role): string {
  const option = ROLE_OPTIONS.find((item) => item.role === role);
  return option?.destination ?? '/';
}

function resolveNextPath(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function makeIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
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
    const params = new URLSearchParams(window.location.search);
    return resolveNextPath(params.get('next'));
  }, []);

  // 挂载时：预填记住的邮箱 + 读取可能存在的有效会话。
  useEffect(() => {
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

  function fillDemoAccount(option: RoleOption): void {
    setRole(option.role);
    setEmail(option.demoEmail);
    setPassword(option.demoPassword);
    setStatus('idle');
    setErrorKind(null);
    setNotice(`已填入${option.label}测试账号，提交后会通过真实登录接口校验。`);
    persistRememberedEmail(option.demoEmail, rememberAccount);
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
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        credentials: 'include',
        body: JSON.stringify({
          email,
          password,
          rememberMe: rememberAccount,
        } satisfies LoginRequest),
      });

      const payload = (await response.json().catch(() => null)) as {
        data?: LoginResponse;
        message?: string;
      } | null;

      if (!response.ok) {
        if (response.status === 401) setErrorKind('invalid');
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
      // 登录成功后由浏览器执行跳转，避免把未确认身份的 next 当作可信目标。
      window.location.assign(nextPath ?? destinationFor(data.user.role));
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
      <section className="login-intro" aria-labelledby="login-intro-title">
        <p className="eyebrow" style={{ color: colors.primary }}>
          QITU SMART LEARNING
        </p>
        <h1 id="login-intro-title" className="login-intro-logo">
          <img src="/brand-logo.png" width={220} height={220} alt="启途智学" />
        </h1>
        <p className="login-positioning">让好奇心有方向，让每个作品留下成长证据。</p>
        <p className="login-desc">启途智学把问题、思考、实践和复盘连接起来，帮助学生在真实项目中建立能力。</p>

        <ul className="login-feature-list">
          <li>从真实问题出发，定义值得研究的方向</li>
          <li>AI 搭档启发式引导，先思考再动手</li>
          <li>先理论后实践，把想法做成真实作品</li>
          <li>作品与成长档案沉淀每一步学习轨迹</li>
        </ul>

        <div className="login-how">
          <HandwrittenNote rotate={-2}>如何登录？</HandwrittenNote>
          <p>
            本平台使用学校统一发放的账号（邮箱）与密码登录，不支持自助注册。
            如忘记密码，请联系班主任或管理员重置。
          </p>
        </div>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand-row">
          <div className="login-brand">
            <BrandMark size={36} decorative />
            <span>启途智学</span>
          </div>
          <RobotMascot size={56} mood="happy" />
        </div>
        <h2 id="login-title">登录你的工作空间</h2>
        <p className="login-muted">选择身份后，将进入对应的学习系统。</p>

        {cachedUser ? (
          <div className="login-session-banner" role="status">
            <span>检测到上次登录的会话</span>
            <button
              type="button"
              className="login-continue"
              onClick={() => window.location.assign(destinationFor(cachedUser.role))}
            >
              继续进入上次的空间
            </button>
          </div>
        ) : null}

        {offline ? (
          <div className="login-offline">
            <OfflineBanner readOnly={false} />
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
              {ERROR_MESSAGES[errorKind]}
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
          忘记密码？本平台不提供自助重置，请联系班主任或管理员重置密码。
        </p>

        <div className="login-demo">
          <p className="login-demo-title">测试账号 <span>一键填入，仍通过真实接口登录</span></p>
          <div className="login-demo-buttons">
            {ROLE_OPTIONS.map((option) => (
              <button key={option.role} type="button" onClick={() => fillDemoAccount(option)}>
                {option.label}账号
              </button>
            ))}
          </div>
          <p className="login-demo-note">账号用于本地与共享演示环境联调，密码不会保存到浏览器。</p>
        </div>

        <p className="login-account-note">
          使用学校或机构发放的账号登录。没有账号或需要重置密码，请联系班主任、学校管理员或启途智学科技有限公司合作团队。
        </p>
      </section>
    </main>
  );
}
