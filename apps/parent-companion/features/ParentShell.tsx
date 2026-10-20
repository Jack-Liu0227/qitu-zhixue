'use client';
import { AuthGuard, LogoutButton, useCurrentUser } from '@qitu/auth';
import { Avatar, NavSidebar, useResponsiveSidebar, type NavLinkRenderer } from '@qitu/ui';
import { PreferencesMenu } from '@qitu/ui/preferences';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { EyecareButton } from '../components/EyecareButton';
import { getStoredEyecare } from '../lib/eyecare';
import { ParentFeedbackWidget } from './ParentFeedbackWidget';
const BASE_PATH = '/parent';
const specs = [
  { path: '/', label: '首页', icon: '⌂' },
  { path: '/progress', label: '学习进展', icon: '▥' },
  { path: '/messages', label: '消息与反馈', icon: '▣' },
] as const;
const items = specs.map((s) => ({
  href: `${BASE_PATH}${s.path === '/' ? '' : s.path}`,
  label: s.label,
  icon: <span aria-hidden="true">{s.icon}</span>,
}));
function internal(path: string) {
  return path === BASE_PATH || path === ''
    ? '/'
    : path.startsWith(`${BASE_PATH}/`)
      ? path.slice(BASE_PATH.length)
      : path;
}
const renderLink: NavLinkRenderer = ({ href, className, title, ariaLabel, children }) => (
  <Link
    href={href === BASE_PATH ? '/' : href.slice(BASE_PATH.length)}
    className={className}
    title={title}
    aria-label={ariaLabel}
  >
    {children}
  </Link>
);
export function ParentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const active = specs.find((s) => {
    const p = internal(pathname);
    return s.path === '/' ? p === '/' : p === s.path || p.startsWith(`${s.path}/`);
  });
  const user = useCurrentUser();
  const { collapsed, toggle } = useResponsiveSidebar(pathname);

  useEffect(() => {
    const active = getStoredEyecare();
    if (active) {
      document.documentElement.setAttribute('data-qitu-eyecare', 'true');
    }
  }, []);

  return (
    <AuthGuard expectedRole="parent" redirectTo="/parent/login">
      <div className="parent-shell">
        <NavSidebar
          brandName="启途智学"
          tagline="家长陪伴中心"
          items={items}
          activeHref={active ? `${BASE_PATH}${active.path === '/' ? '' : active.path}` : ''}
          renderLink={renderLink}
          collapsed={collapsed}
          onToggleCollapse={toggle}
        />
        <div className="parent-main">
          <header className="parent-topbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                className="qitu-mobile-menu-btn"
                onClick={toggle}
                aria-label={collapsed ? '打开导航菜单' : '关闭导航菜单'}
                aria-expanded={!collapsed}
                title="导航菜单"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <div>
                <p className="parent-eyebrow">PARENT COMPANION</p>
                <h1>{active?.label ?? '家长陪伴中心'}</h1>
              </div>
            </div>
            <div className="parent-identity">
              <Avatar name={user?.displayName ?? user?.email ?? '演示家长'} size="sm" />
              <span>{user?.displayName ?? '演示家长'}</span>
              <button
                type="button"
                className="parent-contact-button qitu-button qitu-button-ghost"
                aria-haspopup="dialog"
                onClick={() => window.dispatchEvent(new CustomEvent('qitu:open-parent-feedback'))}
              >
                联系班主任
              </button>
              <EyecareButton />
              <PreferencesMenu />
              <LogoutButton redirectTo="/" />
            </div>
          </header>
          {/* key 绑定内部路径：客户端跳转时内容区重挂载，统一页面转场得以重播。 */}
          <main className="parent-content qitu-page-transition" key={internal(pathname)}>
            {children}
          </main>
        </div>
        <ParentFeedbackWidget />
      </div>
    </AuthGuard>
  );
}
