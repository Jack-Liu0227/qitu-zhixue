'use client';

import { useCallback, useEffect, useState } from 'react';
import { EmptyState, InfoRow, SectionCard } from '@qitu/ui';
import type { AdminKnowledgeDocument } from '../../../../lib/api/content';
import { fetchAdminKnowledge } from '../../../../lib/api/content';
import { AdminStateViews } from '../../../../lib/components/AdminStateViews';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  verified: '已校验',
  archived: '已归档',
};

export default function AdminKnowledgePage() {
  const [documents, setDocuments] = useState<AdminKnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDocuments(await fetchAdminKnowledge());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('知识库加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const state = AdminStateViews({ loading, error, onRetry: load });
  if (state) return <div className="admin-settings-page">{state}</div>;

  return (
    <div className="admin-settings-page">
      <div className="admin-page-header">
        <div className="admin-page-header-title"><h1>知识库</h1></div>
        <p>由 Admin 统一维护的已登记知识文档。Tutor 只读取经过授权和校验的证据摘要，不直接读取数据库。</p>
      </div>
      {documents.length === 0 ? (
        <EmptyState title="暂无知识文档" description="知识库当前没有可供管理的文档，或数据库尚未初始化。" />
      ) : (
        <div className="admin-runtime-cards">
          {documents.map((document) => (
            <SectionCard key={document.id} title={document.title} action={<span className="admin-runtime-status-chip">{STATUS_LABEL[document.status] ?? document.status}</span>}>
              <div className="admin-runtime-row-meta admin-runtime-row-meta-spaced">
                <code className="admin-console-fingerprint">{document.id}</code>
                <span>{document.scope}</span>
                <span>版本 {document.version}</span>
              </div>
              <p className="admin-runtime-description">{document.summary || '暂无摘要'}</p>
              <InfoRow label="标签" value={document.tags.length > 0 ? document.tags.join('、') : '—'} />
              <InfoRow label="来源" value={document.source} />
              <InfoRow label="正文长度" value={`${document.contentLength} 字`} />
              <InfoRow label="校验时间" value={document.verifiedAt ? new Date(document.verifiedAt).toLocaleString('zh-CN') : '未校验'} />
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}
