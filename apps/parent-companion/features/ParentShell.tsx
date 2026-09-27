'use client';
import { AuthGuard, LogoutButton, useCurrentUser } from '@qitu/auth';
import { Avatar, NavSidebar, type NavLinkRenderer } from '@qitu/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
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
  return (
    <AuthGuard expectedRole="parent" redirectTo="/parent/login">
      <div className="parent-shell">
        <NavSidebar
          brandName="启途智学"
          tagline="家长陪伴中心"
          items={items}
          activeHref={active ? `${BASE_PATH}${active.path === '/' ? '' : active.path}` : ''}
          renderLink={renderLink}
        />
        <div className="parent-main">
          <header className="parent-topbar">
            <div>
              <p className="parent-eyebrow">PARENT COMPANION</p>
              <h1>{active?.label ?? '家长陪伴中心'}</h1>
            </div>
            <div className="parent-identity">
              <Avatar name={user?.displayName ?? user?.email ?? '演示家长'} size="sm" />
              <span>{user?.displayName ?? '演示家长'}</span>
              <LogoutButton redirectTo="/" />
            </div>
          </header>
          <main className="parent-content">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
