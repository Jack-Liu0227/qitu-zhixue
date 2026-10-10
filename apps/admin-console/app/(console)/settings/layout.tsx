'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
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
    group: '工作区',
    items: [
      { href: '/settings', label: '设置总览', icon: '⌂' },
      { href: '/settings/account', label: '账号设置', icon: '👤' },
    ],
  },
  {
    group: 'AI 核心',
    items: [
      { href: '/settings/assistants', label: '助手', icon: '🤖' },
      { href: '/settings/teams', label: '团队', icon: '👥' },
      { href: '/settings/model-providers', label: '模型', icon: '◈' },
      { href: '/settings/ai-runtime', label: 'AI 运行时', icon: '⌁' },
      { href: '/settings/skills', label: '技能', icon: 'ϟ' },
      { href: '/settings/tools', label: '工具', icon: '🧰' },
    ],
  },
  {
    group: '内容与数据',
    items: [
      { href: '/settings/knowledge', label: '知识库', icon: '▤' },
      { href: '/settings/templates', label: '模板库', icon: '▦' },
      { href: '/settings/database', label: '数据库', icon: '◫' },
    ],
  },
  {
    group: '应用',
    items: [
      { href: '/settings/appearance', label: '外观', icon: '◐' },
      { href: '/settings/ops', label: '沉浸运维', icon: '🌐' },
      { href: '/settings/system', label: '系统', icon: '⚙️' },
    ],
  },
  {
    group: '供应商',
    items: [
      { href: '/settings/dialogs', label: '已安装的对话', icon: '◌' },
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
  const [siderCollapsed, setSiderCollapsed] = useState(false);

  const isItemActive = (href: string) => {
    if (href === '/settings/assistants') {
      return internal === '/settings/assistants' || internal.startsWith('/settings/assistants/') || internal === '/settings/agents';
    }
    if (href === '/settings/teams') {
      return internal === '/settings/teams' || internal.startsWith('/settings/teams/');
    }
    if (href === '/settings') return internal === '/settings';
    return internal === href || internal.startsWith(`${href}/`);
  };

  return (
    <div className={`settings-shell ${siderCollapsed ? 'is-sider-collapsed' : ''}`}>
      <aside className={`settings-sider ${siderCollapsed ? 'is-collapsed' : ''}`} aria-label="设置导航">
        <div className="settings-sider-head">
          {!siderCollapsed && <span className="settings-sider-title">系统偏好设置</span>}
          <button
            type="button"
            className="settings-sider-toggle-btn"
            onClick={() => setSiderCollapsed((prev) => !prev)}
            title={siderCollapsed ? '展开导航' : '折叠导航'}
            aria-label={siderCollapsed ? '展开导航' : '折叠导航'}
          >
            {siderCollapsed ? '»' : '«'}
          </button>
        </div>
        <div className="settings-sider-scroll">
          {SETTINGS_NAV.map((grp) => (
            <div key={grp.group} className="settings-sider-section">
              {!siderCollapsed && <div className="settings-sider-group">{grp.group}</div>}
              {grp.items.map((item) => {
                const active = isItemActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`settings-sider-item ${active ? 'is-active' : ''}`}
                    title={siderCollapsed ? `${grp.group} · ${item.label}` : undefined}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className="settings-sider-icon" aria-hidden="true">{item.icon}</span>
                    {!siderCollapsed && <span className="settings-sider-label">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </aside>
      <main className="settings-main">{children}</main>
    </div>
  );
}
