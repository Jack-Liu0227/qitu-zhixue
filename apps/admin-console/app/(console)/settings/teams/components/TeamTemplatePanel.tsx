'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminTeamTemplateReference, AdminTeamTemplateUsage } from '@qitu/contracts';
import { fetchTeamTemplateUsage } from '../../../../../lib/api/teams';
import { fetchAdminTemplates, restoreAdminTemplate, type AdminProjectTemplate } from '../../../../../lib/api/content';
import { newIdempotencyKey } from '../../../../../lib/api/types';
import { AdminStateViews } from '../../../../../lib/components/AdminStateViews';
import { TemplateDeleteDialog } from '../../../../../lib/components/template-library/TemplateDeleteDialog';
import './team-templates.css';

const statusLabels: Record<string, string> = {
  draft: '草稿', piloting: '试点', published: '已发布', archived: '已归档',
  validated: '已验证', active: '已启用', retired: '已退役',
};

export function TeamTemplatePanel({ teamId, updatedAt }: { teamId: string; updatedAt: string }) {
  const router = useRouter();
  const [usage, setUsage] = useState<AdminTeamTemplateUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const requestId = useRef(0);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const editBusy = useRef(false);
  const editIdentity = useRef(0);
  const restoreAttempt = useRef<{ template: AdminProjectTemplate; key: string } | null>(null);
  const load = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true); setError(null); setUsage(null);
    try {
      const current = await fetchTeamTemplateUsage(teamId);
      if (current.teamId !== teamId) throw new Error('团队关联回读不一致，请重新加载。');
      if (request === requestId.current) setUsage(current);
    } catch (cause) {
      if (request === requestId.current) setError(cause instanceof Error ? cause : new Error('模板关联加载失败'));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [teamId]);
  useEffect(() => { void load(); return () => { requestId.current++; }; }, [load, updatedAt]);
  useEffect(() => () => { editIdentity.current++; }, [teamId]);

  async function editTemplate(templateId: string) {
    if (editBusy.current) return;
    const request = editIdentity.current;
    editBusy.current = true; setEditingId(templateId); setActionError('');
    try {
      const current = (await fetchAdminTemplates()).find(template => template.id === templateId);
      if (!current) throw new Error('此模板已不存在，请刷新关联列表。');
      let versionId: string | undefined;
      if (current.status === 'archived' || restoreAttempt.current?.template.id === templateId) {
        if (restoreAttempt.current?.template.id !== templateId) restoreAttempt.current = { template: current, key: newIdempotencyKey() };
        const restored = await restoreAdminTemplate(restoreAttempt.current.template, restoreAttempt.current.key);
        restoreAttempt.current = null;
        versionId = restored.version?.id;
      }
      if (request === editIdentity.current) router.push(templateUrl(templateId, versionId));
    } catch (cause) {
      if (request === editIdentity.current) setActionError(cause instanceof Error ? cause.message : '无法打开模板编辑，请重试。');
    } finally {
      editBusy.current = false;
      if (request === editIdentity.current) setEditingId(null);
    }
  }

  const groups = new Map<string, AdminTeamTemplateReference[]>();
  for (const item of usage?.templates ?? []) groups.set(item.templateId, [...(groups.get(item.templateId) ?? []), item]);

  return <section className="team-template-panel" aria-label="关联模板">
    <div className="team-template-heading">
      <div><h3>关联模板{usage && <span className="team-template-total">{usage.templateCount}</span>}</h3>
        <p>查看此团队参与的课程，管理模板与教学安排</p></div>
      <button type="button" className="team-template-refresh" onClick={() => void load()} disabled={loading || editingId !== null}>{loading ? '正在刷新…' : '刷新'}</button>
    </div>
    <AdminStateViews loading={loading} error={error} onRetry={() => void load()} />
    {actionError && <p className="team-template-action-error" role="alert">{actionError}</p>}
    {!loading && !error && usage && <>
      {groups.size === 0 ? <div className="team-template-empty" role="status">尚未关联模板。<span>在模板的教学安排中选择此团队后，将在这里显示。</span></div> :
        <div className="team-template-list">{[...groups].map(([id, versions]) => {
          const template = versions[0]!;
          const bindings = versions.flatMap(version => version.bindings);
          const activeCount = bindings.filter(binding => binding.status === 'active').length;
          const projects = bindings.reduce((sum, binding) => sum + binding.projectCount, 0);
          const archived = template.templateStatus === 'archived';
          return <article className="team-template-item" key={id} aria-label={template.templateTitle}>
            <div className="team-template-row">
              <div className="team-template-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M8 12h8M8 16h5" /></svg></div>
              <div className="team-template-info">
                <div className="team-template-title"><Link href={templateUrl(id, template.templateVersionId)}>{template.templateTitle}</Link>
                  <span className="team-template-status" data-status={template.templateStatus}>{statusLabels[template.templateStatus] ?? template.templateStatus}</span></div>
                <p>{versions.length} 个关联版本<span>·</span>{activeCount > 0 ? `${activeCount} 个生效绑定` : '暂无生效绑定'}<span>·</span>{projects} 个项目引用</p>
              </div>
              <div className="team-template-actions">
                <button type="button" className="team-template-edit" disabled={editingId !== null} onClick={() => void editTemplate(id)}>{editingId === id ? '正在打开…' : archived ? '恢复并编辑' : '编辑模板'}</button>
                <button type="button" className="team-template-delete" disabled={editingId !== null} onClick={() => { setActionError(''); setDeleteTarget(id); }}>删除模板</button>
              </div>
            </div>
            <details className="team-template-details"><summary>关联明细<span>{bindings.length} 个绑定</span></summary>
              <div className="team-template-table-wrap"><table><thead><tr><th>模板版本</th><th>版本状态</th><th>绑定状态</th><th>项目引用</th></tr></thead>
                <tbody>{versions.flatMap(version => (version.bindings.length ? version.bindings : [null]).map((binding, index) =>
                  <tr key={`${version.templateVersionId}:${binding?.id ?? index}`}><td><Link href={templateUrl(id, version.templateVersionId)}>{version.version}</Link></td>
                    <td>{statusLabels[version.versionStatus] ?? version.versionStatus}</td><td>{binding ? statusLabels[binding.status] ?? binding.status : '尚未绑定'}</td><td>{binding?.projectCount ?? 0}</td></tr>))}</tbody>
              </table></div>
            </details>
          </article>;
        })}</div>}
    </>}
    {deleteTarget && <TemplateDeleteDialog key={deleteTarget} templateId={deleteTarget}
      onCancel={() => setDeleteTarget(null)} onDeleted={() => { setDeleteTarget(null); void load(); }} />}
  </section>;
}

function templateUrl(templateId: string, versionId?: string) {
  return `/settings/templates?templateId=${encodeURIComponent(templateId)}${versionId ? `&versionId=${encodeURIComponent(versionId)}` : ''}`;
}
