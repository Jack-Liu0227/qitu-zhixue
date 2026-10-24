import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { PRODUCT_NAME, colors } from '@qitu/design-tokens';
import { BrandMark } from './brand';
import { NavigationArtwork } from './navigation-artwork';
import { RobotMascot } from './assistant';
import { SidebarResizeHandle } from './sidebar-resize';
export { RobotMascot } from './assistant';

export interface NavItem {
  href: string;
  label: string;
  icon?: ReactNode;
}

/**
 * 导航链接渲染器。
 *
 * `NavSidebar` 默认渲染普通 `<a href>`，那会让每次点击都变成整页刷新：
 * App Router 的 `layout` 会被重新挂载，`AuthGuard` 于是每次切换页面都重新
 * 校验一次登录态，界面会闪一下「正在验证登录状态…」。
 *
 * 各应用可以传入自己的 `next/link` 渲染器改成客户端跳转，layout 与登录缓存
 * 都得以保留。注意 `next/link` 会**自动补 basePath**，所以传进来的 `href`
 * 必须是 basePath 相对路径（例如 `/today`，而不是 `/student/today`）。
 */
export type NavLinkRenderer = (props: {
  href: string;
  className: string;
  /** 收起状态下的悬浮提示（展开时省略）。 */
  title?: string;
  /** 收起状态下兜底的无障碍名称（标签被 `display:none` 隐藏后仍可朗读）。 */
  ariaLabel?: string;
  children: ReactNode;
}) => ReactNode;

const defaultNavLink: NavLinkRenderer = ({ href, className, title, ariaLabel, children }) => (
  <a href={href} className={className} title={title} aria-label={ariaLabel}>
    {children}
  </a>
);

const NAV_ID = 'qitu-sidebar-nav';

/**
 * 学生端统一外壳：左侧固定导航 + 顶部横幅区 + 内容区。
 *
 * 导航顺序由调用方传入。首期冻结的五项为
 * 今天 / 灵感空间 / AI搭档 / 我的项目 / 作品展厅；
 * 2026-09-26 起追加第六项「成长轨迹」（见 ADR 0004），前五项的名称与相对顺序不变。
 *
 * 本组件不硬编码项数与文案：加/减导航项只改调用方。
 */
export function StudentShell({
  brandName,
  navItems,
  activeHref,
  header,
  children,
  contentKey,
  bannerSlot,
  renderLink,
  navCollapsed,
  onToggleNav,
  className = '',
}: {
  brandName?: string;
  navItems: NavItem[];
  activeHref: string;
  header: ReactNode;
  children: ReactNode;
  /**
   * 内容区的重挂载键：调用方传入当前路由（如 `/today`）即可让统一页面转场
   * 在客户端跳转时重新播放。不传时只在首次挂载播放一次。
   */
  contentKey?: string;
  bannerSlot?: ReactNode;
  /** 见 `NavLinkRenderer`：传入后导航改为客户端跳转。 */
  renderLink?: NavLinkRenderer;
  /** 受控的收起状态；由外壳自己持久化（见 student-shell.tsx）。 */
  navCollapsed?: boolean;
  /** 传入即显示收起 / 展开按钮。 */
  onToggleNav?: () => void;
  className?: string;
}) {
  return (
    <div className={`qitu-student-shell ${className}`.trim()}>
      <NavSidebar
        brandName={brandName}
        items={navItems}
        activeHref={activeHref}
        renderLink={renderLink}
        collapsed={navCollapsed}
        onToggleCollapse={onToggleNav}
      />
      <div className="qitu-student-main">
        {/* bannerSlot 是真正的插槽：传入即整体替换 header（如工作台用面包屑替换问候语）。 */}
        <div className="qitu-student-banner-slot">{bannerSlot !== undefined ? bannerSlot : header}</div>
        <main className="qitu-student-content qitu-page-transition" key={contentKey}>
          {children}
        </main>
      </div>
    </div>
  );
}

export function NavSidebar({
  brandName,
  tagline,
  items,
  activeHref,
  renderLink = defaultNavLink,
  collapsed = false,
  onToggleCollapse,
}: {
  brandName?: string;
  tagline?: string;
  items: NavItem[];
  activeHref: string;
  renderLink?: NavLinkRenderer;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const brand = brandName ?? PRODUCT_NAME;
  return (
    <>
      {!collapsed && onToggleCollapse ? (
        <div
          className="qitu-sidebar-mobile-backdrop"
          onClick={onToggleCollapse}
          aria-hidden="true"
        />
      ) : null}
      <aside className={collapsed ? 'qitu-sidebar is-collapsed' : 'qitu-sidebar is-expanded'}>
        <SidebarResizeHandle disabled={collapsed} />
        <div className="qitu-sidebar-brand">
        <span className="qitu-sidebar-logo">
          <BrandMark size={40} decorative />
        </span>
        <div className="qitu-sidebar-brand-text">
          <strong className="qitu-sidebar-name">{brand}</strong>
          {tagline ? <span className="qitu-sidebar-tagline">{tagline}</span> : null}
        </div>
      </div>
      <nav className="qitu-sidebar-nav" id={NAV_ID} aria-label="主导航">
        {items.map((item) => (
          <Fragment key={item.href}>
            {renderLink({
              href: item.href,
              className: item.href === activeHref ? 'qitu-nav-item is-active' : 'qitu-nav-item',
              title: collapsed ? item.label : undefined,
              ariaLabel: collapsed ? item.label : undefined,
              children: (
                <>
                  <span className="qitu-nav-icon"><NavigationArtwork href={item.href} /></span>
                  <span className="qitu-nav-label">{item.label}</span>
                </>
              ),
            })}
          </Fragment>
        ))}
      </nav>
      {onToggleCollapse ? (
        <button
          type="button"
          className="qitu-sidebar-toggle"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-controls={NAV_ID}
          title={collapsed ? '展开导航' : '收起导航'}
        >
          <span className="qitu-sidebar-toggle-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 5.5 8.5 12l6.5 6.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="qitu-sidebar-toggle-label">收起</span>
        </button>
      ) : null}
    </aside>
  </>
);
}

export function GreetingBanner({
  studentName,
  message,
  mascot,
}: {
  studentName: string;
  message: string;
  mascot?: ReactNode;
}) {
  return (
    <section className="qitu-greeting-banner">
      <div className="qitu-greeting-text">
        <p className="qitu-greeting-hello">你好，{studentName}</p>
        <p className="qitu-greeting-message">{message}</p>
      </div>
      <div className="qitu-greeting-mascot">{mascot ?? <RobotMascot mood="happy" />}</div>
    </section>
  );
}

export function BreadcrumbBar({
  items,
  renderLink = defaultNavLink,
}: {
  items: { label: string; href?: string }[];
  /** 传入 `next/link` 渲染器即可避免面包屑跳转触发整页刷新。 */
  renderLink?: NavLinkRenderer;
}) {
  return (
    <nav className="qitu-breadcrumb" aria-label="面包屑">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={`${item.label}-${index}`} className="qitu-breadcrumb-item">
            {index > 0 ? (
              <span className="qitu-breadcrumb-sep" aria-hidden="true">
                /
              </span>
            ) : null}
            {isLast || !item.href ? (
              <span className="qitu-breadcrumb-current">{item.label}</span>
            ) : (
              renderLink({ href: item.href, className: '', children: item.label })
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function HandwrittenNote({
  children,
  rotate = -3,
}: {
  children: ReactNode;
  rotate?: number;
}) {
  return (
    <span
      className="qitu-handwritten"
      style={{ transform: `rotate(${rotate}deg)`, color: colors.attention } as CSSProperties}
    >
      {children}
    </span>
  );
}
