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
    group: 'AI 核心架构',
    items: [
      { href: '/settings/assistants', label: 'AI 助手', icon: '🤖' },
      { href: '/settings/feishu', label: '飞书机器人', icon: '🪽' },
      { href: '/settings/teams', label: '协作团队', icon: '👥' },
      { href: '/settings/model-providers', label: '模型接入', icon: '◈' },
      { href: '/settings/skills', label: '技能中心', icon: 'ϟ' },
      { href: '/settings/tools', label: '工具与 MCP', icon: '🧰' },
      { href: '/settings/plugins', label: '生态插件', icon: '🧩' },
    ],
  },
  {
    group: '内容与数据',
    items: [
      { href: '/settings/knowledge', label: '知识中心', icon: '▤' },
      { href: '/settings/templates', label: '项目模板库', icon: '▦' },
      { href: '/settings/profile-growth', label: '学情画像与轨迹', icon: '📊' },
      { href: '/settings/database', label: '数据库', icon: '◫' },
    ],
  },
  {
    group: '应用与会话',
    items: [
      { href: '/settings/dialogs', label: '已安装的对话', icon: '💬' },
      { href: '/settings/appearance', label: '外观偏好', icon: '◐' },
      { href: '/settings/ops', label: '沉浸运维', icon: '🌐' },
      { href: '/settings/system', label: '系统设置', icon: '⚙️' },
      { href: '/settings/about', label: '关于启途', icon: 'ⓘ' },
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
          {!siderCollapsed && (
            <span className="settings-sider-title">
              系统偏好设置
            </span>
          )}
          <button
            type="button"
            className="settings-sider-toggle-btn"
            onClick={() => setSiderCollapsed((prev) => !prev)}
            title={siderCollapsed ? '展开偏好设置侧边栏' : '收起偏好设置侧边栏'}
            aria-label={siderCollapsed ? '展开偏好设置侧边栏' : '收起偏好设置侧边栏'}
          >
            {siderCollapsed ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            )}
          </button>
        </div>
        <div className="settings-sider-scroll">
          {SETTINGS_NAV.map((grp, idx) => (
            <div key={grp.group} className="settings-sider-section">
              {!siderCollapsed ? (
                <div className="settings-sider-group">{grp.group}</div>
              ) : idx > 0 ? (
                <div className="settings-sider-divider" aria-hidden="true" />
              ) : null}
              {grp.items.map((item) => {
                const active = isItemActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`settings-sider-item ${active ? 'is-active' : ''}`}
                    title={`${grp.group} · ${item.label}`}
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
