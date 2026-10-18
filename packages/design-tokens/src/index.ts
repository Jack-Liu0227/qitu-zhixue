export const PRODUCT_NAME = '启途智学';

export const colors = {
  page: '#F4F7FB',
  primary: '#0038B2',
  heading: '#132646',
  completed: '#087D70',
  attention: '#A65B14',
  danger: '#C33D50',
  border: '#DDE5F0',
  text: '#30435F',
  muted: '#566780',
  surface: '#FDFEFE',
  darkPage: '#131822',
  darkSurface: '#1B2230',
  darkSurfaceInset: '#161C27',
  darkHeading: '#E2E8F0',
  darkText: '#CBD5E1',
  darkMuted: '#8899A6',
  darkBorder: '#283446',
  darkPrimary: '#4D88FF',
  darkPrimarySoft: '#1E2C44',
  // 护眼暖米与豆沙绿系色盘（WCAG AA 对比度 ≥ 4.5:1，低饱和度强调色）
  eyecareWarmBeige: '#F5F0E1',
  eyecareWarmSurface: '#FAF6ED',
  eyecareWarmSurfaceInset: '#EFE8D6',
  eyecareBeanGreen: '#E8F0E3',
  eyecareBeanSurface: '#F1F7EE',
  eyecareBeanSurfaceInset: '#DFEAD8',
  eyecareMintGreen: '#C7EDCC',
  eyecareMintSurface: '#D6F2DA',
  eyecareMintSurfaceInset: '#BBE5C1',
  eyecareTextDark: '#3A3A3A',
  eyecareTextSoft: '#4A4A4A',
  eyecareMuted: '#666666',
  eyecareBorder: '#DDD6C5',
  eyecarePrimary: '#2D6A4F',
  eyecarePrimarySoft: '#E6DFC8',
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

/** 阴影刻度，统一以品牌深蓝 `#132646` 为投影色，保持柔和调性。 */
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
    "'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
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
  primary: { soft: '#E8EFFC', border: '#CAD8F5', hover: '#002E94' },
  completed: { soft: '#E6F7F5', border: '#B6E7E2', hover: '#076B60' },
  attention: { soft: '#FFF0E6', border: '#FFD3B8', hover: '#E9762A' },
  danger: { soft: '#FDEDEE', border: '#F8C9CE', hover: '#D23F4D' },
} as const;

export type DesignSemanticTone = keyof typeof semanticColors;
export type DesignSemanticColor = (typeof semanticColors)[DesignSemanticTone];

/** 品牌渐变，用于横幅、徽标等高强调区域。 */
export const gradients = {
  brand: 'linear-gradient(135deg, #0038B2 0%, #087D70 100%)',
  primary: 'linear-gradient(135deg, #3E8BF5 0%, #0038B2 100%)',
  attention: 'linear-gradient(135deg, #FFA15F 0%, #A65B14 100%)',
  banner: 'linear-gradient(135deg, #E8EFFC 0%, #F4F7FB 100%)',
  glow: 'radial-gradient(circle at 30% 20%, #E8EFFC 0%, #F4F7FB 70%)',
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
  /** 暗色护眼：温润柔和夜间低刺激色调，降低蓝光与视觉疲劳。 */
  eyecare: {
    '--qitu-page': colors.eyecareWarmBeige,
    '--qitu-heading': colors.eyecareTextDark,
    '--qitu-text': colors.eyecareTextSoft,
    '--qitu-muted': colors.eyecareMuted,
    '--qitu-border': colors.eyecareBorder,
    '--qitu-primary': colors.eyecarePrimary,
    '--qitu-primary-soft': colors.eyecarePrimarySoft,
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


/**
 * 护眼模式多档底色预设（暖米色 / 豆沙绿 / 青豆绿 / 柔夜灰）。
 * 严格遵照 WCAG AA 标准：正文深灰（#3A3A3A / #4A4A4A），对比度 ≥ 4.5:1。
 * 强调色降低饱和度，避免高亮纯白与刺眼纯蓝。
 */
export const eyecareTones = {
  beige: {
    id: 'beige',
    label: '暖米色 (推荐)',
    code: '#F5F0E1',
    desc: '柔和羊皮纸暖调，温润不刺眼',
    page: colors.eyecareWarmBeige,
    surface: colors.eyecareWarmSurface,
    surfaceInset: colors.eyecareWarmSurfaceInset,
    heading: colors.eyecareTextDark,
    text: colors.eyecareTextSoft,
    muted: colors.eyecareMuted,
    border: colors.eyecareBorder,
    primary: colors.eyecarePrimary,
    primarySoft: colors.eyecarePrimarySoft,
  },
  bean: {
    id: 'bean',
    label: '豆沙绿',
    code: '#E8F0E3',
    desc: '清爽柔和豆沙绿，舒缓视疲劳',
    page: colors.eyecareBeanGreen,
    surface: colors.eyecareBeanSurface,
    surfaceInset: colors.eyecareBeanSurfaceInset,
    heading: colors.eyecareTextDark,
    text: colors.eyecareTextSoft,
    muted: '#636D5F',
    border: '#C8D7C0',
    primary: '#2D6A4F',
    primarySoft: '#D8E7D1',
  },
  mint: {
    id: 'mint',
    label: '青豆绿',
    code: '#C7EDCC',
    desc: '经典防视疲劳水绿，降低光线眩光',
    page: colors.eyecareMintGreen,
    surface: colors.eyecareMintSurface,
    surfaceInset: colors.eyecareMintSurfaceInset,
    heading: '#2E3830',
    text: '#3E4A40',
    muted: '#526055',
    border: '#A8D7AF',
    primary: '#245B43',
    primarySoft: '#B4E2BC',
  },
  dark: {
    id: 'dark',
    label: '柔夜灰',
    code: '#1A202A',
    desc: '弱光或夜间暗色，沉稳柔和光感',
    page: colors.darkPage,
    surface: colors.darkSurface,
    surfaceInset: colors.darkSurfaceInset,
    heading: colors.darkHeading,
    text: colors.darkText,
    muted: colors.darkMuted,
    border: colors.darkBorder,
    primary: colors.darkPrimary,
    primarySoft: colors.darkPrimarySoft,
  },
} as const;

export type EyecareToneId = keyof typeof eyecareTones;
