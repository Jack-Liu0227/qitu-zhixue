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
  eyecareTones,
  preferenceFontSizes,
  preferenceThemes,
  type EyecareToneId,
  type PreferenceFontSize,
  type PreferenceTheme,
} from '@qitu/design-tokens';

/**
 * 四端基础偏好（ISSUE-T4 / #9）的客户端壳。
 *
 * 护眼模式特色要求：
 * - 背景：暖米色/豆沙绿系（#F5F0E1、#E8F0E3、#C7EDCC 及柔夜灰）多档可选。
 * - 文字：深灰非纯黑（#3A3A3A、#4A4A4A），对比度完全满足 WCAG AA（≥4.5:1）。
 * - 强调色：降低饱和度，避免高亮纯白与高艳度纯蓝。
 * - 图片/视频：可选叠加暖色防眩光滤镜 (filter: sepia(0.1) brightness(0.95))。
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
export const EYECARE_TONE_STORAGE_KEY = 'qitu.eyecare.tone';
export const EYECARE_MEDIA_FILTER_STORAGE_KEY = 'qitu.eyecare.mediaFilter';

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
  eyecare: '护眼模式',
};

export function getStoredEyecareTone(): EyecareToneId {
  if (typeof window === 'undefined') return 'beige';
  try {
    const raw = window.localStorage.getItem(EYECARE_TONE_STORAGE_KEY);
    return raw && (raw in eyecareTones) ? (raw as EyecareToneId) : 'beige';
  } catch {
    return 'beige';
  }
}

export function setStoredEyecareTone(tone: EyecareToneId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(EYECARE_TONE_STORAGE_KEY, tone);
  } catch {}
}

export function getStoredMediaFilter(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(EYECARE_MEDIA_FILTER_STORAGE_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

export function setStoredMediaFilter(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(EYECARE_MEDIA_FILTER_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {}
}

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

/** 把偏好写到 `<html>`：主题 / 字号用既有令牌；护眼多档底色与柔光滤镜同步响应。 */
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
  root.setAttribute('data-qitu-theme', preferences.theme);

  if (preferences.theme === 'eyecare') {
    const toneId = getStoredEyecareTone();
    const tone = eyecareTones[toneId] ?? eyecareTones.beige;
    root.setAttribute('data-qitu-eyecare-tone', toneId);
    root.style.setProperty('--qitu-page', tone.page);
    root.style.setProperty('--qitu-surface', tone.surface);
    root.style.setProperty('--qitu-surface-inset', tone.surfaceInset);
    root.style.setProperty('--qitu-heading', tone.heading);
    root.style.setProperty('--qitu-text', tone.text);
    root.style.setProperty('--qitu-muted', tone.muted);
    root.style.setProperty('--qitu-border', tone.border);
    root.style.setProperty('--qitu-primary', tone.primary);
    root.style.setProperty('--qitu-primary-soft', tone.primarySoft);

    const mediaFilter = getStoredMediaFilter();
    if (mediaFilter) {
      root.setAttribute('data-qitu-media-filter', 'true');
    } else {
      root.removeAttribute('data-qitu-media-filter');
    }
    root.style.setProperty('color-scheme', toneId === 'dark' ? 'dark' : 'light');
  } else {
    root.removeAttribute('data-qitu-eyecare-tone');
    root.removeAttribute('data-qitu-media-filter');
    root.style.setProperty('color-scheme', 'light');
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

async function pushServerPreferences(patch: AccountPreferences): Promise<LoadResult> {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': newIdempotencyKey(),
      },
      body: JSON.stringify(patch),
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
 */
export function PreferencesMenu() {
  const { preferences, source, status, message, setPreference, reload } = useAccountPreferences();
  const [open, setOpen] = useState(false);
  const [currentTone, setCurrentTone] = useState<EyecareToneId>('beige');
  const [mediaFilter, setMediaFilter] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fieldPrefix = useId();

  useEffect(() => {
    setCurrentTone(getStoredEyecareTone());
    setMediaFilter(getStoredMediaFilter());
  }, []);

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

  const handleSelectTone = (tone: EyecareToneId) => {
    setStoredEyecareTone(tone);
    setCurrentTone(tone);
    applyAccountPreferences({ ...preferences, theme: 'eyecare' });
  };

  const handleToggleMediaFilter = (checked: boolean) => {
    setStoredMediaFilter(checked);
    setMediaFilter(checked);
    applyAccountPreferences({ ...preferences, theme: 'eyecare' });
  };

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
            <legend className="qitu-prefs-legend">主题模式</legend>
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

          {preferences.theme === 'eyecare' ? (
            <div className="qitu-prefs-eyecare-subbox">
              <span className="qitu-prefs-sublegend">护眼底色选择 (WCAG AA 深灰正文)</span>
              <div className="qitu-prefs-tone-chips">
                {(Object.keys(eyecareTones) as EyecareToneId[]).map((key) => {
                  const tone = eyecareTones[key];
                  const isChecked = currentTone === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`qitu-prefs-tone-chip ${isChecked ? 'is-active' : ''}`}
                      onClick={() => handleSelectTone(key)}
                      style={{ background: tone.page, color: tone.heading, borderColor: isChecked ? tone.primary : tone.border }}
                    >
                      <span className="qitu-prefs-tone-dot" style={{ background: tone.primary }} />
                      {tone.label.split(' ')[0]}
                    </button>
                  );
                })}
              </div>

              <label className="qitu-prefs-switch" style={{ marginTop: '8px' }}>
                <span style={{ fontSize: '0.78rem' }}>图片与视频柔光防眩光滤镜</span>
                <input
                  type="checkbox"
                  checked={mediaFilter}
                  onChange={(e) => handleToggleMediaFilter(e.target.checked)}
                />
              </label>
            </div>
          ) : null}

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

/**
 * 专为学生端（及任何需要独立护眼浮窗的场景）提供的快捷独立护眼控制按钮与弹出面板。
 * 解决顶栏被 greeting banner 遮挡或层叠上下文捕获点不开的问题，具有高优先级 z-index。
 */
export function EyecareQuickButton() {
  const { preferences, setPreference } = useAccountPreferences();
  const [open, setOpen] = useState(false);
  const [currentTone, setCurrentTone] = useState<EyecareToneId>('beige');
  const [mediaFilter, setMediaFilter] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCurrentTone(getStoredEyecareTone());
    setMediaFilter(getStoredMediaFilter());
  }, []);

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

  const isEyecare = preferences.theme === 'eyecare';

  const handleToggleEyecare = () => {
    const next = isEyecare ? 'default' : 'eyecare';
    setPreference({ theme: next });
    if (next === 'eyecare') {
      applyAccountPreferences({ ...preferences, theme: 'eyecare' });
    }
  };

  const handleSelectTone = (tone: EyecareToneId) => {
    setStoredEyecareTone(tone);
    setCurrentTone(tone);
    if (!isEyecare) {
      setPreference({ theme: 'eyecare' });
    }
    applyAccountPreferences({ ...preferences, theme: 'eyecare' });
  };

  const handleToggleMediaFilter = (checked: boolean) => {
    setStoredMediaFilter(checked);
    setMediaFilter(checked);
    if (isEyecare) {
      applyAccountPreferences({ ...preferences, theme: 'eyecare' });
    }
  };

  const activeTone = eyecareTones[currentTone] ?? eyecareTones.beige;

  return (
    <div className="qitu-eyecare-quick" ref={containerRef}>
      <button
        type="button"
        className={`qitu-eyecare-quick-btn ${isEyecare ? 'is-active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="护眼模式设置 (暖米/豆沙绿/柔光滤镜)"
      >
        <span className="qitu-eyecare-icon" aria-hidden="true">🌿</span>
        <span className="qitu-eyecare-btn-label">
          {isEyecare ? `护眼·${activeTone.label.split(' ')[0]}` : '护眼模式'}
        </span>
      </button>

      {open ? (
        <div className="qitu-eyecare-popover" role="dialog" aria-label="护眼模式设置">
          <div className="qitu-eyecare-popover-head">
            <div className="qitu-eyecare-popover-title">
              <span aria-hidden="true">🌿</span>
              <strong>护眼模式设置</strong>
            </div>
            <button
              type="button"
              className={`qitu-eyecare-toggle-btn ${isEyecare ? 'is-on' : 'is-off'}`}
              onClick={handleToggleEyecare}
            >
              {isEyecare ? '已开启' : '开启护眼'}
            </button>
          </div>

          <p className="qitu-eyecare-subdesc">
            采用深灰低反差字色（#3A3A3A / #4A4A4A），对比度 ≥ 4.5:1，完全达标 WCAG AA 视力友好标准。强调色降低饱和度，避免高亮纯白与刺眼纯蓝。
          </p>

          <div className="qitu-eyecare-section">
            <span className="qitu-eyecare-section-label">背景色调预设</span>
            <div className="qitu-eyecare-tones-grid">
              {(Object.keys(eyecareTones) as EyecareToneId[]).map((key) => {
                const tone = eyecareTones[key];
                const isSelected = isEyecare && currentTone === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`qitu-eyecare-tone-card ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => handleSelectTone(key)}
                  >
                    <span
                      className="qitu-eyecare-tone-swatch"
                      style={{ background: tone.page, borderColor: tone.border }}
                      aria-hidden="true"
                    >
                      <span style={{ color: tone.text, fontSize: '11px', fontWeight: 700 }}>文</span>
                    </span>
                    <span className="qitu-eyecare-tone-info">
                      <strong className="qitu-eyecare-tone-name">{tone.label}</strong>
                      <span className="qitu-eyecare-tone-code">{tone.code}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="qitu-eyecare-section">
            <label className="qitu-eyecare-switch-row">
              <div className="qitu-eyecare-switch-text">
                <strong>图片与视频防眩光暖色滤镜</strong>
                <span>降低媒体高光，叠加柔和滤镜 (sepia 0.1, brightness 0.95)</span>
              </div>
              <input
                type="checkbox"
                checked={mediaFilter}
                onChange={(e) => handleToggleMediaFilter(e.target.checked)}
              />
            </label>
          </div>

          <div className="qitu-eyecare-popover-foot">
            <span className="qitu-eyecare-badge-aa">✓ 符合 WCAG AA 对比度 (≥4.5:1)</span>
            <button
              type="button"
              className="qitu-eyecare-close-btn"
              onClick={() => setOpen(false)}
            >
              完成
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
