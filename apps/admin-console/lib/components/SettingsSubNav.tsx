'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * 设置区的子导航。
 *
 * `next.config.ts` 设置了 `basePath: '/admin'`，`next/link` 会自动补 basePath，
 * 因此这里的 `href` 是 basePath 相对路径（例如 `/settings/models`）。
 */

const ITEMS = [
  { href: '/settings', label: '设置总览', exact: true },
  { href: '/settings/model-providers', label: '模型供应商', exact: false },
  { href: '/settings/model-usages', label: '模型用途绑定', exact: false },
] as const;

/** 与 `(console)/layout.tsx` 一致的路径归一化，避免依赖 usePathname 是否带 basePath。 */
function toInternal(pathname: string): string {
  if (pathname === '/admin') return '/';
  return pathname.startsWith('/admin/') ? pathname.slice('/admin'.length) : pathname;
}

export function SettingsSubNav() {
  const pathname = usePathname() ?? '';
  const internal = toInternal(pathname);

  return (
    <nav className="admin-settings-subnav" aria-label="设置子导航">
      {ITEMS.map((item) => {
        const active = item.exact ? internal === item.href : internal.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? 'admin-settings-subnav-item is-active' : 'admin-settings-subnav-item'}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
