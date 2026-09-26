'use client';

import { LogoutButton } from '@qitu/auth';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { childProfile } from './data';

const navigation = [
  { href: '/home', label: '首页', icon: '⌂' },
  { href: '/progress/projects', label: '学习进展', icon: '↗' },
  { href: '/messages', label: '消息与反馈', icon: '✉' },
] as const;

function pageHeading(pathname: string): { title: string; description: string } {
  if (pathname.startsWith('/progress')) {
    return { title: '学习进展', description: '查看项目过程、成长证据与授权作品' };
  }
  if (pathname.startsWith('/messages')) {
    return { title: '消息与反馈', description: '关注重要变化，并与班主任保持沟通' };
  }
  return { title: '晚上好，林女士', description: '小宇今天完成了一次专注的实践学习' };
}

export function ParentPortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const heading = pageHeading(pathname);

  return (
    <div className="parent-portal-shell">
      <aside className="parent-sidebar">
        <Link className="parent-brand" href="/home" aria-label="启途智学家长陪伴中心首页">
          <span className="parent-brand-mark" aria-hidden="true">
            启
          </span>
          <span>
            <strong>启途智学</strong>
            <small>家长陪伴中心</small>
          </span>
        </Link>

        <nav className="parent-primary-nav" aria-label="家长端主导航">
          {navigation.map((item) => {
            const active =
              item.href === '/home'
                ? pathname === '/' || pathname.startsWith('/home')
                : pathname.startsWith(item.href.split('/').slice(0, 2).join('/'));
            return (
              <Link key={item.href} href={item.href} className={active ? 'is-active' : undefined}>
                <span className="parent-nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span>{item.label}</span>
                {item.label === '消息与反馈' ? <span className="parent-nav-count">2</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="parent-sidebar-note">
          <span className="parent-sidebar-note-icon" aria-hidden="true">
            ?
          </span>
          <div>
            <strong>需要帮助？</strong>
            <span>联系班主任或平台支持</span>
          </div>
        </div>
      </aside>

      <div className="parent-workspace">
        <header className="parent-topbar">
          <div className="parent-page-heading">
            <h1>{heading.title}</h1>
            <p>{heading.description}</p>
          </div>
          <div className="parent-topbar-actions">
            <Link className="parent-notification-button" href="/messages" aria-label="查看通知">
              <span aria-hidden="true">✉</span>
              <i aria-label="2 条未读消息">2</i>
            </Link>
            <button className="parent-child-switcher" type="button" aria-label="切换孩子">
              <span className="parent-avatar">{childProfile.avatar}</span>
              <span>
                <strong>{childProfile.name}</strong>
                <small>{childProfile.grade}</small>
              </span>
              <span aria-hidden="true">⌄</span>
            </button>
            <LogoutButton redirectTo="/parent/login" />
          </div>
        </header>
        <main className="parent-page-content">{children}</main>
      </div>
    </div>
  );
}
