'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminSettingsIndexData } from '@qitu/contracts';
import { AdminStateViews } from '../../../lib/components/AdminStateViews';
import { DataSourceBadge } from '../../../lib/components/DataSourceBadge';
import { fetchSettings } from '../../../lib/api/settings';
import { SettingsSubNav } from '../../../lib/components/SettingsSubNav';
import { ModelSettingsPrototype } from './ModelSettingsPrototype';

export default function AdminSettingsPage() {
  const [data, setData] = useState<AdminSettingsIndexData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchSettings());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('未知错误'));
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
      <SettingsSubNav />
      <div className="admin-page-header">
        <div className="admin-page-header-title">
          <h1>模型与设置</h1>
          <DataSourceBadge dataSource={data.dataSource} />
        </div>
        <p>管理 AI 学习搭档的运行时配置</p>
      </div>
      <ModelSettingsPrototype />
    </div>
  );
}
