'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdminRuntimeSnapshot, AdminTeamConfig, ProjectTemplateSpec, TeachingBundleDraft } from '@qitu/contracts';
import { Button, VisualAsset } from '@qitu/ui';
import { createTemplateBinding, fetchTemplateBindings, fetchTeamVersions, publishTeamVersion, saveTemplateBundle, prepareTemplateBundle,
  transitionTemplateBinding, type TemplateTeamBinding, type PublishedTeamVersion } from '../api/template-bindings';
import { AdminApiError, AdminOfflineError, AdminPermissionError, newIdempotencyKey } from '../api/types';
import { fetchAdminTeamConfigs } from '../api/teams';
import { fetchRuntimeSnapshot } from '../api/runtime';
import { ProjectBindingRecovery } from './ProjectBindingRecovery';
import { TeachingBindingGuide } from './TeachingBindingGuide';
import { TeachingRoutingBoard } from './teaching-binding/TeachingRoutingBoard';
import { TeachingRoleInspector } from './teaching-binding/TeachingRoleInspector';
import { parseDraftPreview, publishedMemberName } from './teaching-binding/model';
import styles from './teaching-binding/TeachingBinding.module.css';

const LABELS = { draft: '草稿，尚未启用', validated: '已校验，待启用', active: '已生效', retired: '已停用' };
type Action = 'publish' | 'save' | 'bundle' | 'prepare' | 'validate' | 'activate';
type Failure = { kind: 'error' | 'offline' | 'permission' | 'stale'; message: string };
const failureView = (error: unknown): Failure => error instanceof AdminPermissionError ? { kind: 'permission', message: error.message }
  : error instanceof AdminOfflineError ? { kind: 'offline', message: '无法连接服务器，编辑内容已保留。' }
    : error instanceof AdminApiError && error.status === 409 ? { kind: 'stale', message: error.message }
      : { kind: 'error', message: error instanceof Error ? error.message : '操作未确认，请重试。' };

export function TemplateTeamBindingPanel({ templateId, versionId, teams, versionStatus, profiles, phases, requiresBundle }: {
  templateId: string; versionId: string | null; teams: AdminTeamConfig[]; versionStatus: string;
  profiles: NonNullable<ProjectTemplateSpec['curriculum']>['profiles'];
  requiresBundle: boolean; phases: ProjectTemplateSpec['phases'];
}) {
  const [records, setRecords] = useState<TemplateTeamBinding[]>([]);
  const [teamId, setTeamId] = useState('');
  const [versions, setVersions] = useState<PublishedTeamVersion[]>([]);
  const [teamVersionId, setTeamVersionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [catalogReady, setCatalogReady] = useState(false);
  const [versionsReady, setVersionsReady] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState('');
  const [bundleText, setBundleText] = useState('');
  const [staleDraft, setStaleDraft] = useState(false);
  const [reload, setReload] = useState(0);
  const [profileId, setProfileId] = useState(profiles.length === 1 ? profiles[0]?.id ?? '' : '');
  const [phaseAssignments, setPhaseAssignments] = useState<Record<string, string>>({});
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [runtime, setRuntime] = useState<AdminRuntimeSnapshot | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [online, setOnline] = useState(true);
  const generation = useRef(0);
  const actionInFlight = useRef(false);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const edits = useRef(new Map<string, { text: string; updatedAt: string }>());
  const current = records.filter((row) => row.binding.teamVersionId === teamVersionId && row.binding.status !== 'retired')
    .sort((a, b) => b.binding.createdAt.localeCompare(a.binding.createdAt))[0];
  const active = records.find((row) => row.binding.status === 'active');
  const activeReady = Boolean(active?.configurationReady);
  const selectedVersion = versions.find((row) => row.id === teamVersionId);
  const selectedPublished = selectedVersion?.runtimeSnapshotStatus === 'published';
  const canActivate = versionStatus === 'published' || versionStatus === 'piloting';
  const members = selectedVersion?.members ?? [];
  const team = teams.find((entry) => entry.id === teamId);
  const preview = useMemo(() => parseDraftPreview(bundleText), [bundleText]);
  const draft = preview.kind === 'ready' ? preview.draft : null;
  const profile = profiles.find((entry) => entry.id === (draft?.scheduleProfileId ?? profileId));
  const routedPhases = phases.filter((phase) => profile?.sessions.some((session) => session.phase === phase.phase));
  const assignmentsReady = routedPhases.every((phase) => phase.assignedAssistantId
    ? members.some((member) => member.assistantId === phase.assignedAssistantId)
    : members.some((member) => member.slotId === phaseAssignments[phase.phase]));
  const disabled = !!busy || loading || versionsLoading || !catalogReady || !versionsReady || !online || failure?.kind === 'permission';
  const editable = !disabled && selectedPublished && !staleDraft && (!current || current.binding.status === 'draft') && preview.kind !== 'invalid';
  const dirty = !!current && edits.current.has(current.binding.id);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  useEffect(() => {
    const request = ++generation.current;
    setLoading(true); setCatalogReady(false); setFailure(null); setNotice(''); setRecords([]); setTeamId(''); setTeamVersionId('');
    setBundleText(''); setStaleDraft(false); setPhaseAssignments({}); setProfileId(profiles.length === 1 ? profiles[0]?.id ?? '' : '');
    if (!versionId) { setLoading(false); return; }
    void fetchTemplateBindings(templateId, versionId).then((rows) => {
      if (request !== generation.current) return;
      const sorted = rows.slice().sort((a, b) => b.binding.createdAt.localeCompare(a.binding.createdAt));
      const selected = sorted.find((row) => row.binding.status !== 'retired');
      setCatalogReady(true); setRecords(sorted); setTeamId(selected?.team?.id ?? ''); setTeamVersionId(selected?.binding.teamVersionId ?? '');
    }).catch((error: unknown) => { if (request === generation.current) setFailure(failureView(error)); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [templateId, versionId, reload]);

  useEffect(() => {
    let live = true;
    setRuntime(null); setRuntimeError('');
    void fetchRuntimeSnapshot().then((value) => { if (live) setRuntime(value); }).catch((error: unknown) => {
      if (!live) return;
      const view = failureView(error); setRuntimeError(view.message);
      if (view.kind === 'permission') setFailure(view);
    });
    return () => { live = false; };
  }, [templateId, versionId, reload]);

  useEffect(() => {
    let live = true;
    setVersions([]); setVersionsReady(false);
    if (!teamId) { setVersionsLoading(false); return; }
    setVersionsLoading(true);
    void fetchTeamVersions(teamId).then((rows) => {
      if (!live) return;
      setVersions(rows); setVersionsReady(true);
      setTeamVersionId((id) => rows.some((row) => row.id === id) ? id : rows.find((row) => row.runtimeSnapshotStatus === 'published')?.id ?? '');
    }).catch((error: unknown) => { if (live) setFailure(failureView(error)); })
      .finally(() => { if (live) setVersionsLoading(false); });
    return () => { live = false; };
  }, [teamId]);

  useEffect(() => {
    if (!current) { setBundleText(''); setStaleDraft(false); return; }
    const local = edits.current.get(current.binding.id);
    setBundleText(local?.text ?? (current.binding.bundleDraft ? JSON.stringify(current.binding.bundleDraft, null, 2) : ''));
    setStaleDraft(!!local && local.updatedAt !== current.binding.updatedAt);
  }, [current?.binding.id, current?.binding.updatedAt]);

  function editText(text: string) {
    if (!current || current.binding.status !== 'draft') return;
    const previous = edits.current.get(current.binding.id);
    edits.current.set(current.binding.id, { text, updatedAt: previous?.updatedAt ?? current.binding.updatedAt });
    setBundleText(text); setNotice('');
  }
  function editDraft(next: TeachingBundleDraft) { if (editable) editText(JSON.stringify(next, null, 2)); }
  function discardEdits() {
    if (!current) return;
    edits.current.delete(current.binding.id); setStaleDraft(false);
    setBundleText(current.binding.bundleDraft ? JSON.stringify(current.binding.bundleDraft, null, 2) : '');
  }

  async function act(kind: Action) {
    if (actionInFlight.current || !versionId || !catalogReady || !online || failure?.kind === 'permission'
      || kind !== 'publish' && !versionsReady || staleDraft) return;
    const scope = generation.current;
    const signature = JSON.stringify({ kind, templateId, versionId, teamId, teamVersionId, bundleText, profileId, phaseAssignments });
    const replay = attempt.current?.signature === signature;
    if (!replay) attempt.current = { signature, key: newIdempotencyKey() };
    const key = attempt.current?.key;
    if (!key) return;
    actionInFlight.current = true; setBusy(kind); setFailure(null); setNotice('');
    try {
      if (kind === 'publish') {
        const latestTeam = (await fetchAdminTeamConfigs()).find((row) => row.id === teamId && row.enabled);
        if (scope !== generation.current) return;
        if (!latestTeam) throw new Error('请选择服务器目录中的团队。');
        const saved = await publishTeamVersion(teamId, latestTeam.updatedAt, key);
        const readback = await fetchTeamVersions(teamId);
        if (!readback.some((row) => row.id === saved.id && row.teamId === teamId && row.runtimeSnapshotStatus === 'published'
          && row.snapshotDigest === saved.snapshotDigest)) throw new Error('团队版本回读未确认，请重新加载核对。');
        if (scope !== generation.current) return;
        setVersions(readback); setVersionsReady(true); setTeamVersionId(saved.id); setNotice('团队版本已发布并回读确认。');
      } else {
        let expectedId: string;
        let expectedUpdatedAt: string | undefined;
        if (kind === 'save') {
          if (!selectedPublished) throw new Error('请先选择或发布团队版本。');
          expectedId = current?.binding.id ?? (await createTemplateBinding(templateId, versionId, teamVersionId, key)).binding.id;
        } else {
          if (!current) throw new Error('请先保存团队绑定。');
          expectedId = current.binding.id;
          if (!replay) {
            const latest = (await fetchTemplateBindings(templateId, versionId)).find((row) => row.binding.id === expectedId);
            if (scope !== generation.current) return;
            if (!latest || latest.binding.updatedAt !== current.binding.updatedAt) {
              setStaleDraft(true); throw new Error('服务器配置已更新，草稿已保留。请重新加载后核对，再决定是否舍弃本地编辑。');
            }
          }
          if (kind === 'prepare') {
            expectedUpdatedAt = (await prepareTemplateBundle(templateId, versionId, expectedId, profileId, key, phaseAssignments)).binding.updatedAt;
          } else if (kind === 'bundle') {
            if (preview.kind !== 'ready') throw new Error('请先修正教学配置。');
            expectedUpdatedAt = (await saveTemplateBundle(templateId, versionId, expectedId, preview.draft, key)).binding.updatedAt;
          } else {
            if (dirty) throw new Error('请先保存草稿，再校验和启用。');
            if (kind === 'validate' || current.binding.status === 'draft') {
              await transitionTemplateBinding(templateId, versionId, expectedId, 'validate', key + ':validate');
            }
            if (scope !== generation.current) return;
            if (kind === 'activate') await transitionTemplateBinding(templateId, versionId, expectedId, 'activate', key + ':activate');
          }
        }
        const rows = await fetchTemplateBindings(templateId, versionId);
        const saved = rows.find((row) => row.binding.id === expectedId);
        if (!saved || saved.binding.teamVersionId !== teamVersionId || saved.binding.templateVersionId !== versionId
          || kind === 'activate' && saved.binding.status !== 'active'
          || kind === 'validate' && (!saved.binding.validation.valid || saved.binding.status !== 'validated')) {
          throw new Error('保存后的服务器回读未确认，请重新加载核对。');
        }
        if (expectedUpdatedAt && (saved.binding.updatedAt !== expectedUpdatedAt || !saved.binding.bundleDraft)) throw new Error('教学配置回读未确认，编辑内容已保留。');
        if (scope !== generation.current) return;
        if (kind === 'bundle' || kind === 'prepare') edits.current.delete(expectedId);
        setRecords(rows);
        setNotice(kind === 'activate' ? '绑定已启用并回读确认。' : kind === 'validate' ? '配置已通过服务器校验，尚未启用。'
          : kind === 'prepare' ? '教学配置已生成并保存，请核对后启用。' : '草稿已保存并回读确认。');
      }
      attempt.current = null;
    } catch (error) { if (scope === generation.current) setFailure(failureView(error)); }
    finally { actionInFlight.current = false; setBusy(null); }
  }

  const selectedMember = members.find((member) => member.slotId === selectedMemberId) ?? members[0];
  const label = current ? LABELS[current.binding.status] : '尚未保存团队绑定';
  return <section className={styles.panel} aria-label="模板团队绑定" aria-busy={!!busy || loading}>
    <header className={styles.header}><div><div className={styles.eyebrow}>教学配置</div><h2><VisualAsset assetId="team-optics-v1" size={28} />教学编排台</h2>
      <p>安排每个课时的导师，核对教学方法与资料，检查后启用。</p></div>
      <span className={styles.status} data-active={current?.binding.status === 'active'}>{dirty ? '有未保存的编辑' : label}</span>
    </header>
    {!versionId ? <div className={styles.empty}>请先保存模板草稿版本，再配置导师团队。</div> : <>
      {requiresBundle && <TeachingBindingGuide published={selectedPublished} saved={!!current} draft={draft}
        ready={activeReady && current?.binding.id === active?.binding.id} canActivate={canActivate} />}
      <div className={styles.controls}>
        <label>导师团队<select aria-label="绑定导师团队" value={teamId} disabled={loading || !!busy || !catalogReady || !online || failure?.kind === 'permission'}
          onChange={(event) => { setFailure(null); setNotice(''); setTeamVersionId(''); setTeamId(event.target.value); setPhaseAssignments({}); }}>
          <option value="">请选择团队</option>{teams.filter((item) => item.enabled).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>团队版本<select aria-label="绑定团队版本" value={teamVersionId} disabled={loading || !!busy || versionsLoading || !online}
          onChange={(event) => { setNotice(''); setPhaseAssignments({}); setSelectedMemberId(''); setTeamVersionId(event.target.value); }}>
          <option value="">请选择团队版本</option>{versions.map((item) => <option key={item.id} value={item.id}>v{item.version}{item.runtimeSnapshotStatus !== 'published' ? ' · 历史版本' : ' · 已发布'}</option>)}
        </select></label>
        {profiles.length > 0 && <label>课时排期<select aria-label="绑定课时排期" value={draft?.scheduleProfileId ?? profileId}
          disabled={!!busy || !!current?.binding.bundleDraft || !online || loading || failure?.kind === 'permission'} onChange={(event) => setProfileId(event.target.value)}>
          <option value="">请选择排期</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.schedule.lessonCount} 课时 × {item.schedule.lessonMinutes} 分钟</option>)}
        </select></label>}
        <Button variant="secondary" size="sm" type="button" disabled={!teamId || loading || !!busy || versionsLoading || !catalogReady || !online || failure?.kind === 'permission'}
          onClick={() => void act('publish')}>生成当前团队版本</Button>
      </div>
      {!teams.some((item) => item.enabled) && !loading && <p className={styles.empty}>暂无可用团队，请先在团队配置中建立导师团队。</p>}
      {loading || versionsLoading ? <div className={styles.loading} role="status">正在读取教学安排…</div> : <div className={styles.workspace}>
        <aside className={styles.memberRail} aria-label="教学团队成员"><header className={styles.columnHeader}><h3>教学团队</h3><span>{members.length} 位导师</span></header>
          {!members.length ? <p className={styles.empty}>{teamId ? '请选择已发布的团队版本。' : '选择一个导师团队开始编排。'}</p> : members.map((member) => {
            const liveMember = team?.members.find((item) => item.assistantId === member.assistantId);
            const name = publishedMemberName(member, team);
            return <button key={member.slotId} type="button" className={styles.memberButton} aria-pressed={selectedMember?.slotId === member.slotId}
              onClick={() => setSelectedMemberId(member.slotId)}>
              {liveMember?.avatar?.startsWith('/') ? <img className={styles.avatar} src={liveMember.avatar} alt="" /> : <span className={styles.avatar}>{name.slice(0, 1)}</span>}
              <span><strong>{name}</strong><small>{member.roleLabel || member.role || '导师'}{selectedVersion?.leaderAssistantId === member.assistantId ? ' · 负责人' : ''}</small>
                <small>{member.runtimeSnapshot ? `${member.runtimeSnapshot.skills.length} 项发布技能` : '发布能力不可读取'}</small></span><span aria-hidden="true">›</span>
            </button>;
          })}
        </aside>
        <TeachingRoutingBoard profile={profile} phases={phases} members={members} team={team} draft={draft} assignments={phaseAssignments}
          editable={editable} onAssign={(phase, memberId) => setPhaseAssignments((previous) => ({ ...previous, [phase]: memberId }))}
          onDraft={editDraft} onSelectMember={setSelectedMemberId} />
        <TeachingRoleInspector member={selectedMember} team={team} draft={draft} catalog={runtime} editable={editable} onDraft={editDraft} />
      </div>}
      {runtimeError && <p className={styles.issue} role="status">能力目录读取失败：{runtimeError} 当前显示团队发布标识，能力选择暂不可用。</p>}
      {preview.kind === 'invalid' && <p className={styles.issue} role="alert">{preview.message}</p>}
      {staleDraft && <p className={styles.issue} role="alert">服务器配置已更新，本地编辑已保留。请核对高级配置，或舍弃编辑后重新加载。</p>}
      {selectedVersion && !selectedPublished && <p className={styles.issue}>所选为历史团队版本，请生成当前团队版本后继续绑定。</p>}
      {!canActivate && <p className={styles.muted}>当前课程版本可以保存配置，进入试点或发布后可启用。</p>}
      {!!current?.binding.validation.errors.length && <div className={styles.validation} role="alert"><strong>待处理的检查项</strong><ul>{current.binding.validation.errors.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></div>}
      {!!current?.binding.validation.warnings.length && <div className={styles.validation}><strong>检查提醒</strong><ul>{current.binding.validation.warnings.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></div>}
      <footer className={styles.actions}><span>{busy ? '正在保存并核对服务器结果…' : current?.binding.validation.checkedAt ? `最近校验：${new Date(current.binding.validation.checkedAt).toLocaleString('zh-CN')}` : '保存后可运行配置检查'}</span>
        <div>
          {!current && <Button variant="secondary" size="sm" type="button" disabled={disabled || !selectedPublished} onClick={() => void act('save')}>保存团队绑定</Button>}
          {requiresBundle && current && !current.binding.bundleDraft && <Button variant="secondary" size="sm" type="button"
            disabled={disabled || current.binding.status !== 'draft' || !profile || !assignmentsReady || !selectedPublished} onClick={() => void act('prepare')}>生成教学配置</Button>}
          {current?.binding.bundleDraft && <Button variant="secondary" size="sm" type="button" disabled={disabled || !dirty || !editable || !draft} onClick={() => void act('bundle')}>保存教学配置</Button>}
          <Button variant="secondary" size="sm" type="button" disabled={disabled || !current || current.binding.status !== 'draft' || dirty || staleDraft || requiresBundle && !draft}
            onClick={() => void act('validate')}>检查配置</Button>
          <Button size="sm" type="button" disabled={disabled || !canActivate || !current || current.binding.status === 'active' || dirty || staleDraft || requiresBundle && !draft}
            onClick={() => void act('activate')}>校验并启用绑定</Button>
        </div>
      </footer>
      <details className={styles.advanced}><summary>高级配置与历史项目恢复</summary>
        <p>这里保留完整教学合同。更改模型或新增技能，请先更新助手并发布新的团队版本。资料范围为空表示不授权。</p>
        {active && !activeReady && <p className={styles.issue}>当前生效绑定的教学配置尚未就绪，请核对团队发布、校验结果与编译摘要。旧项目需要单独确认恢复。</p>}
        <details><summary>查看或编辑教学配置 JSON</summary>
          <textarea aria-label="教学配置草稿" className={styles.json} value={bundleText} disabled={!!busy || current?.binding.status !== 'draft' || !online || failure?.kind === 'permission'}
            onChange={(event) => editText(event.target.value)} spellCheck={false} />
          <div className={styles.jsonActions}><Button variant="secondary" size="sm" type="button" disabled={disabled || !current || current.binding.status !== 'draft' || !draft || staleDraft}
            onClick={() => void act('bundle')}>保存教学配置</Button>
            <Button variant="secondary" size="sm" type="button" disabled={!!busy || !dirty} onClick={discardEdits}>舍弃本地编辑</Button></div>
        </details>
        {requiresBundle && <ProjectBindingRecovery templateId={templateId} versionId={versionId} bindingId={active?.binding.id ?? null} ready={activeReady} />}
      </details>
    </>}
    {!online && <p role="alert" className={styles.issue}>网络已断开，编辑内容已保留，联网后可重试。</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {failure && <div role="alert" className={styles.failure} data-kind={failure.kind}><strong>{failure.kind === 'permission' ? '无法访问教学配置' : failure.kind === 'stale' ? '配置需要重新核对' : '操作尚未确认'}</strong>
      <p>{failure.message}</p><Button variant="secondary" size="sm" type="button" disabled={!!busy || !online} onClick={() => setReload((value) => value + 1)}>重新加载</Button></div>}
  </section>;
}
