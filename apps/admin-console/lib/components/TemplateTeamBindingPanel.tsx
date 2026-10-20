'use client';

import { useEffect, useRef, useState } from 'react';
import type { AdminTeamConfig } from '@qitu/contracts';
import { Button, VisualAsset } from '@qitu/ui';
import { createTemplateBinding, fetchTemplateBindings, fetchTeamVersions, publishTeamVersion, saveTemplateBundle,
  transitionTemplateBinding, type TemplateTeamBinding, type PublishedTeamVersion } from '../api/template-bindings';
import { newIdempotencyKey } from '../api/types';

const LABELS = { draft: '草稿已保存', validated: '已校验，待启用', active: '已生效', retired: '已停用' };

export function TemplateTeamBindingPanel({ templateId, versionId, teams }: {
  templateId: string; versionId: string | null; teams: AdminTeamConfig[];
}) {
  const [records, setRecords] = useState<TemplateTeamBinding[]>([]);
  const [teamId, setTeamId] = useState('');
  const [versions, setVersions] = useState<PublishedTeamVersion[]>([]);
  const [teamVersionId, setTeamVersionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [catalogReady, setCatalogReady] = useState(false);
  const [versionsReady, setVersionsReady] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [bundleText, setBundleText] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const current = records.find((row) => row.binding.teamVersionId === teamVersionId && row.binding.status !== 'retired');
  const active = records.find((row) => row.binding.status === 'active');

  useEffect(() => {
    const request = ++generation.current;
    setLoading(true); setCatalogReady(false); setError(''); setRecords([]); setTeamId(''); setTeamVersionId('');
    if (!versionId) { setLoading(false); return; }
    void fetchTemplateBindings(templateId, versionId).then((rows) => {
      if (request !== generation.current) return;
      const sorted = rows.slice().sort((a, b) => b.binding.createdAt.localeCompare(a.binding.createdAt));
      const selected = sorted.find((row) => row.binding.status !== 'retired');
      setCatalogReady(true);
      setRecords(sorted); setTeamId(selected?.team?.id ?? ''); setTeamVersionId(selected?.binding.teamVersionId ?? '');
    }).catch((failure: unknown) => { if (request === generation.current) setError(failure instanceof Error ? failure.message : '绑定读取失败'); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [templateId, versionId, reload]);

  useEffect(() => {
    let activeRequest = true;
    setVersions([]); setVersionsReady(false);
    if (!teamId) { setVersionsLoading(false); return; }
    setVersionsLoading(true);
    void fetchTeamVersions(teamId).then((rows) => {
      if (!activeRequest) return;
      setVersions(rows);
      setVersionsReady(true);
      setTeamVersionId((id) => rows.some((row) => row.id === id) ? id : rows.find((row) => row.runtimeSnapshotStatus === 'published')?.id ?? '');
    }).catch((failure: unknown) => { if (activeRequest) setError(failure instanceof Error ? failure.message : '团队版本读取失败'); })
      .finally(() => { if (activeRequest) setVersionsLoading(false); });
    return () => { activeRequest = false; };
  }, [teamId]);

  useEffect(() => { setBundleText(current?.binding.bundleDraft ? JSON.stringify(current.binding.bundleDraft, null, 2) : ''); }, [current?.binding.id, current?.binding.updatedAt]);

  async function act(kind: 'publish' | 'save' | 'bundle' | 'activate') {
    if (busy || !versionId || !catalogReady || !versionsReady) return;
    const scope = generation.current;
    const signature = JSON.stringify({ kind, templateId, versionId, teamId, teamVersionId, bundleText });
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: newIdempotencyKey() };
    const key = attempt.current.key;
    setBusy(true); setError(''); setNotice('');
    try {
      if (kind === 'publish') {
        const team = teams.find((row) => row.id === teamId);
        if (!team) throw new Error('请选择服务器目录中的团队');
        const saved = await publishTeamVersion(teamId, team.updatedAt, key);
        const readback = await fetchTeamVersions(teamId);
        if (!readback.some((row) => row.id === saved.id && row.runtimeSnapshotStatus === 'published')) throw new Error('团队版本回读未确认');
        if (scope !== generation.current) return;
        setVersions(readback); setTeamVersionId(saved.id); setNotice('团队版本已生成并回读确认。');
      } else {
        let expectedId: string;
        if (kind === 'save') {
          if (!versions.some((row) => row.id === teamVersionId && row.runtimeSnapshotStatus === 'published')) throw new Error('请先选择或生成已发布的团队版本');
          const saved = current ?? { binding: (await createTemplateBinding(templateId, versionId, teamVersionId, key)).binding };
          expectedId = saved.binding.id;
        } else {
          if (!current) throw new Error('请先保存团队绑定草稿');
          expectedId = current.binding.id;
          if (kind === 'bundle') {
            const draft: unknown = JSON.parse(bundleText);
            await saveTemplateBundle(templateId, versionId, expectedId, draft, key);
          } else {
            if (current.binding.status === 'draft') await transitionTemplateBinding(templateId, versionId, expectedId, 'validate', key + ':validate');
            await transitionTemplateBinding(templateId, versionId, expectedId, 'activate', key + ':activate');
          }
        }
        const rows = await fetchTemplateBindings(templateId, versionId);
        const saved = rows.find((row) => row.binding.id === expectedId);
        if (!saved || saved.binding.teamVersionId !== teamVersionId || (kind === 'activate' && saved.binding.status !== 'active')) throw new Error('绑定保存后的回读未确认，请重新加载核对');
        if (scope !== generation.current) return;
        setRecords(rows); setNotice(kind === 'activate' ? '团队绑定已生效，现有项目继续使用原冻结配置。' : '团队配置已保存并回读确认，刷新后保留。');
      }
      attempt.current = null;
    } catch (failure) { if (scope === generation.current) setError(failure instanceof Error ? failure.message : '团队配置保存失败'); }
    finally { if (scope === generation.current) setBusy(false); }
  }

  return <section className="admin-editor-card" aria-label="模板团队绑定" style={{ padding: 20, margin: '16px 0' }}>
    <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16 }}><VisualAsset assetId="team-optics-v1" size={28} />导师团队配置</h2>
    <p>{active ? `当前生效团队：${active.team?.name ?? '团队不可用'}` : '当前没有生效团队绑定。'}{loading ? ' 正在读取…' : ''}</p>
    {!versionId ? <p>请先保存模板草稿版本，再配置导师团队。</p> : <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>导师团队 <select className="admin-input-text" aria-label="绑定导师团队" value={teamId} disabled={loading || busy || !catalogReady} onChange={(event) => { setError(''); setNotice(''); setTeamVersionId(''); setTeamId(event.target.value); }}>
          <option value="">请选择团队</option>{teams.filter((team) => team.enabled).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select></label>
        <label>团队版本 <select className="admin-input-text" aria-label="绑定团队版本" value={teamVersionId} disabled={loading || busy || versionsLoading} onChange={(event) => setTeamVersionId(event.target.value)}>
          <option value="">请选择团队版本</option>{versions.map((row) => <option key={row.id} value={row.id}>v{row.version}{row.runtimeSnapshotStatus !== 'published' ? '（历史版本）' : ''}</option>)}
        </select></label>
        <Button variant="secondary" size="sm" type="button" disabled={!teamId || busy || loading || versionsLoading || !catalogReady || !versionsReady} onClick={() => void act('publish')}>生成当前团队版本</Button>
        <Button variant="secondary" size="sm" type="button" disabled={!teamVersionId || busy || loading || versionsLoading || !catalogReady || !versionsReady} onClick={() => void act('save')}>保存团队绑定</Button>
        <Button variant="secondary" size="sm" type="button" disabled={!current || current.binding.status === 'active' || busy || loading || !catalogReady || !versionsReady} onClick={() => void act('activate')}>校验并启用绑定</Button>
      </div>
      <p>{current ? LABELS[current.binding.status] : '尚未保存此团队版本的绑定'}。草稿保存与正式启用分开确认；课程正文和已有项目不会被覆盖。</p>
      <details><summary>教学角色与知识范围配置</summary>
        <p>可从管家生成的教学配置填写角色、技能、模型和知识库引用，启用前由服务端校验。</p>
        <textarea className="admin-input-text" aria-label="教学配置草稿" value={bundleText} disabled={busy || current?.binding.status !== 'draft'} onChange={(event) => setBundleText(event.target.value)} style={{ width: '100%', minHeight: 180, fontFamily: 'monospace' }} />
        <Button variant="secondary" size="sm" type="button" disabled={!current || current.binding.status !== 'draft' || busy || !bundleText.trim()} onClick={() => void act('bundle')}>保存教学配置</Button>
      </details>
    </>}
    {busy && <p role="status">正在保存并核对服务器结果…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error} <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => setReload((value) => value + 1)}>重新加载</Button></p>}
  </section>;
}
