'use client';

import { useState } from 'react';
import type { AdminTeamConfig, LessonActivity, PblTemplateSession, ProjectTemplateSpec } from '@qitu/contracts';
import styles from './LessonDraftEditor.module.css';

// Wording is a view projection; the frozen spec and its digest stay unchanged.
const displayText = (text: string) => text.replaceAll('探索草稿', '探索记录').replaceAll('草稿', '创作稿');

const ACTIVITIES: readonly { id: LessonActivity; label: string }[] = [
  { id: 'review', label: '回顾' }, { id: 'theory', label: '探究与讲解' }, { id: 'check', label: '检查理解' },
  { id: 'practice', label: '实践取证' }, { id: 'reflect', label: '反思' },
];

export function LessonDraftEditor({ spec, teams, disabled, onChange, profileId, sessionIndex }: {
  spec: ProjectTemplateSpec; teams: readonly AdminTeamConfig[]; disabled: boolean; onChange(spec: ProjectTemplateSpec): void;
  profileId?: string; sessionIndex?: number;
}) {
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const profiles = spec.curriculum?.profiles ?? [];
  const profile = profiles.find(entry => entry.id === (profileId ?? selectedProfileId)) ?? profiles[0];
  const team = teams.find(entry => entry.id === spec.teamId) ?? teams[0];
  const members = (team?.members && team.members.length > 0 ? team.members : teams.flatMap(t => t.members)).filter(entry => entry.assistantId !== 'qitu-intake-assistant');
  if (!profile) return <p role="status">尚未配置课时排期。</p>;
  function update(lessonId: string, patch: Partial<PblTemplateSession>) {
    if (disabled || !spec.curriculum || !profile) return;
    onChange({ ...spec, curriculum: { ...spec.curriculum, profiles: profiles.map(entry => entry.id === profile.id
      ? { ...entry, sessions: entry.sessions.map(lesson => lesson.id === lessonId ? { ...lesson, ...patch } : lesson) } : entry) } });
  }
  function name(id: string) { return members.find(entry => entry.assistantId === id)?.assistantName ?? id; }
  const focused = sessionIndex !== undefined;
  return <section className={`${styles.editor} ${focused ? styles.embedded : ''}`} aria-label="编辑课时课程配置">
    {!focused && <header><div><h3>逐课教学设计</h3><p>修改保存在新课程版本中，启用教学安排后供新项目使用。</p></div>
      <a href="/settings/teams">管理导师团队与成员 →</a></header>}
    {!members.length ? <p role="alert">课程团队尚未加载，暂不能选择导师。请先在团队管理中配置真实成员。</p> : null}
    {!focused && profiles.length > 1 ? <label>课时安排<select value={profile.id} onChange={event => setSelectedProfileId(event.target.value)}>
      {profiles.map(entry => <option key={entry.id} value={entry.id}>{entry.id}</option>)}</select></label> : null}
    {profile.sessions.filter(lesson => !focused || lesson.sessionIndex === sessionIndex).map(lesson => <details key={lesson.id} className={styles.lesson} open={focused ? true : undefined}>
      <summary hidden={focused}><strong>第 {lesson.sessionIndex} 课 · {lesson.title}</strong><span>{name(lesson.leadAssistantId ?? '') || '待安排导师'} · {lesson.durationMinutes} 分钟</span></summary>
      <fieldset disabled={disabled}><div className={styles.grid}>
        <label>课时名称<input value={displayText(lesson.title)} maxLength={200} onChange={event => update(lesson.id, { title: event.target.value })} /></label>
        <label>课程预设导师<select value={lesson.leadAssistantId ?? ''} disabled={!members.length} onChange={event => update(lesson.id, { leadAssistantId: event.target.value })}>
          <option value="">未指定主讲导师</option>
          {lesson.leadAssistantId && !members.some(m => m.assistantId === lesson.leadAssistantId) ? (
            <option value={lesson.leadAssistantId}>{lesson.leadAssistantId}（当前设定）</option>
          ) : null}
          {members.map(member => <option key={member.assistantId} value={member.assistantId}>{member.assistantName} · {member.roleLabel ?? member.role}</option>)}</select></label>
      </div>
      <label>学习目标<textarea value={displayText(lesson.learningGoal ?? '')} maxLength={1000} onChange={event => update(lesson.id, { learningGoal: event.target.value })} /></label>
      {lesson.opening ? <details className={styles.opening}><summary>首轮开场</summary>
        <label>观察情境<textarea value={displayText(lesson.opening.scenario)} maxLength={1000} onChange={event => update(lesson.id, { opening: { ...lesson.opening!, scenario: event.target.value } })} /></label>
        <label>第一个问题<textarea value={displayText(lesson.opening.prompt)} maxLength={500} onChange={event => update(lesson.id, { opening: { ...lesson.opening!, prompt: event.target.value } })} /></label>
        {lesson.opening.options.map((option, index) => <div key={option.id} className={styles.grid}>
          <label>选项 {index + 1}<input value={displayText(option.label)} maxLength={80} onChange={event => update(lesson.id, { opening: { ...lesson.opening!, options: lesson.opening!.options.map(entry => entry.id === option.id ? { ...entry, label: event.target.value } : entry) } })} /></label>
          <label>学生选择后发送的内容<input value={displayText(option.text)} maxLength={500} onChange={event => update(lesson.id, { opening: { ...lesson.opening!, options: lesson.opening!.options.map(entry => entry.id === option.id ? { ...entry, text: event.target.value } : entry) } })} /></label>
        </div>)}
      </details> : null}
      <h4>活动指导</h4>{ACTIVITIES.filter(activity => lesson.blocks[activity.id] > 0).map(activity => <label key={activity.id}>{activity.label} · {lesson.blocks[activity.id]} 分钟
        <textarea value={displayText(lesson.activityGuidance?.[activity.id] ?? '')} maxLength={1500} onChange={event => update(lesson.id, { activityGuidance: { ...lesson.activityGuidance, [activity.id]: event.target.value } })} /></label>)}
      <h4>按需协作</h4>{(lesson.collaborators ?? []).map((collaborator, index) => <div className={styles.collaboration} key={`${lesson.id}:${index}`}>
        <label>协作导师<select value={collaborator.assistantId} onChange={event => update(lesson.id, { collaborators: lesson.collaborators!.map((entry, i) => i === index ? { ...entry, assistantId: event.target.value } : entry) })}>
          {collaborator.assistantId && !members.some(m => m.assistantId === collaborator.assistantId) ? (
            <option value={collaborator.assistantId}>{collaborator.assistantId}（当前设定）</option>
          ) : null}
          {members.filter(member => member.assistantId !== lesson.leadAssistantId).map(member => <option key={member.assistantId} value={member.assistantId}>{member.assistantName}</option>)}</select></label>
        <label>参与活动<select value={collaborator.activity} onChange={event => update(lesson.id, { collaborators: lesson.collaborators!.map((entry, i) => i === index ? { ...entry, activity: event.target.value as LessonActivity } : entry) })}>
          {ACTIVITIES.filter(activity => lesson.blocks[activity.id] > 0).map(activity => <option key={activity.id} value={activity.id}>{activity.label}</option>)}</select></label>
        <label>触发方式<select value={collaborator.trigger} onChange={event => update(lesson.id, { collaborators: lesson.collaborators!.map((entry, i) => i === index ? { ...entry, trigger: event.target.value as 'on_request' | 'after_evidence' } : entry) })}>
          <option value="after_evidence">已有本课证据后</option><option value="on_request">学生请求帮助时</option></select></label>
        <label>协作用途<select value={collaborator.purpose} onChange={event => update(lesson.id, { collaborators: lesson.collaborators!.map((entry, i) => i === index ? { ...entry, purpose: event.target.value as 'explain' | 'critique' } : entry) })}>
          <option value="explain">补充解释</option><option value="critique">评议证据</option></select></label>
        <button type="button" onClick={() => update(lesson.id, { collaborators: lesson.collaborators!.filter((_, i) => i !== index) })}>移除协作</button>
      </div>)}
      <button type="button" disabled={!members.some(member => member.assistantId !== lesson.leadAssistantId) || (lesson.collaborators?.length ?? 0) >= 8}
        onClick={() => { const member = members.find(entry => entry.assistantId !== lesson.leadAssistantId); if (!member) return;
          update(lesson.id, { collaborators: [...(lesson.collaborators ?? []), { assistantId: member.assistantId, activity: 'reflect', trigger: 'on_request', purpose: 'critique',
            requiredSkillIds: ['tutor-guided-learning'] }] }); }}>添加协作导师</button>
      <details className={styles.requirements}><summary>证据与安全要求</summary>
        {spec.safetyRequirements?.length ? <p>{displayText(spec.safetyRequirements.join('；'))}</p> : null}
        <ul>{lesson.evidenceRequirements?.map(item => <li key={item}>{displayText(item)}</li>)}</ul>
        {lesson.checkpoint?.requiredGate ? <p>检查点：{lesson.checkpoint.requiredGate}</p> : null}
        {lesson.interactiveSpec?.enabled ? <p>交互活动：{lesson.interactiveSpec.domainTopic}</p> : null}
      </details>
      </fieldset>
    </details>)}
  </section>;
}
