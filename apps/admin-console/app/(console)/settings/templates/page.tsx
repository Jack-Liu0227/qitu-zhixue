'use client';

import { useCallback, useEffect, useState } from 'react';
import { EmptyState, InfoRow, SectionCard } from '@qitu/ui';
import type { AdminProjectTemplate } from '../../../../lib/api/content';
import { fetchAdminTemplates } from '../../../../lib/api/content';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';
import { SettingsSubNav } from '../../../../lib/components/SettingsSubNav';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  review: '待审核',
  published: '已发布',
  archived: '已归档',
};

export default function AdminTemplatesPage() {
  const [templates, setTemplates] = useState<AdminProjectTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await fetchAdminTemplates());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('模板库加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const state = AdminStateViews({ loading, error, onRetry: load });
  if (state) return <div className="admin-settings-page"><SettingsSubNav />{state}</div>;

  return (
    <div className="admin-settings-page">
      <SettingsSubNav />
      <div className="admin-page-header">
        <div className="admin-page-header-title"><h1>项目模板库</h1></div>
        <p>Admin 统一维护项目式学习模板。发布后的版本冻结，Tutor Agent 只能读取已发布版本。</p>
      </div>
      {templates.length === 0 ? (
        <EmptyState title="暂无项目模板" description="模板库当前没有可供管理的模板，或数据库尚未初始化。" />
      ) : (
        <div className="admin-runtime-cards">
          {templates.map((template) => (
            <SectionCard key={template.id} title={template.title} action={<span className="admin-runtime-status-chip">{STATUS_LABEL[template.status] ?? template.status}</span>}>
              <div className="admin-runtime-row-meta admin-runtime-row-meta-spaced">
                <code className="admin-console-fingerprint">{template.slug}</code>
                <span>{template.scope}</span>
                <span>{template.domain ?? '未分类'}</span>
              </div>
              <p className="admin-runtime-description">{template.summary || '暂无摘要'}</p>
              <InfoRow label="适用年龄" value={template.ageRange ?? '未设置'} />
              <InfoRow label="难度" value={template.difficulty ?? '未设置'} />
              <InfoRow label="预计时长" value={template.estimatedDurationMinutes ? `${template.estimatedDurationMinutes} 分钟` : '未设置'} />
              <InfoRow label="学习目标" value={template.learningObjectives.length > 0 ? template.learningObjectives.join('、') : '—'} />
              <InfoRow label="最新发布版本" value={template.latestPublishedVersionId ?? '未发布'} />
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}
