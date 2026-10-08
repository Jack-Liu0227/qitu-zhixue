'use client';

import { LogoutButton, useCurrentUser } from '@qitu/auth';
import { BrandMark } from '@qitu/ui';
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
    let cancelled = false;
    teacherApi
      .interventions()
      .then((response) => {
        if (!cancelled) setPendingCount(response.data.totals.open);
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
  const avatarInitial = user?.displayName.trim().charAt(0) || '—';

  return (
    <div className="qtx-app">
      <aside className="qtx-sidebar">
        <div>
          <Link href="/dashboard" className="qtx-brand">
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
              const Icon = item.icon;
              const showBadge =
                item.badgeKey === 'openInterventions' &&
                pendingCount !== null &&
                pendingCount > 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`qtx-nav-item${isActive(item.href) ? ' active' : ''}`}
                >
                  <Icon size={19} />
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
          <div className="qtx-user" aria-busy={!user}>
            {user ? (
              <>
                <span className="qtx-avatar">{avatarInitial}</span>
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
          {/*
            通知入口没有对应的后端数据源，这里不摆放一个点了没反应的铃铛；
            真正有数据时再补入口，避免制造假的未读红点。
          */}
          <PreferencesMenu />
          <LogoutButton />
        </header>
        <main className="qtx-content">{children}</main>
      </div>
    </div>
  );
}
