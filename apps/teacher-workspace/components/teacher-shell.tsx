'use client';

import { LogoutButton, useCurrentUser } from '@qitu/auth';
import { Avatar, BrandMark, NavigationArtwork, SidebarResizeHandle } from '@qitu/ui';
import { PreferencesMenu } from '@qitu/ui/preferences';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ChartIcon,
  HomeIcon,
  TicketIcon,
  UsersIcon,
} from './icons';
import { teacherApi } from '../lib/teacherApi';
import { EyecareButton } from './eyecare-button';
import { getStoredEyecare } from '../lib/eyecare';

/**
 * 冻结的班主任端五项导航。`badgeKey` 只声明哪一个导航项需要显示真实计数，
 * 计数本身来自服务端，绝不写死。
 */
const NAV_ITEMS = [
  { href: '/dashboard', label: '工作台', icon: HomeIcon },
  { href: '/students', label: '学生管理', icon: UsersIcon },
  { href: '/issues', label: '问题处理', icon: TicketIcon, badgeKey: 'openInterventions' as const },
  { href: '/statistics', label: '数据统计', icon: ChartIcon },
];

const ROLE_LABELS: Record<string, string> = {
  teacher: '班主任',
  admin: '管理员',
  student: '学生',
  parent: '家长',
  support: '支持',
};

function normalizePath(pathname: string) {
  const withoutBase = pathname.replace(/^\/teacher(?=\/|$)/, '');
  return withoutBase === '' ? '/' : withoutBase;
}

export function TeacherShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const path = normalizePath(pathname);
  const user = useCurrentUser();

  // 「待处理问题」角标只反映服务端真实计数：加载中或请求失败时保持为 null，
  // 由界面隐藏角标，而不是显示一个编造的数字。
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    const active = getStoredEyecare();
    if (active) {
      document.documentElement.setAttribute('data-qitu-eyecare', 'true');
    } else {
      document.documentElement.removeAttribute('data-qitu-eyecare');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    teacherApi
      .interventions()
      .then((response) => {
        if (!cancelled) setPendingCount(response.data.signalsAvailable === false ? null : response.data.totals.open);
      })
      .catch(() => {
        if (!cancelled) setPendingCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isActive = (href: string) =>
    href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);

  const roleLabel = user ? (ROLE_LABELS[user.role] ?? user.role) : null;
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <div className="qtx-app">
      {isMobileOpen ? (
        <div
          className="qtx-sidebar-backdrop"
          onClick={() => setIsMobileOpen(false)}
          aria-hidden="true"
        />
      ) : null}
      <aside className={`qtx-sidebar ${isMobileOpen ? 'is-mobile-open' : 'is-mobile-closed'}`}>
        <SidebarResizeHandle />
        <div>
          <Link href="/dashboard" className="qtx-brand" onClick={() => setIsMobileOpen(false)}>
            <span className="qtx-brand-logo">
              <BrandMark size={40} decorative />
            </span>
            <span>
              <h1>启途智学</h1>
              <p>班主任工作台</p>
            </span>
          </Link>

          <nav className="qtx-nav">
            {NAV_ITEMS.map((item) => {
              const showBadge =
                item.badgeKey === 'openInterventions' &&
                pendingCount !== null &&
                pendingCount > 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`qtx-nav-item${isActive(item.href) ? ' active' : ''}`}
                  onClick={() => setIsMobileOpen(false)}
                >
                  <NavigationArtwork href={item.href} size={24} />
                  <span>{item.label}</span>
                  {showBadge ? <em className="qtx-nav-badge">{pendingCount}</em> : null}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="qtx-mobile-menu-btn"
              onClick={() => setIsMobileOpen((prev) => !prev)}
              aria-label="打开导航菜单"
              title="导航菜单"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <div className="qtx-user" aria-busy={!user}>
            {user ? (
              <>
                <span className="qtx-avatar" aria-hidden="true"><Avatar name={user.displayName} /></span>
                <span>
                  <div className="qtx-user-name">{user.displayName}</div>
                  <div className="qtx-user-role">{roleLabel}</div>
                </span>
              </>
            ) : (
              <>
                <span className="qtx-avatar qtx-avatar-placeholder" aria-hidden="true" />
                <span>
                  <div className="qtx-user-name">—</div>
                  <div className="qtx-user-role">身份加载中</div>
                </span>
              </>
            )}
            </div>
          </div>
          {/*
            通知入口没有对应的后端数据源，这里不摆放一个点了没反应的铃铛；
            真正有数据时再补入口，避免制造假的未读红点。
          */}
          <EyecareButton />
          <PreferencesMenu />
          <LogoutButton />
        </header>
        <main className="qtx-content">{children}</main>
      </div>
    </div>
  );
}
