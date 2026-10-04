'use client';

import { useCallback, useEffect, useState } from 'react';
import { InfoRow, SectionCard } from '@qitu/ui';
import type { AdminRuntimeSnapshot } from '@qitu/contracts';
import { fetchRuntimeSnapshot } from '../../../../lib/api/runtime';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { SettingsSubNav } from '../../../../lib/components/SettingsSubNav';
import { InitializationCheckBadge, RuntimeHealthBadge, databaseLabel, dataModeLabel } from '../../../../lib/components/RuntimeViews';

export default function AdminDatabasePage() {
  const [snapshot, setSnapshot] = useState<AdminRuntimeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchRuntimeSnapshot());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('数据库状态加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const state = AdminStateViews({ loading, error, onRetry: load });
  if (state) return <div className="admin-settings-page"><SettingsSubNav />{state}</div>;
  if (!snapshot) return null;

  return (
    <div className="admin-settings-page">
      <SettingsSubNav />
      <div className="admin-page-header">
        <div className="admin-page-header-title"><h1>数据库与初始化</h1><RuntimeHealthBadge health={snapshot.initialization.overall} /></div>
        <p>数据库 schema 由部署或 CLI 运维流程管理。Admin 只查看连接、初始化和迁移证据，不通过 HTTP 执行迁移。</p>
      </div>
      <div className="admin-runtime-cards">
        <SectionCard title="连接状态">
          <InfoRow label="数据模式" value={dataModeLabel(snapshot.initialization.dataMode)} />
          <InfoRow label="数据库" value={databaseLabel(snapshot.initialization.database)} />
          <InfoRow label="迁移版本" value={snapshot.initialization.migrationVersion ?? '未知（API 不探测迁移）'} />
        </SectionCard>
        <SectionCard title="基础数据检查">
          <ul className="admin-runtime-list">
            {snapshot.initialization.checks.map((check) => (
              <li key={check.id} className="admin-runtime-row">
                <div className="admin-runtime-row-head"><strong>{check.label}</strong><InitializationCheckBadge status={check.status} /></div>
                <div className="admin-runtime-row-meta"><code className="admin-console-fingerprint">{check.id}</code><span>{check.detail ?? '—'}</span></div>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
