import type { SVGProps } from 'react';

/**
 * 首页图标集。
 *
 * 设计稿使用 Material Symbols 字体图标，但字体由 `fonts.googleapis.com` 下发，
 * 在国内服务器上会被阻断（页面会退化成一串文字）。因此这里改为**内联 SVG**：
 * 不依赖外部字体，首屏无额外请求，也不受字体加载失败影响。
 */
export type IconName =
  | 'menu'
  | 'close'
  | 'sparkle'
  | 'arrowRight'
  | 'play'
  | 'school'
  | 'brain'
  | 'bolt'
  | 'sensors'
  | 'rocket'
  | 'robot'
  | 'chart'
  | 'search'
  | 'verified'
  | 'wrench'
  | 'award'
  | 'target'
  | 'terminal'
  | 'hub'
  | 'forum'
  | 'group'
  | 'chevronRight'
  | 'location'
  | 'mail'
  | 'phone'
  | 'qr'
  | 'send'
  | 'checkCircle'
  | 'user'
  | 'star'
  | 'share'
  | 'mic'
  | 'headset'
  | 'refresh'
  | 'layers'
  | 'clock'
  | 'compass';

/** 统一的线性图标路径（24 视框，线宽 1.8，与设计稿的圆润调性一致）。 */
const PATHS: Record<IconName, string> = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  sparkle:
    'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9zM18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  arrowRight: 'M5 12h13m0 0-5.5-5.5M18 12l-5.5 5.5',
  play: 'M9.5 7.2v9.6L17.5 12z',
  school: 'M3 10.2 12 5l9 5.2M5.2 10.2V19h13.6v-8.8M9.6 19v-4.8h4.8V19',
  brain:
    'M9.2 4.6a2.9 2.9 0 0 0-2.9 2.9 3 3 0 0 0-1 5.6V17a2.9 2.9 0 0 0 4.4 2.5V6.9a2.6 2.6 0 0 0-.5-2.3zM14.8 4.6a2.9 2.9 0 0 1 2.9 2.9 3 3 0 0 1 1 5.6V17a2.9 2.9 0 0 1-4.4 2.5V6.9c0-.8.2-1.6.5-2.3z',
  bolt: 'M13.4 3 5.6 13.4h4.9l-1 7.6L17.4 10.6h-4.9z',
  sensors:
    'M12 12h.01M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M6 6a8.5 8.5 0 0 0 0 12M18 6a8.5 8.5 0 0 1 0 12',
  rocket:
    'M13.8 4.6c2.7-.6 5.4 2.1 4.8 4.8l-7.6 7.6-4.8-4.8zM6.2 12.2 3.4 15l5.4 5.4 2.8-2.8M14.6 9.4h.01M9.2 14.8 5 19',
  robot:
    'M8.4 9.4h7.2a2 2 0 0 1 2 2v4.8a2 2 0 0 1-2 2H8.4a2 2 0 0 1-2-2v-4.8a2 2 0 0 1 2-2zM12 5.4v4M10 13h.01M14 13h.01M9.4 18.2v2M14.6 18.2v2',
  chart: 'M4.5 19.2h15M7.5 19.2V11M12 19.2V5.4M16.5 19.2v-5.4',
  search: 'M11 5.2a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15.4 15.4 19.6 19.6',
  verified:
    'M12 3.6l2.3 1.6 2.8-.2.9 2.7 2.3 1.6-1 2.6 1 2.6-2.3 1.6-.9 2.7-2.8-.2L12 20.4l-2.3-1.6-2.8.2-.9-2.7-2.3-1.6 1-2.6-1-2.6 2.3-1.6.9-2.7 2.8.2zM9.2 12.4l2 2 3.8-3.8',
  wrench: 'M15.2 4.4a4.2 4.2 0 0 0 5.2 5.2l-9.6 9.6a1.7 1.7 0 0 1-2.4 0l-2.8-2.8a1.7 1.7 0 0 1 0-2.4zM10.4 9.6 14.4 13.6',
  award:
    'M12 4a4.8 4.8 0 1 0 0 9.6A4.8 4.8 0 0 0 12 4zM9.2 13.4 7.6 20l4.4-2 4.4 2-1.6-6.6',
  target: 'M12 4.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6zM12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zM12 11.6a.4.4 0 1 0 0 .8.4.4 0 0 0 0-.8z',
  terminal:
    'M4.6 6h14.8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4.6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM7.8 10.2l2.4 1.8-2.4 1.8M12.6 14.4h3.6',
  hub: 'M12 8.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM6 4.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM18 4.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM6 16.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM18 16.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM10.7 10.2 7.2 7.9M13.3 10.2l3.5-2.3M10.7 13.9l-3.5 2.4M13.3 13.9l3.5 2.4',
  forum:
    'M4.4 6.2h10.4a1 1 0 0 1 1 1v4.6a1 1 0 0 1-1 1H8.2L4.4 16zM16.6 9.2h2.6a1 1 0 0 1 1 1v4.6a1 1 0 0 1-1 1h-1v2.8l-3.4-2.8h-3',
  group:
    'M9.4 11.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.6 19c.6-2.6 2.8-4.1 5.8-4.1s5.2 1.5 5.8 4.1M16.4 6.1a3 3 0 0 1 0 5.6M17.6 15.2c1.8.6 2.9 1.9 3.3 3.8',
  chevronRight: 'M9.6 6.2 15.6 12l-6 5.8',
  location:
    'M12 4.4a5.6 5.6 0 0 1 5.6 5.6c0 4.1-5.6 10-5.6 10s-5.6-5.9-5.6-10A5.6 5.6 0 0 1 12 4.4zM12 12.4a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2z',
  mail: 'M4.2 6h15.6a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3.6 7.4 12 13l8.4-5.6',
  phone:
    'M6.2 4.2h2.9l1.5 3.9-2 1.5a10.4 10.4 0 0 0 5.4 5.4l1.5-2 3.9 1.5v2.9a2 2 0 0 1-2.1 2A13.4 13.4 0 0 1 4.2 6.3a2 2 0 0 1 2-2.1z',
  qr: 'M4.4 5h4.8v4.8H4.4zM14.8 5h4.8v4.8h-4.8zM4.4 14.2h4.8v4.8H4.4zM14 14.2h2.2V16.4H14zM17.8 14.2H20V16.4h-2.2zM14 18h2.2v2.2H14zM17.8 18H20v2.2h-2.2z',
  send: 'M5 12 19.6 4.8 13 19.6l-1.9-5.7zM11.1 13.9 19.6 4.8',
  checkCircle: 'M12 4.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6zM8.6 12.3l2.4 2.4 4.4-4.6',
  user: 'M12 12.2a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM5.2 20c.8-3 3.5-4.6 6.8-4.6s6 1.6 6.8 4.6',
  star: 'M12 4.4l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z',
  share: 'M12 15.2V4.4M8.6 7.8 12 4.4l3.4 3.4M5.2 13.2v6a1 1 0 0 0 1 1h11.6a1 1 0 0 0 1-1v-6',
  mic: 'M12 4.8a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 12 4.8zM7.2 11.2a4.8 4.8 0 0 0 9.6 0M12 16v3.2M9.6 19.2h4.8',
  headset:
    'M5.2 13.2v-1.2a6.8 6.8 0 0 1 13.6 0v1.2M5.2 13.2h2.4v5.2H6.2a1 1 0 0 1-1-1zM18.8 13.2h-2.4v5.2h1.4a1 1 0 0 0 1-1z',
  refresh: 'M19.2 12a7.2 7.2 0 1 1-2.1-5.1M19.2 4.6v4h-4',
  layers: 'M12 4.4 3.8 8.6 12 12.8l8.2-4.2zM3.8 12.8 12 17l8.2-4.2M3.8 16.6 12 20.8l8.2-4.2',
  clock: 'M12 4.6a7.4 7.4 0 1 0 0 14.8 7.4 7.4 0 0 0 0-14.8zM12 8.4V12l2.6 1.6',
  compass: 'M12 4.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6zM14.8 9.2l-1.6 4.4-4.4 1.6 1.6-4.4z',
};

/** 这些图标用填充渲染（播放三角、星星），其余统一线性描边。 */
const FILLED: ReadonlySet<IconName> = new Set<IconName>(['play', 'star']);

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, ...rest }: IconProps) {
  const filled = FILLED.has(name);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** 品牌标记：设计稿用的是 Google 图床上的 PNG，这里改为内联矢量图形。 */
export function BrandGlyph({ size = 34 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className="home-brand-glyph"
    >
      <defs>
        <linearGradient id="qituHomeBrandGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1e4fd9" />
          <stop offset="100%" stopColor="#0038b2" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#qituHomeBrandGradient)" />
      <path
        d="M13 15.5h14M13 20h9M13 24.5h11"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M27.5 24.2c1.4 0 2.5 1.1 2.5 2.5s-1.1 2.5-2.5 2.5-2.5-1.1-2.5-2.5 1.1-2.5 2.5-2.5z"
        fill="#6ffad0"
      />
    </svg>
  );
}
