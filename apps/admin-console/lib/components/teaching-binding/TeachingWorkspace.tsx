'use client';

import { useState } from 'react';
import type { AdminRuntimeSnapshot, AdminTeamConfig, ProjectTemplateSpec, TeachingBundleDraft, TeachingSessionSelection } from '@qitu/contracts';
import { ResizablePanels } from '@qitu/ui';
import type { PublishedTeamVersion } from '../../api/template-bindings';
import { LessonDraftEditor } from './LessonDraftEditor';
import { SessionBindingEditor } from './SessionBindingEditor';
import { TeachingRoleInspector } from './TeachingRoleInspector';
import { TeamRosterEditor } from './TeamRosterEditor';
import styles from './TeachingBinding.module.css';

type Profile = NonNullable<ProjectTemplateSpec['curriculum']>['profiles'][number];

export function TeachingWorkspace({ spec, profile, teams, primaryTeamId, selections, versions, draft, runtime,
  editable, roleEditable, courseDisabled, onCourseChange, onSelections, onDraft, onTeamSaved }: {
  spec: ProjectTemplateSpec; profile?: Profile; teams: AdminTeamConfig[]; primaryTeamId: string;
  selections: readonly TeachingSessionSelection[]; versions: PublishedTeamVersion[];
  draft: TeachingBundleDraft | null; runtime: AdminRuntimeSnapshot | null;
  editable: boolean; roleEditable: boolean; courseDisabled: boolean;
  onCourseChange(spec: ProjectTemplateSpec): void; onSelections(value: readonly TeachingSessionSelection[]): void;
  onDraft(value: TeachingBundleDraft): void; onTeamSaved(team: AdminTeamConfig): void;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const [memberId, setMemberId] = useState('');
  const session = profile?.sessions.find(entry => entry.sessionIndex === index) ?? profile?.sessions[0];
  const selection = selections.find(entry => entry.sessionIndex === session?.sessionIndex);
  const team = teams.find(entry => entry.id === (selection?.teamId ?? primaryTeamId));
  const frozenId = draft?.sessionAssignments?.find(entry => entry.sessionIndex === session?.sessionIndex)?.teamVersionId;
  const snapshot = versions.find(entry => entry.id === frozenId && entry.teamId === team?.id)
    ?? versions.find(entry => entry.id === draft?.teamVersionId && entry.teamId === team?.id);
  const members = team?.members.filter(entry => entry.assistantId !== 'qitu-intake-assistant') ?? [];
  const member = members.find(entry => entry.assistantId === memberId)
    ?? members.find(entry => entry.assistantId === (selection?.kind === 'assistant' ? selection.assistantId : session?.leadAssistantId)) ?? members[0];
  return <ResizablePanels storageKey="admin-teaching-workspace-v2" className={styles.workspace}
    initialSizes={[23, 49, 28]} minWidths={[185, 340, 250]} labels={['课时目录', '课时内容', '导师与教学方法']}>
    <nav className={styles.memberRail} aria-label="课时目录">
      <header className={styles.columnHeader}><h3>课时目录</h3><span>{profile?.sessions.length ?? 0} 课时</span></header>
      {profile?.sessions.slice().sort((a, b) => a.sessionIndex - b.sessionIndex).map(lesson => <button
        key={lesson.id} type="button" className={styles.lessonChoice} aria-current={session?.id === lesson.id ? 'step' : undefined}
        onClick={() => { setIndex(lesson.sessionIndex); setMemberId(''); }}>
        <span>{String(lesson.sessionIndex).padStart(2, '0')}</span><span>{lesson.title}</span>
      </button>)}
      {!profile && <p className={styles.empty}>尚未配置课时排期。</p>}
    </nav>
    <div className={styles.lessonContent}>
      <SessionBindingEditor profile={profile} teams={teams} primaryTeamId={primaryTeamId} selections={selections}
        editable={editable} onChange={onSelections} sessionIndex={session?.sessionIndex} />
      {session && <LessonDraftEditor spec={spec} teams={teams} disabled={courseDisabled} onChange={onCourseChange}
        profileId={profile?.id} sessionIndex={session.sessionIndex} />}
    </div>
    <div className={styles.mentorContent}>
      <div className={styles.mentorSelect}><label>查看导师<select aria-label="查看导师" value={member?.assistantId ?? ''} onChange={event => setMemberId(event.target.value)}>
        {!members.length && <option value="">暂无可用导师</option>}
        {members.map(entry => <option key={entry.slotId} value={entry.assistantId}>{entry.assistantName}</option>)}
      </select></label></div>
      <TeachingRoleInspector member={snapshot?.members?.find(entry => entry.assistantId === member?.assistantId)} team={team}
        draft={draft} catalog={runtime} editable={roleEditable} onDraft={onDraft} compact />
      {team && <TeamRosterEditor key={team.id} team={team} spec={spec} disabled={courseDisabled} onSaved={onTeamSaved} />}
    </div>
  </ResizablePanels>;
}
