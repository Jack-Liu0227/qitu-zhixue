'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminSettingsIndexData, AdminSettingsPanel } from '@qitu/contracts';
import { Badge, InfoRow } from '@qitu/ui';
import { fetchSettings } from '../../../lib/api/settings';
import { AdminStateViews } from '../../../lib/components/AdminStateViews';
import { DataSourceBadge } from '../../../lib/components/DataSourceBadge';

export default function AdminSettingsPage() {
  const [data, setData] = useState<AdminSettingsIndexData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSettings();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('未知错误'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stateView = AdminStateViews({ loading, error, onRetry: load });
  if (stateView) return <div className="admin-settings-page">{stateView}</div>;

  if (!data) return null;

  return (
    <div className="admin-settings-page">
      <div className="admin-page-header">
        <div className="admin-page-header-title">
          <h1>设置</h1>
          <DataSourceBadge dataSource={data.dataSource} />
        </div>
        <p>管理平台配置与模型接入</p>
      </div>

      <div className="admin-settings-overview">
        <InfoRow label="已配置的模型供应商" value={`${data.configuredProviderCount} 个`} />
        <InfoRow label="已绑定的模型用途" value={`${data.configuredUsageCount} 个`} />
      </div>

      <div className="admin-settings-panels">
        {data.panels.map((panel) => (
          <SettingsPanelCard key={panel.id} panel={panel} />
        ))}
      </div>
    </div>
  );
}

function SettingsPanelCard({ panel }: { panel: AdminSettingsPanel }) {
  const isAvailable = panel.status === 'available' && panel.route !== null;

  const content = (
    <div className={isAvailable ? 'admin-settings-panel clickable' : 'admin-settings-panel'}>
      <div className="admin-settings-panel-header">
        <h3>{panel.title}</h3>
        {panel.status === 'planned' ? (
          <Badge tone="neutral" size="sm">
            未开放
          </Badge>
        ) : null}
      </div>
      <p className="admin-settings-panel-description">{panel.description}</p>
    </div>
  );

  if (isAvailable && panel.route) {
    return <Link href={panel.route}>{content}</Link>;
  }

  return content;
}
