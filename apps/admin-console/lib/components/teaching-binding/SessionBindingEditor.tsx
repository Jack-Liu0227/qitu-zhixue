'use client';
import type { AdminTeamConfig, ProjectTemplateSpec, TeachingSessionSelection } from '@qitu/contracts';
import styles from './TeachingBinding.module.css';
type Profile = NonNullable<ProjectTemplateSpec['curriculum']>['profiles'][number];

export function SessionBindingEditor({ profile, teams, primaryTeamId, selections, editable, onChange }: {
  profile?: Profile; teams: readonly AdminTeamConfig[]; primaryTeamId: string;
  selections: readonly TeachingSessionSelection[]; editable: boolean;
  onChange(value: readonly TeachingSessionSelection[]): void;
}) {
  function assign(value: TeachingSessionSelection) {
    onChange([...selections.filter(entry => entry.sessionIndex !== value.sessionIndex), value].sort((a, b) => a.sessionIndex - b.sessionIndex));
  }
  const primary = teams.find(team => team.id === primaryTeamId && team.enabled);
  return <section className={styles.routing} aria-label="逐课助手与团队绑定">
    <header className={styles.columnHeader}><h3>逐课教学安排</h3><span>{profile?.sessions.length ?? 0} 课时</span></header>
    <p className={styles.muted}>直接使用团队管理中已有的团队和助手。每课可指定一位助手，或由团队负责人主讲并按本课安排协作。</p>
    {!teams.some(team => team.enabled) && <p className={styles.empty}>暂无可用团队，请先在团队管理中建立团队。</p>}
    {!profile ? <p className={styles.empty}>此课程尚无课时排期，请先补充课程的课时安排。</p> : <>
      <button type="button" disabled={!editable || !primary} onClick={() => {
        if (primary) onChange(profile.sessions.map(session => ({ sessionIndex: session.sessionIndex, teamId: primary.id, kind: 'team' })));
      }}>全部课时使用上方团队</button>
      {profile.sessions.slice().sort((a, b) => a.sessionIndex - b.sessionIndex).map(session => {
        const selected = selections.find(entry => entry.sessionIndex === session.sessionIndex);
        const team = teams.find(entry => entry.id === selected?.teamId && entry.enabled);
        const members = team?.members.filter(member => member.assistantId !== 'qitu-intake-assistant') ?? [];
        return <div className={styles.phase} key={session.id}>
          <div className={styles.phaseHeading}><strong>第 {session.sessionIndex} 课 · {session.title}</strong><span>{session.durationMinutes} 分钟</span></div>
          <div className={styles.controls}>
            <label>团队<select aria-label={`第${session.sessionIndex}课团队`} value={selected?.teamId ?? ''} disabled={!editable}
              onChange={event => { if (event.target.value) assign({ sessionIndex: session.sessionIndex, teamId: event.target.value, kind: 'team' }); }}>
              <option value="">请选择已有团队</option>
              {selected && !team && <option value={selected.teamId} disabled>原团队已不可用</option>}
              {teams.filter(entry => entry.enabled).map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select></label>
            <label>教学者<select aria-label={`第${session.sessionIndex}课助手或团队`} value={!selected ? '' : selected.kind === 'team' ? 'team' : `assistant:${selected.assistantId}`} disabled={!editable || !team}
              onChange={event => { if (team) assign(event.target.value === 'team'
                ? { sessionIndex: session.sessionIndex, teamId: team.id, kind: 'team' }
                : { sessionIndex: session.sessionIndex, teamId: team.id, kind: 'assistant', assistantId: event.target.value.slice('assistant:'.length) }); }}>
              {!selected && <option value="">请选择</option>}
              <option value="team">团队 · 负责人主讲</option>
              {selected?.kind === 'assistant' && !members.some(member => member.assistantId === selected.assistantId) && <option value={`assistant:${selected.assistantId}`} disabled>原助手已不在团队中</option>}
              {members.map(member => <option key={member.slotId} value={`assistant:${member.assistantId}`}>助手 · {member.assistantName}</option>)}
            </select></label>
          </div>
          {session.learningGoal && <p className={styles.muted}>{session.learningGoal}</p>}
        </div>;
      })}
    </>}
  </section>;
}
