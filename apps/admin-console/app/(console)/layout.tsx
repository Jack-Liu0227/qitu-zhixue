'use client';

import { AuthGuard, LogoutButton, useCurrentUser } from '@qitu/auth';
import { Avatar, NavSidebar, type NavLinkRenderer } from '@qitu/ui';
import { PreferencesMenu } from '@qitu/ui/preferences';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * `next.config.ts` 设置了 `basePath: '/admin'`，所以 `app/(console)/models/page.tsx`
 * 实际服务于 `/admin/models`。`next/link` 会自动补 basePath，因此传给 `Link`
 * 的 `href` 必须是 basePath 相对路径（例如 `/models`，而不是 `/admin/models`）。
 */
const BASE_PATH = '/admin';

/** 登录页读取的「被 AuthGuard 带离」原因，用于把「非管理员被拒」明确展示出来。 */
const DENIED_KEY = 'qitu.admin.auth-denied';

const NAV_SPECS = [
  { path: '/', label: '治理概览' },
  // 管理员默认只进入聚合与治理视图（ADR 0008 / 产品文档 7.0）。
  // 「学生端数据 / 教师端数据」属于班主任日常处理，不再作为管理端默认导航；
  // 个别学生详情需要显式授权，入口与后端一起收紧（后端 fail closed）。
  { path: '/students/statistics', label: '学生数据统计' },
  { path: '/relationships', label: '关系绑定' },
  { path: '/settings', label: '模型与设置' },
] as const;

const NAV_ITEMS = NAV_SPECS.map((spec) => ({
  href: spec.path === '/' ? BASE_PATH : `${BASE_PATH}${spec.path}`,
  label: spec.label,
}));

/** NavSidebar 比较的是完整外部路径；next/link 需要的是 basePath 相对路径。 */
function toLinkHref(href: string): string {
  if (href === BASE_PATH) return '/';
  return href.startsWith(`${BASE_PATH}/`) ? href.slice(BASE_PATH.length) : href;
}

const renderNavLink: NavLinkRenderer = ({ href, className, title, ariaLabel, children }) => (
  <Link href={toLinkHref(href)} className={className} title={title} aria-label={ariaLabel}>
    {children}
  </Link>
);

/**
 * `usePathname()` 在某些 Next 版本返回含 basePath 的路径，某些版本返回裸路径。
 * 统一归一化成内部路径后再匹配激活项，避免依赖版本细节。
 */
function toInternalPath(pathname: string): string {
  if (pathname === BASE_PATH || pathname === '') return '/';
  return pathname.startsWith(`${BASE_PATH}/`) ? pathname.slice(BASE_PATH.length) : pathname;
}

export default function ConsoleLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname() ?? '';
  const user = useCurrentUser();
  const internalPath = toInternalPath(pathname);
  const active = NAV_SPECS.find((spec) =>
    spec.path === '/'
      ? internalPath === '/'
      : internalPath === spec.path || internalPath.startsWith(`${spec.path}/`),
  );
  const activeHref = active
    ? active.path === '/'
      ? BASE_PATH
      : `${BASE_PATH}${active.path}`
    : '';
  const pageTitle = active?.label ?? '平台管理后台';

  return (
    <AuthGuard
      expectedRole="admin"
      redirectTo="/admin/login"
      onUnauthenticated={(reason) => {
        // 非管理员 / 登录过期 / 未登录都会被带往登录页。把原因写进 sessionStorage，
        // 登录页会明确展示「被拒绝」而不是静默跳转。
        try {
          window.sessionStorage.setItem(DENIED_KEY, reason);
        } catch {
          // 无痕模式等场景下写不进去也不影响守卫流程。
        }
      }}
    >
      <div className="admin-console-shell">
        <NavSidebar
          brandName="启途智学"
          tagline="平台管理后台"
          items={NAV_ITEMS}
          activeHref={activeHref}
          renderLink={renderNavLink}
        />
        <div className="admin-console-main">
          <header className="admin-console-topbar">
            <div className="admin-console-heading">
              <p className="eyebrow">ADMIN CONSOLE</p>
              <h2 className="admin-console-page-title">{pageTitle}</h2>
            </div>
            <div className="admin-console-identity">
              <Avatar name={user?.displayName ?? user?.email ?? '管理员'} size="sm" />
              <span className="admin-console-identity-name">
                {user?.displayName ?? user?.email ?? '管理员'}
              </span>
              <PreferencesMenu />
              <LogoutButton redirectTo="/" />
            </div>
          </header>
          {/* key 绑定内部路径：客户端跳转时内容区重挂载，统一页面转场得以重播。 */}
          <main className="admin-console-content qitu-page-transition" key={internalPath}>
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
