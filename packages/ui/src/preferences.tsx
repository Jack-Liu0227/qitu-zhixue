'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  buildPreferenceVariables,
  preferenceFontSizes,
  preferenceThemes,
  type PreferenceFontSize,
  type PreferenceTheme,
} from '@qitu/design-tokens';

/**
 * 四端基础偏好（ISSUE-T4 / #9）的客户端壳。
 *
 * 设计取舍：
 * - **服务端为准**：登录后从 `/api/v1/account/preferences` 读取；写回带
 *   `Idempotency-Key`，重放安全。
 * - **本机兜底**：服务端返回 503（未配置持久化）/ 断网 / 未登录 / 其他错误时，
 *   更改仍立即生效并写入 `localStorage`，但界面**显式标注“仅本机”**——不假装
 *   已同步。这正是「基础偏好可用、但不掩盖持久化缺口」的最小诚实实现。
 * - **只应用设计令牌**：主题 / 字号只用 `@qitu/design-tokens` 里的既有预设，
 *   客户端不接受、不渲染任何任意色值。
 * - SSR 安全：DOM 只在 `useEffect` 内触碰，服务端首屏固定渲染默认值。
 */

export interface AccountPreferences {
  fontSize: PreferenceFontSize;
  theme: PreferenceTheme;
  reducedMotion: boolean;
  notifications: boolean;
}

export type PreferencesSource = 'server' | 'local';
export type PreferencesStatus = 'loading' | 'ready' | 'offline' | 'error';

export const ACCOUNT_PREFERENCES_STORAGE_KEY = 'qitu.account.preferences';

export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  fontSize: 'md',
  theme: 'default',
  reducedMotion: false,
  notifications: true,
};

const ENDPOINT = '/api/v1/account/preferences';
const REDUCED_MOTION_ATTR = 'data-qitu-reduced-motion';

const FONT_SIZES = Object.keys(preferenceFontSizes) as PreferenceFontSize[];
const THEMES = Object.keys(preferenceThemes) as PreferenceTheme[];

const FONT_SIZE_LABELS: Record<PreferenceFontSize, string> = {
  sm: '小',
  md: '标准',
  lg: '大',
};

const THEME_LABELS: Record<PreferenceTheme, string> = {
  default: '默认',
  focus: '专注',
  calm: '舒缓',
};

/** 把任意输入收敛成合法的偏好对象；非法字段回退默认值。 */
export function sanitizeAccountPreferences(raw: unknown): AccountPreferences {
  if (raw === null || typeof raw !== 'object') {
    return { ...DEFAULT_ACCOUNT_PREFERENCES };
  }
  const source = raw as Record<string, unknown>;
  const fontSize = source.fontSize;
  const theme = source.theme;
  return {
    fontSize: FONT_SIZES.includes(fontSize as PreferenceFontSize)
      ? (fontSize as PreferenceFontSize)
      : DEFAULT_ACCOUNT_PREFERENCES.fontSize,
    theme: THEMES.includes(theme as PreferenceTheme)
      ? (theme as PreferenceTheme)
      : DEFAULT_ACCOUNT_PREFERENCES.theme,
    reducedMotion:
      typeof source.reducedMotion === 'boolean'
        ? source.reducedMotion
        : DEFAULT_ACCOUNT_PREFERENCES.reducedMotion,
    notifications:
      typeof source.notifications === 'boolean'
        ? source.notifications
        : DEFAULT_ACCOUNT_PREFERENCES.notifications,
  };
}

function readLocalPreferences(): AccountPreferences | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ACCOUNT_PREFERENCES_STORAGE_KEY);
    return raw === null ? null : sanitizeAccountPreferences(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocalPreferences(preferences: AccountPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ACCOUNT_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // 无痕模式等写不进：本次会话内仍然生效。
  }
}

/** 把偏好写到 `<html>`：主题 / 字号用既有令牌；减弱动效用根属性。 */
export function applyAccountPreferences(preferences: AccountPreferences): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const variables = buildPreferenceVariables({
    theme: preferences.theme,
    fontSize: preferences.fontSize,
  });
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value as string);
  }
  if (preferences.reducedMotion) {
    root.setAttribute(REDUCED_MOTION_ATTR, 'true');
  } else {
    root.removeAttribute(REDUCED_MOTION_ATTR);
  }
}

type LoadResult =
  | { ok: true; preferences: AccountPreferences }
  | { ok: false; kind: 'unavailable' | 'unauthenticated' | 'offline' | 'error' };

async function fetchServerPreferences(): Promise<LoadResult> {
  try {
    const response = await fetch(ENDPOINT, { credentials: 'include', cache: 'no-store' });
    if (response.status === 503) return { ok: false, kind: 'unavailable' };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, kind: 'unauthenticated' };
    }
    if (!response.ok) return { ok: false, kind: 'error' };
    const body = (await response.json()) as { data?: { preferences?: unknown } };
    return { ok: true, preferences: sanitizeAccountPreferences(body?.data?.preferences) };
  } catch {
    return { ok: false, kind: 'offline' };
  }
}

async function pushServerPreferences(preferences: AccountPreferences): Promise<LoadResult> {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'PUT',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': newIdempotencyKey(),
      },
      body: JSON.stringify(preferences),
    });
    if (response.status === 503) return { ok: false, kind: 'unavailable' };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, kind: 'unauthenticated' };
    }
    if (!response.ok) return { ok: false, kind: 'error' };
    const body = (await response.json()) as { data?: { preferences?: unknown } };
    return { ok: true, preferences: sanitizeAccountPreferences(body?.data?.preferences) };
  } catch {
    return { ok: false, kind: 'offline' };
  }
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `qitu-prefs-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function messageFor(kind: 'unavailable' | 'unauthenticated' | 'offline' | 'error'): string {
  switch (kind) {
    case 'unavailable':
      return '服务器尚未启用偏好存储：更改仅保存在本机。';
    case 'unauthenticated':
      return '登录状态已失效：更改仅保存在本机，请重新登录后同步。';
    case 'offline':
      return '当前离线：更改仅保存在本机，联网后会重新读取。';
    default:
      return '同步失败：更改仅保存在本机。';
  }
}

export interface UseAccountPreferences {
  preferences: AccountPreferences;
  source: PreferencesSource;
  status: PreferencesStatus;
  message: string | null;
  setPreference: (patch: Partial<AccountPreferences>) => void;
  reload: () => void;
}

/** 偏好的读取 / 应用 / 写回逻辑，抽出来便于独立复用与测试。 */
export function useAccountPreferences(): UseAccountPreferences {
  const [preferences, setPreferences] = useState<AccountPreferences>(DEFAULT_ACCOUNT_PREFERENCES);
  const [source, setSource] = useState<PreferencesSource>('local');
  const [status, setStatus] = useState<PreferencesStatus>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const prefsRef = useRef<AccountPreferences>(preferences);
  const [reloadToken, setReloadToken] = useState(0);

  const commit = useCallback((next: AccountPreferences) => {
    prefsRef.current = next;
    setPreferences(next);
    applyAccountPreferences(next);
    writeLocalPreferences(next);
  }, []);

  // 首屏：先用本机缓存立即生效（避免主题闪一下），再拉服务端为准。
  useEffect(() => {
    const local = readLocalPreferences();
    if (local !== null) commit(local);
    else applyAccountPreferences(DEFAULT_ACCOUNT_PREFERENCES);
  }, [commit]);

  // 拉取服务端偏好；`reloadToken` 变化时重试。
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    void (async () => {
      const result = await fetchServerPreferences();
      if (cancelled) return;
      if (result.ok) {
        commit(result.preferences);
        setSource('server');
        setStatus('ready');
        setMessage(null);
        return;
      }
      setSource('local');
      setStatus(result.kind === 'offline' || result.kind === 'unavailable' ? 'offline' : 'error');
      setMessage(messageFor(result.kind));
    })();
    return () => {
      cancelled = true;
    };
  }, [commit, reloadToken]);

  const setPreference = useCallback(
    (patch: Partial<AccountPreferences>) => {
      const next = sanitizeAccountPreferences({ ...prefsRef.current, ...patch });
      commit(next);
      void (async () => {
        const result = await pushServerPreferences(next);
        if (result.ok) {
          commit(result.preferences);
          setSource('server');
          setStatus('ready');
          setMessage(null);
          return;
        }
        setStatus(result.kind === 'offline' || result.kind === 'unavailable' ? 'offline' : 'error');
        setMessage(messageFor(result.kind));
      })();
    },
    [commit],
  );

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  return { preferences, source, status, message, setPreference, reload };
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.75v2.4M12 18.85v2.4M4.4 12H2M22 12h-2.4M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * 顶栏账号区里的偏好入口。
 *
 * 它是**账号能力**，不是业务导航项：不新增导航、不改冻结的信息架构，只复用
 * 既有的顶栏账号区（与 `LogoutButton` 并列）。
 */
export function PreferencesMenu() {
  const { preferences, source, status, message, setPreference, reload } = useAccountPreferences();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fieldPrefix = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const noteTone = status === 'error' ? 'warn' : 'info';

  return (
    <div className="qitu-prefs" ref={containerRef}>
      <button
        type="button"
        className="qitu-prefs-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <GearIcon />
        偏好
      </button>
      {open ? (
        <div className="qitu-prefs-panel" role="dialog" aria-label="偏好设置">
          <p className="qitu-prefs-title">偏好设置</p>

          <fieldset className="qitu-prefs-field">
            <legend className="qitu-prefs-legend">字号</legend>
            <div className="qitu-prefs-options">
              {FONT_SIZES.map((size) => (
                <label key={size} className="qitu-prefs-option">
                  <input
                    type="radio"
                    name={`${fieldPrefix}-font`}
                    checked={preferences.fontSize === size}
                    onChange={() => setPreference({ fontSize: size })}
                  />
                  {FONT_SIZE_LABELS[size]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="qitu-prefs-field">
            <legend className="qitu-prefs-legend">主题</legend>
            <div className="qitu-prefs-options">
              {THEMES.map((theme) => (
                <label key={theme} className="qitu-prefs-option">
                  <input
                    type="radio"
                    name={`${fieldPrefix}-theme`}
                    checked={preferences.theme === theme}
                    onChange={() => setPreference({ theme })}
                  />
                  {THEME_LABELS[theme]}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="qitu-prefs-switch">
            减弱动效
            <input
              type="checkbox"
              checked={preferences.reducedMotion}
              onChange={(event) => setPreference({ reducedMotion: event.target.checked })}
            />
          </label>
          <label className="qitu-prefs-switch">
            接收通知
            <input
              type="checkbox"
              checked={preferences.notifications}
              onChange={(event) => setPreference({ notifications: event.target.checked })}
            />
          </label>

          {status === 'loading' ? (
            <p className="qitu-prefs-note">正在加载账号偏好…</p>
          ) : message !== null ? (
            <p className="qitu-prefs-note" data-tone={noteTone}>
              {message}
              <br />
              <button type="button" className="qitu-prefs-retry" onClick={reload}>
                重试同步
              </button>
            </p>
          ) : (
            <p className="qitu-prefs-note">
              {source === 'server' ? '已同步到当前账号，登录任意端均生效。' : '更改保存在本机。'}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
