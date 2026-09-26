'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  BellIcon,
  ChartIcon,
  ChevronDownIcon,
  HomeIcon,
  SettingsIcon,
  SparklesIcon,
  TicketIcon,
  UsersIcon,
} from './icons';

const NAV_ITEMS = [
  { href: '/dashboard', label: '工作台', icon: HomeIcon },
  { href: '/students', label: '学生管理', icon: UsersIcon },
  { href: '/issues', label: '问题处理', icon: TicketIcon, badge: 12 },
  { href: '/statistics', label: '数据统计', icon: ChartIcon },
  { href: '/settings', label: '系统设置', icon: SettingsIcon },
];

function normalizePath(pathname: string) {
  const withoutBase = pathname.replace(/^\/teacher(?=\/|$)/, '');
  return withoutBase === '' ? '/' : withoutBase;
}

export function TeacherShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const path = normalizePath(pathname);

  const isActive = (href: string) =>
    href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);

  return (
    <div className="qtx-app">
      <aside className="qtx-sidebar">
        <div>
          <Link href="/dashboard" className="qtx-brand">
            <span className="qtx-brand-logo">
              <SparklesIcon size={22} />
            </span>
            <span>
              <h1>启途智学</h1>
              <p>AI 伴学系统</p>
            </span>
          </Link>

          <nav className="qtx-nav">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`qtx-nav-item${isActive(item.href) ? ' active' : ''}`}
                >
                  <Icon size={19} />
                  <span>{item.label}</span>
                  {item.badge ? <em className="qtx-nav-badge">{item.badge}</em> : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="qtx-sidebar-bottom">
          <strong>⚠ 数据安全提示</strong>
          <br />
          所有操作均被记录审计，
          <br />
          请勿外泄学生敏感信息。
        </div>
      </aside>

      <div className="qtx-main">
        <header className="qtx-topbar">
          <button className="qtx-bell" aria-label="通知" type="button">
            <BellIcon size={18} />
            <span className="qtx-bell-dot" />
          </button>
          <div className="qtx-user">
            <span className="qtx-avatar">陈</span>
            <span>
              <div className="qtx-user-name">陈老师</div>
              <div className="qtx-user-role">班主任</div>
            </span>
            <ChevronDownIcon size={16} />
          </div>
          <button
            className="qtx-logout"
            type="button"
            onClick={async () => {
              await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
              window.location.assign('/');
            }}
          >
            退出登录
          </button>
        </header>
        <main className="qtx-content">{children}</main>
      </div>
    </div>
  );
}
