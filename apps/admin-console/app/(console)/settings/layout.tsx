'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import './settings-aion.css';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const SETTINGS_NAV: NavGroup[] = [
  {
    group: '账户',
    items: [
      { href: '/settings/account', label: '账号设置', icon: '👤' },
    ],
  },
  {
    group: 'AI 核心',
    items: [
      { href: '/settings/assistants', label: 'Agents', icon: '🤖' },
      { href: '/settings/models', label: '模型', icon: '☁️' },
      { href: '/settings/teams', label: '团队', icon: '👥' },
      { href: '/settings/skills', label: '技能', icon: '⚡' },
      { href: '/settings/tools', label: '工具', icon: '🧰' },
    ],
  },
  {
    group: '应用',
    items: [
      { href: '/settings/appearance', label: '外观', icon: '🖥️' },
      { href: '/settings/ops', label: '沉浸运维', icon: '🌐' },
      { href: '/settings/system', label: '系统', icon: '⚙️' },
    ],
  },
  {
    group: '供应商',
    items: [
      { href: '/settings/dialogs', label: '已安装的对话', icon: '💬' },
    ],
  },
  {
    group: '其他',
    items: [
      { href: '/settings/about', label: '关于', icon: 'ⓘ' },
    ],
  },
];

function toInternal(pathname: string): string {
  if (pathname === '/admin') return '/';
  return pathname.startsWith('/admin/') ? pathname.slice('/admin'.length) : pathname;
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const internal = toInternal(pathname);

  const isItemActive = (href: string) => {
    if (href === '/settings/assistants') {
      return internal === '/settings/assistants' || internal.startsWith('/settings/assistants/') || internal === '/settings/agents';
    }
    if (href === '/settings/models') {
      return internal === '/settings/models' || internal.startsWith('/settings/models/') || internal === '/settings/model-providers' || internal === '/settings';
    }
    return internal === href || internal.startsWith(`${href}/`);
  };

  return (
    <div className="settings-shell">
      <aside className="settings-sider" aria-label="设置导航">
        {SETTINGS_NAV.map((grp) => (
          <div key={grp.group}>
            <div className="settings-sider-group">{grp.group}</div>
            {grp.items.map((item) => {
              const active = isItemActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`settings-sider-item ${active ? 'is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="settings-sider-icon" aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </aside>
      <main className="settings-main">{children}</main>
    </div>
  );
}
