'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { AdminSettingsRegistry, AdminSettingsRegistryBadgeKind, AdminSettingsRegistryItem } from '@qitu/contracts';
import { fetchAdminAssistantConfigs } from '../../../lib/api/assistants';
import { fetchAdminTeamConfigs } from '../../../lib/api/teams';
import { fetchRuntimeSnapshot } from '../../../lib/api/runtime';
import { fetchSettingsRegistry, loadSettingsBadgeStates } from '../../../lib/api/settings';
import { AdminOfflineError, AdminPermissionError } from '../../../lib/api/types';

interface BadgeState {
  phase: 'loading' | 'ready' | 'error';
  value?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof AdminPermissionError) return '当前账号没有访问设置注册表的权限。';
  if (error instanceof AdminOfflineError) return '当前无法连接服务器，请检查网络后重试。';
  return error instanceof Error ? error.message : '设置注册表读取失败，请重试。';
}

function staticBadge(kind: AdminSettingsRegistryBadgeKind): string | null {
  return kind === 'static' ? '配置入口' : null;
}

async function fetchBadge(item: AdminSettingsRegistryItem): Promise<string> {
  switch (item.badgeKind) {
    case 'assistant-count': {
      const assistants = await fetchAdminAssistantConfigs();
      return `${assistants.length} 个 · 已启用 ${assistants.filter((row) => row.enabled).length}`;
    }
    case 'team-count': {
      const teams = await fetchAdminTeamConfigs();
      return `${teams.length} 支 · 已启用 ${teams.filter((row) => row.enabled).length}`;
    }
    case 'runtime-tools': {
      const runtime = await fetchRuntimeSnapshot();
      return `${runtime.builtInTools.length} 个工具 · ${runtime.mcpServers.length} 个 MCP`;
    }
    case 'runtime-skills': {
      const runtime = await fetchRuntimeSnapshot();
      return `${runtime.skills.length} 个 · 就绪 ${runtime.skills.filter((row) => row.status === 'ready').length}`;
    }
    case 'static':
      return staticBadge(item.badgeKind) ?? '配置入口';
  }
}

function groupedRegistry(registry: AdminSettingsRegistry): Array<{ group: string; items: AdminSettingsRegistryItem[] }> {
  const groups = new Map<string, AdminSettingsRegistryItem[]>();
  for (const item of registry) {
    if (item.id === 'overview') continue;
    const items = groups.get(item.group) ?? [];
    items.push(item);
    groups.set(item.group, items);
  }
  return [...groups.entries()].map(([group, items]) => ({
    group,
    items: [...items].sort((a, b) => a.order - b.order),
  }));
}

export default function SettingsIndexPage() {
  const [registry, setRegistry] = useState<AdminSettingsRegistry | null>(null);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [registryError, setRegistryError] = useState('');
  const [badgeStates, setBadgeStates] = useState<Record<string, BadgeState>>({});

  const loadRegistry = async () => {
    setRegistryLoading(true);
    setRegistryError('');
    try {
      const nextRegistry = await fetchSettingsRegistry();
      setRegistry(nextRegistry);
    } catch (error) {
      setRegistryError(errorMessage(error));
    } finally {
      setRegistryLoading(false);
    }
  };

  useEffect(() => {
    void loadRegistry();
  }, []);

  useEffect(() => {
    if (registry === null) return;
    let cancelled = false;
    const dynamicItems = registry.filter((item) => item.badgeKind !== 'static');
    setBadgeStates((current) => {
      const next = { ...current };
      for (const item of dynamicItems) next[item.id] = { phase: 'loading' };
      return next;
    });

    void loadSettingsBadgeStates(dynamicItems, fetchBadge).then((nextStates) => {
      if (!cancelled) setBadgeStates((current) => ({ ...current, ...nextStates }));
    });

    return () => {
      cancelled = true;
    };
  }, [registry]);

  const groups = useMemo(() => (registry === null ? [] : groupedRegistry(registry)), [registry]);
  const teamsHref = registry?.find((item) => item.id === 'teams')?.href ?? '/settings/teams';

  if (registryLoading) {
    return <div className="settings-overview-page" aria-busy="true"><p role="status">正在读取设置清单…</p></div>;
  }

  if (registryError) {
    return (
      <div className="settings-overview-page">
        <header className="settings-pagehead">
          <div className="settings-titlebox"><span className="settings-eyebrow">WORKSPACE SETTINGS</span><h1>系统设置总览</h1></div>
        </header>
        <section className="settings-empty-state" role="alert">
          <strong>设置清单暂时不可用</strong>
          <p>{registryError}</p>
          <button type="button" className="settings-action-btn is-primary" onClick={() => void loadRegistry()}>重试读取</button>
        </section>
      </div>
    );
  }

  if (registry === null || registry.length === 0) {
    return <div className="settings-overview-page"><p role="status">暂时没有可用的设置项。</p></div>;
  }

  return (
    <div className="settings-overview-page">
      <header className="settings-pagehead">
        <div className="settings-titlebox">
          <span className="settings-eyebrow">WORKSPACE SETTINGS</span>
          <h1>系统设置总览</h1>
          <div className="settings-desc">集中管理启途智学平台的大模型接入、AI 助手、协作团队、技能、工具与生态插件。</div>
        </div>
      </header>

      <section className="settings-overview-intro">
        <div>
          <span className="settings-overview-kicker">全栈协同</span>
          <h2>将智能体、团队协作与项目模板深度咬合</h2>
          <p>底层依托自主研发 Agent SDK，连接模型、助手、技能与沙箱工具。由项目模板驱动 PBL 四阶段门禁管控，全链路真实协同。</p>
        </div>
        <Link href={teamsHref} className="settings-action-btn is-primary">查看团队配置 <span aria-hidden="true">→</span></Link>
      </section>

      {groups.map(({ group, items }) => (
        <section key={group} aria-labelledby={`settings-group-${group}`}>
          <h2 id={`settings-group-${group}`} className="settings-sider-group" style={{ margin: '24px 0 12px' }}>{group}</h2>
          <div className="settings-overview-grid">
            {items.map((item) => {
              const state = badgeStates[item.id];
              const badge = item.badgeKind === 'static' ? staticBadge(item.badgeKind) : state?.phase === 'error' ? '读取失败' : state?.phase === 'ready' ? state.value : '读取中';
              return (
                <Link key={item.id} href={item.href} className={`settings-overview-card is-${item.accent}`}>
                  <span className="settings-overview-icon" aria-hidden="true">{item.icon}</span>
                  <span className="settings-overview-copy">
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <strong>{item.title}</strong>
                      {badge ? <span style={{ fontSize: '11px', background: 'rgba(37,99,235,0.08)', color: '#2563eb', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>{badge}</span> : null}
                    </span>
                    <span style={{ marginTop: '4px' }}>{item.description}</span>
                  </span>
                  <span className="settings-overview-arrow" aria-hidden="true">→</span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
