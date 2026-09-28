export const PRODUCT_NAME = '启途智学';

export const colors = {
  page: '#F6FAFF',
  primary: '#2878F0',
  heading: '#102A5C',
  completed: '#18B7AC',
  attention: '#FF8A3D',
  danger: '#E95B68',
  border: '#E4ECF7',
  text: '#243B5A',
  muted: '#73839B',
} as const;

export type DesignColor = keyof typeof colors;

/* ------------------------------------------------------------------ *
 * 以下为基础层扩展：间距、圆角、阴影、排版、语义软色与品牌渐变。
 * 全部为追加，既有 `PRODUCT_NAME` 与 `colors` 的键值保持不变。
 * ------------------------------------------------------------------ */

/**
 * 间距刻度，按 4px 栅格递进。
 * 供内边距、外边距与布局间隙使用。
 */
export const space = {
  none: '0',
  xxs: '2px',
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  xxl: '24px',
  xxxl: '32px',
  huge: '48px',
} as const;

export type DesignSpace = keyof typeof space;

/** 圆角刻度，`pill`/`full` 用于胶囊与正圆元素。 */
export const radii = {
  none: '0',
  xs: '4px',
  sm: '8px',
  md: '10px',
  lg: '14px',
  xl: '20px',
  xxl: '28px',
  pill: '999px',
  full: '50%',
} as const;

export type DesignRadius = keyof typeof radii;

/** 阴影刻度，统一以品牌深蓝 `#102A5C` 为投影色，保持柔和调性。 */
export const shadows = {
  none: 'none',
  xs: '0 1px 2px rgb(16 42 92 / 6%)',
  sm: '0 4px 12px rgb(16 42 92 / 6%)',
  md: '0 8px 24px rgb(16 42 92 / 5%)',
  lg: '0 16px 40px rgb(16 42 92 / 10%)',
  xl: '0 24px 56px rgb(16 42 92 / 14%)',
  focus: '0 0 0 3px rgb(40 120 240 / 35%)',
  popover: '0 20px 48px rgb(16 42 92 / 16%)',
} as const;

export type DesignShadow = keyof typeof shadows;

/** 排版刻度：字体族、字号、行高与字重。 */
export const typography = {
  fontFamily:
    "Inter, 'PingFang SC', 'Microsoft YaHei', ui-sans-serif, system-ui, sans-serif",
  monoFamily:
    "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
  fontSize: {
    xs: '0.75rem',
    sm: '0.85rem',
    md: '0.95rem',
    lg: '1.05rem',
    xl: '1.2rem',
    xxl: '1.5rem',
    display: '2rem',
  },
  lineHeight: {
    tight: '1.2',
    normal: '1.5',
    relaxed: '1.8',
  },
  fontWeight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

export type DesignTypography = typeof typography;

/**
 * 语义软色：每种语义色提供 `soft`(底色)、`border`(描边)、`hover`(加深态)。
 * 用于标签、状态、按钮 hover 等需要同色系浅色背景的场景。
 */
export const semanticColors = {
  primary: { soft: '#EAF2FE', border: '#C6DCFB', hover: '#1E63CE' },
  completed: { soft: '#E6F7F5', border: '#B6E7E2', hover: '#139C93' },
  attention: { soft: '#FFF0E6', border: '#FFD3B8', hover: '#E9762A' },
  danger: { soft: '#FDEDEE', border: '#F8C9CE', hover: '#D23F4D' },
} as const;

export type DesignSemanticTone = keyof typeof semanticColors;
export type DesignSemanticColor = (typeof semanticColors)[DesignSemanticTone];

/** 品牌渐变，用于横幅、徽标等高强调区域。 */
export const gradients = {
  brand: 'linear-gradient(135deg, #2878F0 0%, #18B7AC 100%)',
  primary: 'linear-gradient(135deg, #3E8BF5 0%, #2878F0 100%)',
  attention: 'linear-gradient(135deg, #FFA15F 0%, #FF8A3D 100%)',
  banner: 'linear-gradient(135deg, #EAF2FE 0%, #F6FAFF 100%)',
  glow: 'radial-gradient(circle at 30% 20%, #EAF2FE 0%, #F6FAFF 70%)',
} as const;

export type DesignGradient = keyof typeof gradients;

/* ------------------------------------------------------------------ *
 * 基础偏好预设（T4 / #9）
 *
 * 只允许「从既有令牌取值」的主题预设：每个预设的每一项都是对上面
 * `colors` / `semanticColors` 的引用，**不允许出现新的字面色值**。
 * `tooling/validate-preferences.mjs` 会静态校验这一点。
 * ------------------------------------------------------------------ */

/**
 * 字号预设，作用于根元素 `font-size` 百分比。
 * `md` 为浏览器默认，`lg` 放大到 112.5%（18px），`sm` 缩到 93.75%（15px）。
 */
export const preferenceFontSizes = {
  sm: '93.75%',
  md: '100%',
  lg: '112.5%',
} as const;

export type PreferenceFontSize = keyof typeof preferenceFontSizes;

/**
 * 主题预设，键为 CSS 变量名，值为既有令牌的引用。
 * 客户端把选中主题的变量写到 `documentElement` 上覆盖 `:root`。
 */
export const preferenceThemes = {
  /** 默认：与 `styles.css` 的 `:root` 完全一致。 */
  default: {
    '--qitu-page': colors.page,
    '--qitu-heading': colors.heading,
    '--qitu-text': colors.text,
    '--qitu-muted': colors.muted,
    '--qitu-border': colors.border,
    '--qitu-primary': colors.primary,
    '--qitu-primary-soft': semanticColors.primary.soft,
  },
  /** 专注：正文更深、边框更强，便于长时间阅读，但仍是既有令牌。 */
  focus: {
    '--qitu-page': colors.page,
    '--qitu-heading': colors.heading,
    '--qitu-text': colors.heading,
    '--qitu-muted': colors.text,
    '--qitu-border': colors.heading,
    '--qitu-primary': colors.primary,
    '--qitu-primary-soft': semanticColors.primary.soft,
  },
  /** 舒缓：主色与边框换成已完成的青色语义色，降低视觉刺激。 */
  calm: {
    '--qitu-page': colors.page,
    '--qitu-heading': colors.heading,
    '--qitu-text': colors.text,
    '--qitu-muted': colors.muted,
    '--qitu-border': semanticColors.completed.border,
    '--qitu-primary': colors.completed,
    '--qitu-primary-soft': semanticColors.completed.soft,
  },
} as const;

export type PreferenceTheme = keyof typeof preferenceThemes;

/** 把选中的主题 / 字号展开成可写到 `documentElement` 的 CSS 变量表。 */
export function buildPreferenceVariables(input: {
  theme: PreferenceTheme;
  fontSize: PreferenceFontSize;
}): Record<string, string> {
  return {
    ...preferenceThemes[input.theme],
    '--qitu-font-size': preferenceFontSizes[input.fontSize],
  };
}
