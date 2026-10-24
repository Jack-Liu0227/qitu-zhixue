'use client';

import { useEffect, useRef, useState } from 'react';
import type { AdminAssistantConfig, AdminTeamConfig, AdminTeamMemberInput, ProjectTemplateSpec } from '@qitu/contracts';
import { fetchAdminAssistantConfigs } from '../../api/assistants';
import { updatePersistedTeam } from '../../api/teams';
import { newIdempotencyKey } from '../../api/types';
import styles from './LessonDraftEditor.module.css';

const writableMember = (member: AdminTeamConfig['members'][number]): AdminTeamMemberInput => ({
  slotId: member.slotId, assistantId: member.assistantId, role: member.role, roleLabel: member.roleLabel,
  ...(member.model ? { model: member.model } : {}), ...(member.color ? { color: member.color } : {}),
  ...(member.pblPhase ? { pblPhase: member.pblPhase } : {}),
});

export function TeamRosterEditor({ team, spec, disabled, onSaved }: {
  team: AdminTeamConfig; spec: ProjectTemplateSpec; disabled: boolean; onSaved(team: AdminTeamConfig): void;
}) {
  const [catalog, setCatalog] = useState<AdminAssistantConfig[]>([]);
  const [members, setMembers] = useState<AdminTeamMemberInput[]>(() => team.members.map(writableMember));
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { setMembers(team.members.map(writableMember)); }, [team.id, team.updatedAt]);
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setCatalog([]);
    void fetchAdminAssistantConfigs().then(value => { if (active) setCatalog(value); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : '导师目录加载失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [team.id, reload]);
  const inUse = new Set(spec.curriculum?.profiles.flatMap(profile => profile.sessions.flatMap(lesson =>
    [lesson.leadAssistantId, ...(lesson.collaborators ?? []).map(member => member.assistantId)])) ?? []);
  const available = catalog.filter(assistant => assistant.enabled && assistant.teamSelectable && assistant.id !== 'qitu-intake-assistant'
    && !members.some(member => member.assistantId === assistant.id));
  async function save() {
    if (busy || disabled || loading) return;
    setBusy(true); setError(''); setNotice('');
    const signature = JSON.stringify({ id: team.id, updatedAt: team.updatedAt, members });
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: newIdempotencyKey() };
    try {
      const saved = await updatePersistedTeam(team.id, { members }, attempt.current.key, team.updatedAt);
      if (!live.current) return;
      onSaved(saved); attempt.current = null;
      setNotice('团队成员已保存并回读。请生成并绑定新的团队版本，再校验课程。');
    } catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : '团队保存未确认，请重试。'); }
    finally { if (live.current) setBusy(false); }
  }
  return <details className={styles.editor}><summary><strong>添加或编辑课程团队成员</strong> · {team.name}</summary>
    <p className={styles.note}>这里修改 Admin 的团队配置。已发布版本和旧项目保持冻结；新配置需重新发布并绑定。</p>
    {loading ? <p role="status">正在读取导师目录…</p> : null}
    {error ? <p role="alert">{error} <button type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>重新读取目录</button></p> : null}
    {!loading && !catalog.length && !error ? <p role="status">还没有可选导师，请先创建助手。</p> : null}
    <fieldset disabled={disabled || busy || loading || !catalog.length} style={{ border: 0, padding: 0 }}>
      {members.map((member, index) => <div key={member.slotId ?? member.assistantId} className={styles.grid}>
        <div><strong>{catalog.find(assistant => assistant.id === member.assistantId)?.name ?? team.members.find(entry => entry.assistantId === member.assistantId)?.assistantName ?? member.assistantId}</strong>
          {member.assistantId === team.leaderAssistantId ? <small> · 团队总导师</small> : null}
          <p><a href={`/settings/assistants?assistantId=${encodeURIComponent(member.assistantId)}`}>编辑助手能力 →</a></p></div>
        <label>团队内职责<input value={member.roleLabel ?? ''} maxLength={100} onChange={event => setMembers(previous => previous.map((entry, i) => i === index ? { ...entry, roleLabel: event.target.value } : entry))} />
          <button type="button" disabled={member.assistantId === team.leaderAssistantId || inUse.has(member.assistantId)}
            title={inUse.has(member.assistantId) ? '请先调整引用此导师的课时安排' : undefined}
            onClick={() => setMembers(previous => previous.filter((_, i) => i !== index))}>移出团队</button></label>
      </div>)}
      <div className={styles.grid}><label>添加已有助手<select value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">请选择导师</option>{available.map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name} · {assistant.role}</option>)}</select></label>
        <button type="button" disabled={!available.some(assistant => assistant.id === selected)} onClick={() => {
          const assistant = available.find(entry => entry.id === selected); if (!assistant) return;
          setMembers(previous => [...previous, { assistantId: assistant.id, role: 'coach', roleLabel: assistant.role }]); setSelected('');
        }}>添加到团队配置</button></div>
      <button type="button" onClick={() => void save()}>{busy ? '正在保存并回读…' : '保存团队成员'}</button>
    </fieldset><p><a href="/settings/assistants">创建新助手或管理模型与技能 →</a></p>
    {notice ? <p role="status">{notice}</p> : null}
  </details>;
}
