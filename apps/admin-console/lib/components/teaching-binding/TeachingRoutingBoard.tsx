import type { AdminTeamConfig, ProjectTemplateSpec, TeachingBundleDraft } from '@qitu/contracts';
import type { PublishedTeamMember } from '../../api/template-bindings';
import { publishedMemberName, routeSessionToMember } from './model';
import styles from './TeachingBinding.module.css';

type Profile = NonNullable<ProjectTemplateSpec['curriculum']>['profiles'][number];

export function TeachingRoutingBoard({ profile, phases, members, team, draft, assignments, editable, onAssign, onDraft, onSelectMember }: {
  profile?: Profile; phases: ProjectTemplateSpec['phases']; members: readonly PublishedTeamMember[]; team?: AdminTeamConfig;
  draft: TeachingBundleDraft | null; assignments: Readonly<Record<string, string>>; editable: boolean;
  onAssign: (phase: string, memberId: string) => void; onDraft: (draft: TeachingBundleDraft) => void;
  onSelectMember: (memberId: string) => void;
}) {
  return <section className={styles.routing} aria-label="课程与课时安排">
    <header className={styles.columnHeader}><h3>课程与课时安排</h3><span>{profile ? `${profile.sessions.length} 课时` : '尚未选择排期'}</span></header>
    {!profile ? <div className={styles.empty}>先选择课时排期，再为课程分配授课导师。</div> :
      <div className={styles.lessonTable}>
        <div className={styles.tableHeading}><span>阶段 / 课时</span><span>授课导师</span><span>时长</span></div>
        {phases.map((phase) => {
          const sessions = profile.sessions.filter((session) => session.phase === phase.phase);
          if (!sessions.length) return null;
          const fixedMember = phase.assignedAssistantId ? members.find((member) => member.assistantId === phase.assignedAssistantId) : undefined;
          const options = members.filter((member) => member.runtimeSnapshot && (!phase.assignedAssistantId || member.assistantId === phase.assignedAssistantId));
          return <section key={phase.phase} className={styles.phase} data-phase={phase.phase}>
            <div className={styles.phaseHeading}><strong>{phase.title}</strong><span>{sessions.length} 课时</span>
              {!draft && <label className={styles.phaseAssign}><span className={styles.srOnly}>{phase.title}的导师</span>
                <select aria-label={`${phase.title}的导师`} value={fixedMember?.slotId ?? assignments[phase.phase] ?? ''}
                  disabled={!editable || !!phase.assignedAssistantId} onChange={(event) => {
                    onAssign(phase.phase, event.target.value); onSelectMember(event.target.value);
                  }}>
                  <option value="">请选择成员</option>{members.map((member) => <option key={member.slotId} value={member.slotId}>
                    {publishedMemberName(member, team)} · {member.roleLabel || member.role || '导师'}</option>)}
                </select>
              </label>}
            </div>
            {phase.assignedAssistantId && !fixedMember && <p className={styles.issue} role="alert">指定助手 {phase.assignedAssistantId} 不在此团队版本中。</p>}
            {sessions.map((session) => {
              const route = draft?.sessionRoutes?.find((item) => item.sessionIndex === session.sessionIndex);
              const role = draft?.roleMap.find((item) => item.roleSlotId === route?.roleSlotId);
              const memberId = draft ? role?.memberId : fixedMember?.slotId ?? assignments[phase.phase];
              const member = members.find((item) => item.slotId === memberId);
              const routeUnavailable = !!draft && !!route && (!member || !options.some((item) => item.slotId === member.slotId));
              return <div className={styles.lesson} key={session.id}>
                <div className={styles.lessonTitle}><span className={styles.lessonIndex}>{session.sessionIndex}</span><span><strong>{session.title}</strong>
                  {session.learningGoal && <small>{session.learningGoal}</small>}</span></div>
                {draft ? <label><span className={styles.srOnly}>第{session.sessionIndex}课授课导师</span>
                  <select aria-label={`第${session.sessionIndex}课授课导师`} value={member?.slotId ?? ''} disabled={!editable || !options.length}
                    onFocus={() => { if (member) onSelectMember(member.slotId); }} onChange={(event) => {
                      const selected = options.find((item) => item.slotId === event.target.value);
                      if (selected) {
                        onDraft(routeSessionToMember(draft, session.sessionIndex, selected)); onSelectMember(selected.slotId);
                      }
                    }}>
                    <option value="">{routeUnavailable ? '当前角色不可用' : '未配置导师'}</option>
                    {routeUnavailable && member && <option value={member.slotId} disabled>{publishedMemberName(member, team)} · 不符合本阶段配置</option>}
                    {options.map((option) =>
                      <option key={option.slotId} value={option.slotId}>{publishedMemberName(option, team)}</option>)}
                  </select></label> : <button className={styles.memberLink} type="button" disabled={!member}
                    onClick={() => { if (member) onSelectMember(member.slotId); }}>{member ? publishedMemberName(member, team) : '待分配'}</button>}
                <span className={styles.duration}>{session.durationMinutes} 分钟</span>
              </div>;
            })}
          </section>;
        })}
      </div>}
  </section>;
}
