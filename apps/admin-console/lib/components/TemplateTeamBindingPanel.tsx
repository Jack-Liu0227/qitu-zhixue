'use client';

import { useEffect, useRef, useState } from 'react';
import type { AdminTeamConfig, ProjectTemplateSpec } from '@qitu/contracts';
import { Button, VisualAsset } from '@qitu/ui';
import { createTemplateBinding, fetchTemplateBindings, fetchTeamVersions, publishTeamVersion, saveTemplateBundle, prepareTemplateBundle,
  transitionTemplateBinding, type TemplateTeamBinding, type PublishedTeamVersion } from '../api/template-bindings';
import { newIdempotencyKey } from '../api/types';
import { fetchAdminTeamConfigs } from '../api/teams';
import { ProjectBindingRecovery } from './ProjectBindingRecovery';
import { TeachingBindingGuide } from './TeachingBindingGuide';

const LABELS = { draft: '草稿已保存', validated: '已校验，待启用', active: '已生效', retired: '已停用' };

export function TemplateTeamBindingPanel({ templateId, versionId, teams, versionStatus, profiles, phases, requiresBundle }: {
  templateId: string; versionId: string | null; teams: AdminTeamConfig[]; versionStatus: string;
  profiles: NonNullable<ProjectTemplateSpec['curriculum']>['profiles'];
  requiresBundle: boolean;
  phases: ProjectTemplateSpec['phases'];
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
  const [profileId, setProfileId] = useState(profiles.length === 1 ? profiles[0]?.id ?? '' : '');
  const [phaseAssignments, setPhaseAssignments] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const current = records.filter((row) => row.binding.teamVersionId === teamVersionId && row.binding.status !== 'retired')
    .sort((a, b) => b.binding.createdAt.localeCompare(a.binding.createdAt))[0];
  const active = records.find((row) => row.binding.status === 'active');
  const activeReady = Boolean(active?.configurationReady);
  const activeBlockers = active ? [
    !active.binding.validation.valid ? '服务端绑定校验未通过' : null,
    active.team?.runtimeSnapshotStatus !== 'published' ? '团队版本仍是 legacy_unpinned，尚未形成发布快照' : null,
    !active.binding.bundleDraft ? '缺少教学配置草稿' : null,
    !active.binding.bundleDigest ? '缺少服务端编译后的教学包 digest' : null,
  ].filter((item): item is string => item !== null) : [];
  const selectedPublished = versions.some((row) => row.id === teamVersionId && row.runtimeSnapshotStatus === 'published');
  const canActivate = versionStatus === 'published' || versionStatus === 'piloting';
  const members = versions.find((row) => row.id === teamVersionId)?.members ?? [];
  const profile = profiles.find((entry) => entry.id === (current?.binding.bundleDraft?.scheduleProfileId ?? profileId));
  const routedPhases = phases.filter((phase) => profile?.sessions.some((session) => session.phase === phase.phase));
  const assignmentsReady = routedPhases.every((phase) => phase.assignedAssistantId
    ? members.some((member) => member.assistantId === phase.assignedAssistantId)
    : members.some((member) => member.slotId === phaseAssignments[phase.phase]));

  useEffect(() => {
    const request = ++generation.current;
    setLoading(true); setBusy(false); setCatalogReady(false); setError(''); setRecords([]); setTeamId(''); setTeamVersionId('');
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

  async function act(kind: 'publish' | 'save' | 'bundle' | 'prepare' | 'activate') {
    if (busy || !versionId || !catalogReady || !versionsReady) return;
    const scope = generation.current;
    const signature = JSON.stringify({ kind, templateId, versionId, teamId, teamVersionId, bundleText, profileId, phaseAssignments });
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: newIdempotencyKey() };
    const key = attempt.current.key;
    setBusy(true); setError(''); setNotice('');
    try {
      if (kind === 'publish') {
        const team = (await fetchAdminTeamConfigs()).find((row) => row.id === teamId && row.enabled);
        if (!team) throw new Error('请选择服务器目录中的团队');
        const saved = await publishTeamVersion(teamId, team.updatedAt, key);
        const readback = await fetchTeamVersions(teamId);
        if (!readback.some((row) => row.id === saved.id && row.runtimeSnapshotStatus === 'published')) throw new Error('团队版本回读未确认');
        if (scope !== generation.current) return;
        setVersions(readback); setTeamVersionId(saved.id); setNotice('团队版本已生成并回读确认。');
      } else {
        let expectedId: string;
        let expectedUpdatedAt: string | undefined;
        if (kind === 'save') {
          if (!versions.some((row) => row.id === teamVersionId && row.runtimeSnapshotStatus === 'published')) throw new Error('请先选择或生成已发布的团队版本');
          const saved = current ?? { binding: (await createTemplateBinding(templateId, versionId, teamVersionId, key)).binding };
          expectedId = saved.binding.id;
        } else {
          if (!current) throw new Error('请先保存团队绑定草稿');
          expectedId = current.binding.id;
          if (kind === 'prepare') {
            expectedUpdatedAt = (await prepareTemplateBundle(templateId, versionId, expectedId, profileId, key, phaseAssignments)).binding.updatedAt;
          } else if (kind === 'bundle') {
            const draft: unknown = JSON.parse(bundleText);
            expectedUpdatedAt = (await saveTemplateBundle(templateId, versionId, expectedId, draft, key)).binding.updatedAt;
          } else {
            if (current.binding.status === 'draft') await transitionTemplateBinding(templateId, versionId, expectedId, 'validate', key + ':validate');
            await transitionTemplateBinding(templateId, versionId, expectedId, 'activate', key + ':activate');
          }
        }
        const rows = await fetchTemplateBindings(templateId, versionId);
        const saved = rows.find((row) => row.binding.id === expectedId);
        if (!saved || saved.binding.teamVersionId !== teamVersionId || (kind === 'activate' && saved.binding.status !== 'active')) throw new Error('绑定保存后的回读未确认，请重新加载核对');
        if (expectedUpdatedAt && (saved.binding.updatedAt !== expectedUpdatedAt || !saved.binding.bundleDraft)) throw new Error('教学配置回读未确认，请重新加载核对。');
        if (scope !== generation.current) return;
        setRecords(rows); setNotice(kind === 'activate' ? '团队绑定已生效；历史缺失绑定的项目可在下方逐项恢复。' : kind === 'prepare' ? '教学配置草稿已生成并保存，请核对后校验启用。知识库范围默认未授权。' : '团队配置已保存并回读确认，刷新后保留。');
      }
      attempt.current = null;
    } catch (failure) { if (scope === generation.current) setError(failure instanceof Error ? failure.message : '团队配置保存失败'); }
    finally { if (scope === generation.current) setBusy(false); }
  }

  return <section className="admin-editor-card" aria-label="模板团队绑定" style={{ padding: 20, margin: '16px 0' }}>
    <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16 }}><VisualAsset assetId="team-optics-v1" size={28} />导师团队配置</h2>
    <p>{active ? `当前绑定团队：${active.team?.name ?? '团队不可用'} · ${activeReady ? '教学配置已就绪' : '历史绑定待更新'}` : '当前没有生效团队绑定。'}{loading ? ' 正在读取…' : ''}</p>
    {active && !activeReady && <div role="alert">
      <p>当前历史绑定缺少完整教学配置，学生项目暂时无法使用。未就绪项：{activeBlockers.join('；') || '服务端未返回具体原因'}。</p>
      <p>处理顺序：生成当前团队版本 → 保存新绑定 → 选择课时与阶段导师 → 生成教学配置 → 校验并启用。旧项目不会被自动改写。</p>
    </div>}
    {!versionId ? <p>请先保存模板草稿版本，再配置导师团队。</p> : <>
      {requiresBundle && <TeachingBindingGuide published={selectedPublished} saved={!!current} draft={current?.binding.bundleDraft} ready={activeReady && current?.binding.id === active?.binding.id} canActivate={canActivate} />}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>导师团队 <select className="admin-input-text" aria-label="绑定导师团队" value={teamId} disabled={loading || busy || !catalogReady} onChange={(event) => { setError(''); setNotice(''); setTeamVersionId(''); setTeamId(event.target.value); }}>
          <option value="">请选择团队</option>{teams.filter((team) => team.enabled).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select></label>
        <label>团队版本 <select className="admin-input-text" aria-label="绑定团队版本" value={teamVersionId} disabled={loading || busy || versionsLoading} onChange={(event) => { setPhaseAssignments({}); setTeamVersionId(event.target.value); }}>
          <option value="">请选择团队版本</option>{versions.map((row) => <option key={row.id} value={row.id}>v{row.version}{row.runtimeSnapshotStatus !== 'published' ? '（历史版本）' : ''}</option>)}
        </select></label>
        <Button variant="secondary" size="sm" type="button" disabled={!teamId || busy || loading || versionsLoading || !catalogReady || !versionsReady} onClick={() => void act('publish')}>生成当前团队版本</Button>
        <Button variant="secondary" size="sm" type="button" disabled={!selectedPublished || current?.binding.status === 'active' || busy || loading || versionsLoading || !catalogReady || !versionsReady} onClick={() => void act('save')}>保存团队绑定</Button>
        {profiles.length > 0 && <>
          <label>课时排期 <select className="admin-select" aria-label="绑定课时排期" value={current?.binding.bundleDraft?.scheduleProfileId ?? profileId} disabled={busy || !!current?.binding.bundleDraft} onChange={(event) => setProfileId(event.target.value)}>
            <option value="">请选择排期</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.schedule.lessonCount} 课时 × {profile.schedule.lessonMinutes} 分钟</option>)}
          </select></label>
          <Button variant="secondary" size="sm" type="button" disabled={!current || current.binding.status !== 'draft' || !!current.binding.bundleDraft || !profileId || !assignmentsReady || busy || loading || versionsLoading || !catalogReady || !versionsReady}
            onClick={() => void act('prepare')}>生成教学配置</Button>
        </>}
        <Button variant="secondary" size="sm" type="button" disabled={!canActivate || !current || current.binding.status === 'active' || (requiresBundle && !current.binding.bundleDraft) || busy || loading || versionsLoading || !catalogReady || !versionsReady} onClick={() => void act('activate')}>校验并启用绑定</Button>
      </div>
      <p>{current ? LABELS[current.binding.status] : '尚未保存此团队版本的绑定'}。草稿保存与正式启用分开确认；课程正文和已有项目不会被覆盖。</p>
      {!canActivate && <p>当前课程版本尚未进入试点或发布状态，可以保存配置，审核后再启用。</p>}
      {teamVersionId && !selectedPublished && <p>所选是历史团队版本，请点击“生成当前团队版本”后继续绑定。</p>}
      {requiresBundle && selectedPublished && current?.binding.status === 'draft' && !current.binding.bundleDraft && <div>
        <p>为每个课程阶段选择本团队的已发布成员。模板已有指定助手时，沿用该明确配置。</p>
        {routedPhases.map((phase) => <label key={phase.phase}>{phase.title} <select className="admin-select" aria-label={`${phase.title}的导师`}
          value={phase.assignedAssistantId ? members.find((member) => member.assistantId === phase.assignedAssistantId)?.slotId ?? '' : phaseAssignments[phase.phase] ?? ''}
          disabled={busy || !!phase.assignedAssistantId} onChange={(event) => setPhaseAssignments((previous) => ({ ...previous, [phase.phase]: event.target.value }))}>
          <option value="">请选择成员</option>{members.map((member) => <option key={member.slotId} value={member.slotId}>{member.role || member.assistantId}</option>)}
        </select></label>)}
        {routedPhases.filter(phase => phase.assignedAssistantId && !members.some(member => member.assistantId === phase.assignedAssistantId)).map(phase =>
          <p role="alert" key={phase.phase}>{phase.title}要求的助手（{phase.assignedAssistantId}）不在此团队版本中。请在团队配置中加入该助手并重新生成团队版本，或审核模板的阶段分配后发布新课程版本。</p>)}
      </div>}
      <details><summary>教学角色与知识范围配置</summary>
        <p>这里配置的是学生运行时真正消费的教学合同：课程阶段由哪个成员承接、使用哪个模型与 Skill、允许调用哪些工具/MCP，以及可访问哪些知识库。请先使用上方“生成教学配置”，通常无需手写 JSON；生成后核对摘要，再校验启用。</p>
        <p>知识库为空表示不授权任何库，不会自动继承管理员可访问的全部资料。团队配置完成不等于学生端已可用，还必须完成团队发布、教学包编译和绑定激活。</p>
        {!bundleText.trim() ? <p>尚未生成教学配置。完成团队版本与绑定后，选择课时和各阶段导师即可生成。</p> : <details><summary>高级：查看或编辑教学配置 JSON</summary>
        <textarea className="admin-input-text" aria-label="教学配置草稿" value={bundleText} disabled={busy || current?.binding.status !== 'draft'} onChange={(event) => setBundleText(event.target.value)} style={{ width: '100%', minHeight: 180, fontFamily: 'monospace' }} />
        <Button variant="secondary" size="sm" type="button" disabled={!current || current.binding.status !== 'draft' || busy || !bundleText.trim()} onClick={() => void act('bundle')}>保存教学配置</Button>
        </details>}
      </details>
      {requiresBundle && <ProjectBindingRecovery templateId={templateId} versionId={versionId} bindingId={active?.binding.id ?? null} ready={activeReady} />}
    </>}
    {busy && <p role="status">正在保存并核对服务器结果…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error} <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => setReload((value) => value + 1)}>重新加载</Button></p>}
  </section>;
}
