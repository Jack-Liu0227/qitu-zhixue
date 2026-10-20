'use client';

import { AssistantGlyph } from '@qitu/ui';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { AdminSettingsRegistry, AdminSettingsRegistryItem } from '@qitu/contracts';
import { fetchSettingsRegistry } from '../../../lib/api/settings';
import { AdminOfflineError, AdminPermissionError } from '../../../lib/api/types';
import './settings-aion.css';
import './settings-compact.css';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

/**
 * 兼容降级导航：仅在注册表接口不可用时使用，确保已打开的管理端仍可切换页面。
 * 正常导航、名称和分组均来自服务端 `/admin/settings/registry`。
 */
const FALLBACK_SETTINGS_NAV: NavGroup[] = [
  { group: '工作区', items: [{ href: '/settings', label: '设置总览', icon: '⌂' }, { href: '/settings/account', label: '账号设置', icon: '👤' }] },
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

function registryGroups(registry: AdminSettingsRegistry): NavGroup[] {
  const groups = new Map<string, AdminSettingsRegistryItem[]>();
  for (const item of registry) {
    if (item.id === 'models') continue;
    const items = groups.get(item.group) ?? [];
    items.push(item);
    groups.set(item.group, items);
  }
  return [...groups.entries()].map(([group, items]) => ({
    group,
    items: [...items].sort((a, b) => a.order - b.order).map((item) => ({ href: item.href, label: item.label, icon: item.icon })),
  }));
}

function registryErrorMessage(error: unknown): string {
  if (error instanceof AdminPermissionError) return '当前账号没有设置权限，已启用兼容导航。';
  if (error instanceof AdminOfflineError) return '设置清单暂时离线，已启用兼容导航。';
  return '设置清单读取失败，已启用兼容导航。';
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const internal = toInternal(pathname);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [registry, setRegistry] = useState<AdminSettingsRegistry | null>(null);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [registryError, setRegistryError] = useState('');
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [navigationQuery, setNavigationQuery] = useState('');

  useEffect(() => { setNavigationOpen(false); }, [pathname]);

  useEffect(() => {
    let active = true;
    void fetchSettingsRegistry().then(
      (nextRegistry) => {
        if (!active) return;
        setRegistry(nextRegistry);
        setRegistryLoading(false);
      },
      (error: unknown) => {
        if (!active) return;
        setRegistryError(registryErrorMessage(error));
        setRegistryLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const navigation = registry === null || registry.length === 0 ? FALLBACK_SETTINGS_NAV : registryGroups(registry);

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
    <div className={`settings-shell ${siderCollapsed ? 'is-sider-collapsed' : ''} ${navigationOpen ? 'is-navigation-open' : ''}`}>
      <button type="button" className="settings-mobile-nav-toggle qitu-button" aria-expanded={navigationOpen} aria-controls="settings-navigation" onClick={() => { setSiderCollapsed(false); setNavigationOpen(!navigationOpen); }}>
        {navigationOpen ? '收起设置目录' : `设置目录 · ${navigation.flatMap((group) => group.items).find((item) => isItemActive(item.href))?.label ?? '设置'}`}
      </button>
      <aside id="settings-navigation" className={`settings-sider ${siderCollapsed ? 'is-collapsed' : ''}`} aria-label="设置导航">
        <div className="settings-sider-head">
          {!siderCollapsed && <span className="settings-sider-title">系统偏好设置</span>}
          <button
            type="button"
            className="settings-sider-toggle-btn"
            onClick={() => setSiderCollapsed((prev) => !prev)}
            title={siderCollapsed ? '展开偏好设置侧边栏' : '收起偏好设置侧边栏'}
            aria-label={siderCollapsed ? '展开偏好设置侧边栏' : '收起偏好设置侧边栏'}
          >
            {siderCollapsed ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            )}
          </button>
        </div>
        {!siderCollapsed && registryLoading && <div role="status" style={{ padding: '8px 16px', fontSize: '12px', color: '#64748b' }}>正在读取设置清单…</div>}
        {!siderCollapsed && registryError && <div role="alert" style={{ padding: '8px 16px', fontSize: '12px', color: '#b42318' }}>{registryError}</div>}
        {!siderCollapsed && <label className="settings-nav-search">查找设置<input type="search" value={navigationQuery} placeholder="输入名称" onChange={(event) => setNavigationQuery(event.target.value)} /></label>}
        <div className="settings-sider-scroll">
          {navigation.map((grp) => ({ ...grp, items: grp.items.filter((item) => `${grp.group} ${item.label}`.includes(navigationQuery.trim())) })).filter((grp) => grp.items.length > 0).map((grp, idx) => (
            <div key={grp.group} className="settings-sider-section">
              {!siderCollapsed ? <div className="settings-sider-group">{grp.group}</div> : idx > 0 ? <div className="settings-sider-divider" aria-hidden="true" /> : null}
              {grp.items.map((item) => {
                const active = isItemActive(item.href);
                return (
                  <Link key={item.href} href={item.href} className={`settings-sider-item ${active ? 'is-active' : ''}`} title={`${grp.group} · ${item.label}`} aria-current={active ? 'page' : undefined}>
                    <span className="settings-sider-icon" aria-hidden="true"><AssistantGlyph value={item.icon} size={20} /></span>
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
