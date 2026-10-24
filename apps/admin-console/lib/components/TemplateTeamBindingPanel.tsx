'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AdminRuntimeSnapshot, AdminTeamConfig, ProjectTemplateSpec, TeachingBundleDraft, TeachingSessionSelection } from '@qitu/contracts';
import { Button, VisualAsset, ResizablePanels } from '@qitu/ui';
import Link from 'next/link';
import { fetchTemplateBindings, fetchBindingTeamSnapshots, saveTemplateBundle, prepareCurrentTeachingArrangement,
  transitionTemplateBinding, type TemplateTeamBinding, type PublishedTeamVersion } from '../api/template-bindings';
import { AdminApiError, AdminOfflineError, AdminPermissionError, newIdempotencyKey } from '../api/types';
import { fetchAdminTeamConfigs } from '../api/teams';
import { fetchRuntimeSnapshot } from '../api/runtime';
import { ProjectBindingRecovery } from './ProjectBindingRecovery';
import { TeachingWorkspace } from './teaching-binding/TeachingWorkspace';
import { SessionBindingEditor } from './teaching-binding/SessionBindingEditor';
import { TeachingRoleInspector } from './teaching-binding/TeachingRoleInspector';
import { initialSessionAssignments, parseDraftPreview, publishedMemberName, sessionSelectionsFromSnapshots } from './teaching-binding/model';
import { canonicalCourseJson } from './teaching-binding/lesson-draft';
import styles from './teaching-binding/TeachingBinding.module.css';

const LABELS = { draft: '待启用', validated: '已校验，待启用', active: '已生效', retired: '已停用' };
type Action = 'bundle' | 'prepare' | 'validate' | 'activate';
type Failure = { kind: 'error' | 'offline' | 'permission' | 'stale'; message: string };
const failureView = (error: unknown): Failure => error instanceof AdminPermissionError ? { kind: 'permission', message: error.message }
  : error instanceof AdminOfflineError ? { kind: 'offline', message: '无法连接服务器，编辑内容已保留。' }
    : error instanceof AdminApiError && error.status === 409 ? { kind: 'stale', message: error.message }
      : { kind: 'error', message: error instanceof Error ? error.message : '操作未确认，请重试。' };

export function TemplateTeamBindingPanel({ templateId, versionId, teams: initialTeams, versionStatus, profiles, phases, requiresBundle,
  courseSpec, courseDirty = false, courseDisabled = false, onCourseChange, versionControls }: {
  lessonPolicy?: ProjectTemplateSpec['lessonPolicy'];
  templateId: string; versionId: string | null; teams: AdminTeamConfig[]; versionStatus: string;
  profiles: NonNullable<ProjectTemplateSpec['curriculum']>['profiles'];
  requiresBundle: boolean; phases: ProjectTemplateSpec['phases'];
  courseSpec?: ProjectTemplateSpec; courseDirty?: boolean; courseDisabled?: boolean;
  onCourseChange?(spec: ProjectTemplateSpec): void; versionControls?: ReactNode;
}) {
  const [records, setRecords] = useState<TemplateTeamBinding[]>([]);
  const [teams, setTeams] = useState(initialTeams);
  const [teamId, setTeamId] = useState('');
  const [versions, setVersions] = useState<PublishedTeamVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogReady, setCatalogReady] = useState(false);
  const [versionsReady, setVersionsReady] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [snapshotIssue, setSnapshotIssue] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState('');
  const [bundleText, setBundleText] = useState('');
  const [staleDraft, setStaleDraft] = useState(false);
  const [reload, setReload] = useState(0);
  const [profileId, setProfileId] = useState(profiles.length === 1 ? profiles[0]?.id ?? '' : '');
  const [sessionAssignments, setSessionAssignments] = useState<readonly TeachingSessionSelection[] | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [runtime, setRuntime] = useState<AdminRuntimeSnapshot | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [online, setOnline] = useState(true);
  const generation = useRef(0);
  const actionInFlight = useRef(false);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const edits = useRef(new Map<string, { text: string; updatedAt: string }>());
  const current = records.filter((row) => row.team?.id === teamId && row.binding.status !== 'retired')
    .sort((a, b) => b.binding.createdAt.localeCompare(a.binding.createdAt))[0];
  const teamVersionId = current?.binding.teamVersionId ?? '';
  const active = records.find((row) => row.binding.status === 'active');
  const activeReady = Boolean(active?.configurationReady) && (!requiresBundle || active?.teachingReadiness?.lessonCompletionReady !== false);
  const activeBlockers = active ? [
    !active.binding.validation.valid ? '服务端绑定校验未通过' : null,
    active.team?.runtimeSnapshotStatus !== 'published' ? '旧教学安排尚未记录完整团队配置，请重新保存' : null,
    !active.binding.bundleDraft ? '缺少教学配置方案' : null,
    !active.binding.bundleDigest ? '缺少服务端编译后的教学包 digest' : null,
    requiresBundle && active.teachingReadiness?.lessonCompletionReady === false ? '缺少逐课完成规则，需创建新的课程版本' : null,
  ].filter((item): item is string => item !== null) : [];
  const selectedVersion = versions.find((row) => row.id === teamVersionId);
  const canActivate = versionStatus === 'published' || versionStatus === 'piloting';
  const team = teams.find((entry) => entry.id === teamId);
  const members = team?.members ?? [];
  const preview = useMemo(() => parseDraftPreview(bundleText), [bundleText]);
  const draft = preview.kind === 'ready' ? preview.draft : null;
  const profile = profiles.find((entry) => entry.id === (draft?.scheduleProfileId ?? profileId));
  const lessonAssignments = sessionAssignments ?? sessionSelectionsFromSnapshots(
    initialSessionAssignments(profile, phases, selectedVersion?.members ?? [], teamVersionId, draft), versions);
  const assignmentsReady = versionsReady && !!profile && profile.sessions.every(session => lessonAssignments.some(entry => entry.sessionIndex === session.sessionIndex));
  const routingDirty = sessionAssignments !== null;
  const disabled = !!busy || loading || versionsLoading || !catalogReady || !versionsReady || !online || courseDirty || courseDisabled || failure?.kind === 'permission';
  const editable = !disabled && !!team?.enabled && !staleDraft && preview.kind !== 'invalid';
  const dirty = !!current && edits.current.has(current.binding.id);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  useEffect(() => {
    const request = ++generation.current;
    setLoading(true); setCatalogReady(false); setFailure(null); setNotice(''); setRecords([]); setTeamId('');
    setBundleText(''); setStaleDraft(false); setProfileId(profiles.length === 1 ? profiles[0]?.id ?? '' : '');
    setSessionAssignments(null);
    if (!versionId) { setLoading(false); return; }
    void Promise.all([fetchTemplateBindings(templateId, versionId), fetchAdminTeamConfigs()]).then(([rows, catalog]) => {
      if (request !== generation.current) return;
      const sorted = rows.slice().sort((a, b) => b.binding.createdAt.localeCompare(a.binding.createdAt));
      const selected = sorted.find((row) => row.binding.status === 'active') ?? sorted.find((row) => row.binding.status !== 'retired');
      setCatalogReady(true); setTeams(catalog); setRecords(sorted); setTeamId(selected?.team?.id ?? '');
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
    setVersions([]); setVersionsReady(false); setSnapshotIssue(false);
    if (!current || !versionId) { setVersionsReady(true); setVersionsLoading(false); return; }
    setVersionsLoading(true);
    void fetchBindingTeamSnapshots(templateId, versionId, current.binding.id).then((result) => {
      if (!live) return;
      setVersions(result.versions); setSnapshotIssue(result.issues.length > 0); setVersionsReady(true);
    }).catch((error: unknown) => { if (live) setFailure(failureView(error)); })
      .finally(() => { if (live) setVersionsLoading(false); });
    return () => { live = false; };
  }, [templateId, versionId, current?.binding.id, current?.binding.updatedAt, reload]);

  useEffect(() => {
    setSessionAssignments(null);
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
    if (actionInFlight.current || !versionId || disabled || staleDraft) return;
    const scope = generation.current;
    const source = current ?? active;
    const signature = JSON.stringify({ kind, templateId, versionId, teamId, source: source?.binding.id, bundleText, profileId, lessonAssignments });
    const replay = attempt.current?.signature === signature;
    if (!replay) attempt.current = { signature, key: newIdempotencyKey() };
    const key = attempt.current?.key;
    if (!key) return;
    actionInFlight.current = true; setBusy(kind); setFailure(null); setNotice('');
    try {
      let expectedId: string;
      let expectedUpdatedAt: string | undefined;
      if (kind === 'prepare') {
        if (!assignmentsReady || dirty || !team?.enabled) throw new Error('请先完成逐课选择，并保存或舍弃资料配置编辑。');
        const selectedTeams = [...new Set([teamId, ...lessonAssignments.map(item => item.teamId)])].map(id => {
          const selected = teams.find(item => item.id === id && item.enabled);
          if (!selected) throw new Error('所选团队已不可用，请重新加载。');
          return { teamId: selected.id, expectedUpdatedAt: selected.updatedAt };
        });
        const result = await prepareCurrentTeachingArrangement(templateId, versionId, {
          teamId, scheduleProfileId: draft?.scheduleProfileId ?? profileId, sessions: lessonAssignments, teams: selectedTeams,
          ...(source ? { sourceBinding: { id: source.binding.id, updatedAt: source.binding.updatedAt } } : {}),
        }, key);
        expectedId = result.binding.id; expectedUpdatedAt = result.binding.updatedAt;
      } else {
        if (!current) throw new Error('请先保存教学安排。');
        expectedId = current.binding.id;
        if (!replay) {
          const latest = (await fetchTemplateBindings(templateId, versionId)).find(row => row.binding.id === expectedId);
          if (scope !== generation.current) return;
          if (!latest || latest.binding.updatedAt !== current.binding.updatedAt) {
            setStaleDraft(true); throw new Error('服务器配置已更新，编辑内容已保留，请重新加载后核对。');
          }
        }
        if (kind === 'bundle') {
          if (preview.kind !== 'ready') throw new Error('请先修正教学配置。');
          expectedUpdatedAt = (await saveTemplateBundle(templateId, versionId, expectedId, preview.draft, key)).binding.updatedAt;
        } else {
          if (dirty || routingDirty) throw new Error('请先保存教学安排和资料配置。');
          if (kind === 'validate' || current.binding.status === 'draft') await transitionTemplateBinding(templateId, versionId, expectedId, 'validate', key + ':validate');
          if (scope !== generation.current) return;
          if (kind === 'activate') await transitionTemplateBinding(templateId, versionId, expectedId, 'activate', key + ':activate');
        }
      }
      const rows = await fetchTemplateBindings(templateId, versionId);
      const saved = rows.find(row => row.binding.id === expectedId);
      if (!saved || saved.team?.id !== teamId || saved.binding.templateVersionId !== versionId
        || kind === 'activate' && saved.binding.status !== 'active'
        || kind === 'validate' && (!saved.binding.validation.valid || saved.binding.status !== 'validated')
        || expectedUpdatedAt && (saved.binding.updatedAt !== expectedUpdatedAt || !saved.binding.bundleDraft)) {
        throw new Error('服务器回读未确认，编辑内容已保留，请重试。');
      }
      if (kind === 'prepare') {
        const snapshots = await fetchBindingTeamSnapshots(templateId, versionId, expectedId);
        if (snapshots.issues.length) throw new Error('新教学安排的团队配置未通过回读校验，请重试。');
        const latestVersions = snapshots.versions;
        const confirmed = sessionSelectionsFromSnapshots(saved.binding.bundleDraft?.sessionAssignments ?? [], latestVersions);
        const ordered = (items: readonly TeachingSessionSelection[]) => items.slice().sort((a, b) => a.sessionIndex - b.sessionIndex);
        if (canonicalCourseJson(ordered(confirmed)) !== canonicalCourseJson(ordered(lessonAssignments))) throw new Error('逐课安排回读未确认，选择已保留。');
        if (scope !== generation.current) return;
        setVersions(latestVersions);
      }
      if (scope !== generation.current) return;
      if (kind === 'bundle') edits.current.delete(expectedId);
      setRecords(rows); setSessionAssignments(null);
      setNotice(kind === 'activate' ? '教学安排已启用并回读确认。' : kind === 'validate' ? '配置已通过服务器校验，尚未启用。'
        : kind === 'prepare' ? '教学安排已保存，请核对资料范围后启用。' : '教学配置已保存并回读确认。');
      attempt.current = null;
    } catch (error) { if (scope === generation.current) setFailure(failureView(error)); }
    finally { actionInFlight.current = false; setBusy(null); }
  }

  const selectedMember = members.find((member) => member.slotId === selectedMemberId) ?? members[0];
  const label = current ? LABELS[current.binding.status] : '待配置';
  return <section className={styles.panel} aria-label="教学编排台" aria-busy={!!busy || loading}>
    <header className={styles.header}><div><h2>教学编排台</h2>
      <p>{courseSpec?.theme?.drivingQuestion ?? '选择课时，安排内容、导师和教学方法。'}</p></div>
      <span className={styles.status} data-active={current?.binding.status === 'active'}>{courseDirty || dirty || routingDirty ? '有未保存的修改' : label}</span>
    </header>
    {!versionId ? <div className={styles.empty}>请先保存模板版本，再配置导师团队。</div> : <>
      {courseDirty && <p className={styles.issue} role="status">课时内容已修改，请先保存课程配置，再启用新版本的教学安排。</p>}
      <div className={styles.controls}>
        <label>默认导师团队<select aria-label="绑定导师团队" value={teamId} disabled={loading || !!busy || !catalogReady || !online || failure?.kind === 'permission'}
          onChange={(event) => { setFailure(null); setNotice(''); setSessionAssignments(null); setTeamId(event.target.value); }}>
          <option value="">请选择团队</option>{teams.filter((item) => item.enabled).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        {profiles.length > 0 && <label>课时排期<select aria-label="绑定课时排期" value={draft?.scheduleProfileId ?? profileId}
          disabled={!!busy || !!current?.binding.bundleDraft || !online || loading || failure?.kind === 'permission'} onChange={(event) => { setSessionAssignments(null); setProfileId(event.target.value); }}>
          <option value="">请选择排期</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.schedule.lessonCount} 课时 × {item.schedule.lessonMinutes} 分钟</option>)}
        </select></label>}
      </div>
      {!teams.some((item) => item.enabled) && !loading && <p className={styles.empty}>暂无可用团队，请先在团队配置中建立导师团队。</p>}
      {loading || versionsLoading ? <div className={styles.loading} role="status">正在读取教学安排…</div> : courseSpec && onCourseChange ? <TeachingWorkspace
        spec={courseSpec} profile={profile} teams={teams} primaryTeamId={teamId} selections={lessonAssignments} versions={versions}
        draft={draft} runtime={runtime} editable={editable} roleEditable={editable && current?.binding.status === 'draft'}
        courseDisabled={courseDisabled || !online || failure?.kind === 'permission'} onCourseChange={onCourseChange}
        onSelections={setSessionAssignments} onDraft={editDraft} onTeamSaved={saved => setTeams(previous => previous.map(entry => entry.id === saved.id ? saved : entry))} /> : <ResizablePanels storageKey="admin-teaching-arrangement"
        className={styles.workspace} initialSizes={[22, 47, 31]} minWidths={[180, 300, 240]} labels={['默认团队', '逐课安排', '导师能力']}>
        <aside className={styles.memberRail} aria-label="教学团队成员">
          <header className={styles.columnHeader}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <h3>默认团队</h3>
              <span>{members.length} 位导师</span>
            </div>
            {teamId ? (
              <Link
                href={`/settings/teams?teamId=${encodeURIComponent(teamId)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '12px',
                  color: '#165dff',
                  textDecoration: 'none',
                  padding: '2px 8px',
                  background: '#f2f3f5',
                  borderRadius: '4px',
                  border: '1px solid #e5e6eb',
                }}
                title="在新窗口打开团队管理，可增删导师成员与调整职责"
              >
                👥 编辑团队 ↗
              </Link>
            ) : null}
          </header>
          {!members.length ? <p className={styles.empty}>{teamId ? '团队尚无助手，请在团队管理中添加。' : '选择一个导师团队开始编排。'}</p> : members.map((member) => {
            const liveMember = team?.members.find((item) => item.assistantId === member.assistantId);
            const name = publishedMemberName(member, team);
            return <button key={member.slotId} type="button" className={styles.memberButton} aria-pressed={selectedMember?.slotId === member.slotId}
              onClick={() => setSelectedMemberId(member.slotId)}>
              {liveMember?.avatar?.startsWith('/') ? <img className={styles.avatar} src={liveMember.avatar} alt="" /> : <span className={styles.avatar}>{name.slice(0, 1)}</span>}
              <span><strong>{name}</strong><small>{member.roleLabel || member.role || '导师'}{team?.leaderAssistantId === member.assistantId ? ' · 负责人' : ''}</small></span><span aria-hidden="true">›</span>
            </button>;
          })}
        </aside>
        <SessionBindingEditor profile={profile} teams={teams} primaryTeamId={teamId} selections={lessonAssignments}
          editable={editable} onChange={setSessionAssignments} />
        <TeachingRoleInspector member={selectedVersion?.members?.find(member => member.assistantId === selectedMember?.assistantId)} team={team} draft={draft} catalog={runtime}
          editable={editable && current?.binding.status === 'draft'} onDraft={editDraft} />
      </ResizablePanels>}
      {snapshotIssue && <p className={styles.issue} role="status">旧教学安排的团队配置无法验证，请重新选择课次并保存教学安排。历史项目不会自动切换到新安排。</p>}
      {runtimeError && <p className={styles.issue} role="status">能力目录读取失败：{runtimeError} 当前仅显示已保存的教学配置，能力选择暂不可用。</p>}
      {preview.kind === 'invalid' && <p className={styles.issue} role="alert">{preview.message}</p>}
      {staleDraft && <p className={styles.issue} role="alert">服务器配置已更新，本地编辑已保留。请核对高级配置，或舍弃编辑后重新加载。</p>}
      {(current?.binding.status === 'active' || current?.binding.status === 'validated') && <p className={styles.muted}>修改后保存会生成新的教学安排，已有学生项目保持原安排。</p>}
      {!canActivate && <p className={styles.muted}>当前课程版本尚未上架，请在高级设置中上架后启用。</p>}
      {!!current?.binding.validation.errors.length && <div className={styles.validation} role="alert"><strong>待处理的检查项</strong><ul>{current.binding.validation.errors.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></div>}
      {!!current?.binding.validation.warnings.length && <div className={styles.validation}><strong>检查提醒</strong><ul>{current.binding.validation.warnings.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></div>}
      <footer className={styles.actions}><span>{busy ? '正在保存并核对服务器结果…' : current?.binding.validation.checkedAt ? `最近校验：${new Date(current.binding.validation.checkedAt).toLocaleString('zh-CN')}` : '保存后可运行配置检查'}</span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" type="button" disabled={disabled || dirty || !editable || !assignmentsReady}
            onClick={() => void act('prepare')}>保存教学安排</Button>
          {current?.binding.bundleDraft && <Button variant="secondary" size="sm" type="button" disabled={disabled || !dirty || !editable || !draft || current.binding.status !== 'draft'} onClick={() => void act('bundle')}>保存教学配置</Button>}
          <Button variant="secondary" size="sm" type="button" disabled={disabled || !current || current.binding.status !== 'draft' || dirty || routingDirty || staleDraft || requiresBundle && !draft}
            onClick={() => void act('validate')}>检查配置</Button>
          <Button size="sm" type="button" disabled={disabled || !canActivate || !current || current.binding.status === 'active' || dirty || routingDirty || staleDraft || requiresBundle && !draft}
            onClick={() => void act('activate')}>启用教学安排</Button>
        </div>
      </footer>
      <details className={styles.advanced}><summary>高级设置与历史记录</summary>
        {versionControls}
        <p>这里保留完整教学合同。团队与助手调整后重新保存教学安排即可，资料范围为空表示不授权。</p>
        {active && !activeReady && <div className={styles.issue} role="alert">
          <p>当前历史绑定缺少完整教学配置，学生项目暂时无法使用。未就绪项：{activeBlockers.join('；') || '服务端未返回具体原因'}。</p>
          <p>处理顺序：选择已有团队 → 逐课选择助手或团队 → 保存教学安排 → 校验并启用。旧项目不会被自动改写。</p>
          <p>旧项目需要单独确认恢复。</p>
        </div>}
        <details><summary>查看或编辑教学配置 JSON</summary>
          <textarea aria-label="教学配置方案" className={styles.json} value={bundleText} disabled={!!busy || current?.binding.status !== 'draft' || !online || failure?.kind === 'permission'}
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
