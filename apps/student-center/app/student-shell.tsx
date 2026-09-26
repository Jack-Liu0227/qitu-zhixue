'use client';

import * as Auth from '@qitu/auth';
import { GreetingBanner, StudentShell, type NavItem, type NavLinkRenderer } from '@qitu/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

/**
 * `next.config.ts` sets `basePath: '/student'`. The app directory therefore
 * does NOT repeat the prefix: `app/today/page.tsx` is served at
 * `/student/today`.
 *
 * `next/link` **prepends the basePath automatically**, so the `href` handed to
 * `Link` must stay basePath-relative (`/today`). `activeHref` is the full
 * external path, because that is what the shell compares against the value it
 * derived from the live pathname.
 */
const BASE_PATH = '/student';

/**
 * The frozen navigation — now six items, in this order.
 *
 * 成长轨迹 was promoted to a first-class nav item (peer of AI搭档) by the
 * 2026-09-26 product decision: the growth record is a destination students
 * return to on its own, not a detail page reached sideways from 今天.
 *
 * The original five keep their exact relative order; 成长轨迹 is appended, so
 * the frozen sequence and existing muscle memory are both preserved.
 *
 * `path` is the basePath-relative route used for matching; `href` is the full
 * external path handed to the shell.
 */
const NAV_SPECS = [
  { path: '/today', label: '今天' },
  { path: '/inspiration', label: '灵感空间' },
  { path: '/tutor', label: 'AI搭档' },
  { path: '/projects', label: '我的项目' },
  { path: '/works', label: '作品展厅' },
  { path: '/growth', label: '成长轨迹' },
] as const;

/** Pure presentational glyphs. `@qitu/ui` may add a shared icon set later; the
 *  shell must not depend on exports that do not exist yet, so these stay local
 *  and decorative (`aria-hidden`). */
function TodayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.25" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.75v2.5M12 18.75v2.5M2.75 12h2.5M18.75 12h2.5M5.46 5.46l1.77 1.77M16.77 16.77l1.77 1.77M18.54 5.46l-1.77 1.77M7.23 16.77l-1.77 1.77"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function InspirationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 18h6M10 21h4M12 3.5a5.5 5.5 0 0 0-3.2 9.9c.5.4.7.9.7 1.4V16h5v-1.2c0-.5.2-1 .7-1.4A5.5 5.5 0 0 0 12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9.75 8.5a2.6 2.6 0 0 1 2.25-2.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TutorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="7.5" width="16" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9.2" cy="12.6" r="1.2" fill="currentColor" />
      <circle cx="14.8" cy="12.6" r="1.2" fill="currentColor" />
      <path d="M9.2 16.2h5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 7.5V5.8M9.5 3.8h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ProjectsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5A2.5 2.5 0 0 1 6 6h4.25a2 2 0 0 1 1.7.95l.8 1.1H18a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M3.5 11.5h17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function WorksIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M16.75 13v4.5m0 0V13a2.25 2.25 0 0 1 2.25-2.25H21m-4.25 6.75L14.5 19.75l2.25-2.25Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GrowthIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.25 4.5v15h15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M7.75 15.75l3.5-3.75 2.9 2.35 4.6-5.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18.75" cy="9.25" r="1.65" fill="currentColor" />
    </svg>
  );
}

const NAV_ICONS: Record<(typeof NAV_SPECS)[number]['path'], ReactNode> = {
  '/today': <TodayIcon />,
  '/inspiration': <InspirationIcon />,
  '/tutor': <TutorIcon />,
  '/projects': <ProjectsIcon />,
  '/works': <WorksIcon />,
  '/growth': <GrowthIcon />,
};

const NAV_ITEMS: NavItem[] = NAV_SPECS.map((spec) => ({
  href: `${BASE_PATH}${spec.path}`,
  label: spec.label,
  icon: NAV_ICONS[spec.path],
}));

/**
 * 导航使用的相对路径（`next/link` 会自己补 basePath）。
 */
const NAV_LINK_HREFS: Record<string, string> = Object.fromEntries(
  NAV_SPECS.map((spec) => [`${BASE_PATH}${spec.path}`, spec.path]),
);

/**
 * 客户端跳转渲染器。
 *
 * 这条就是把「每次切页都重新验证登录态」修掉的关键：用 `<Link>` 之后切换页面
 * 只做客户端导航，`app/layout.tsx` 不会重新挂载，`AuthGuard` 与它缓存的会话
 * 一直保留，不会再闪过「正在验证登录状态…」。
 *
 * 断网或未登录时 Next 会自己回退成整页导航，所以不需要额外分支。
 */
const renderNavLink: NavLinkRenderer = ({ href, className, title, ariaLabel, children }) => (
  <Link
    href={NAV_LINK_HREFS[href] ?? href}
    className={className}
    title={title}
    aria-label={ariaLabel}
  >
    {children}
  </Link>
);

const NAV_COLLAPSED_KEY = 'qitu.student.nav-collapsed';

/**
 * `usePathname()` returns the basePath-inclusive path in some Next versions and
 * the bare path in others. Normalising here keeps the active item correct
 * either way instead of depending on that detail.
 */
function toInternalPath(pathname: string): string {
  if (pathname === BASE_PATH || pathname === '') {
    return '/';
  }
  return pathname.startsWith(`${BASE_PATH}/`) ? pathname.slice(BASE_PATH.length) : pathname;
}

type CachedUser = { id?: string; email?: string; displayName?: string; role?: string };

/**
 * Best-effort student name for the greeting banner.
 *
 * `readCachedUser()` lands in `@qitu/auth` behind the same wave; until then the
 * import is exercised defensively so the shell never fails to render, and the
 * fallback stays visible on logout / no-cache / privacy mode. It must only be
 * called in a client component (the real implementation reads sessionStorage).
 */
function readStudentName(): string | null {
  try {
    const auth = Auth as unknown as { readCachedUser?: () => CachedUser | null };
    if (typeof auth.readCachedUser !== 'function') return null;
    const user = auth.readCachedUser();
    if (!user) return null;
    const name = user.displayName?.trim();
    return name && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

function StudentGreetingBanner() {
  const name = readStudentName();
  return (
    <GreetingBanner
      studentName={name ?? '同学'}
      message={name ? '准备好开始今天的学习了吗？' : '欢迎来到启途智学，开始今天的学习吧。'}
    />
  );
}

/**
 * Client shell host: `StudentShell` needs `activeHref`, which is derived from
 * the live pathname, so the server `layout.tsx` renders this thin client
 * component. It never adds, renames, reorders or omits a nav item.
 */
export function StudentShellHost({ children }: { children: ReactNode }) {
  const internalPath = toInternalPath(usePathname() ?? '');
  const active = NAV_SPECS.find(
    (spec) => internalPath === spec.path || internalPath.startsWith(`${spec.path}/`),
  );

  // 收起状态只存在浏览器里。首屏渲染始终是「展开」，挂载后再同步用户的选择，
  // 这样服务端渲染与客户端首次渲染完全一致（避免 hydration 不匹配）。
  const [navCollapsed, setNavCollapsed] = useState(false);

  useEffect(() => {
    try {
      setNavCollapsed(window.localStorage.getItem(NAV_COLLAPSED_KEY) === '1');
    } catch {
      // 无痕模式等场景下读不到，保持展开即可。
    }
  }, []);

  const toggleNav = useCallback(() => {
    setNavCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(NAV_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // 忽略存储失败：本次会话内仍然生效。
      }
      return next;
    });
  }, []);

  return (
    <StudentShell
      navItems={NAV_ITEMS}
      activeHref={active ? `${BASE_PATH}${active.path}` : ''}
      header={<StudentGreetingBanner />}
      renderLink={renderNavLink}
      navCollapsed={navCollapsed}
      onToggleNav={toggleNav}
    >
      {children}
    </StudentShell>
  );
}
