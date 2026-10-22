'use client';

import { useState } from 'react';
import type { AdminTeamConfig, LessonActivity, PblTemplateSession, ProjectTemplateSpec } from '@qitu/contracts';
import styles from './LessonDraftEditor.module.css';

const ACTIVITIES: readonly { id: LessonActivity; label: string }[] = [
  { id: 'review', label: '回顾' }, { id: 'theory', label: '探究与讲解' }, { id: 'check', label: '检查理解' },
  { id: 'practice', label: '实践取证' }, { id: 'reflect', label: '反思' },
];

export function LessonDraftEditor({ spec, teams, disabled, onChange }: {
  spec: ProjectTemplateSpec; teams: readonly AdminTeamConfig[]; disabled: boolean; onChange(spec: ProjectTemplateSpec): void;
}) {
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const profiles = spec.curriculum?.profiles ?? [];
  const profile = profiles.find(entry => entry.id === selectedProfileId) ?? profiles[0];
  const team = teams.find(entry => entry.id === spec.teamId);
  const members = (team?.members ?? []).filter(entry => entry.assistantId !== 'qitu-intake-assistant');
  if (spec.lessonPolicy !== 'lesson-guided.v1') return <p className={styles.note}>这是历史课程合同。逐课主讲、开场与协作编辑适用于新的课时教学合同，旧项目保留已冻结的课程。</p>;
  if (!profile) return <p role="status">尚未配置课时排期。</p>;
  function update(lessonId: string, patch: Partial<PblTemplateSession>) {
    if (disabled || !spec.curriculum || !profile) return;
    onChange({ ...spec, curriculum: { ...spec.curriculum, profiles: profiles.map(entry => entry.id === profile.id
      ? { ...entry, sessions: entry.sessions.map(lesson => lesson.id === lessonId ? { ...lesson, ...patch } : lesson) } : entry) } });
  }
  function name(id: string) { return members.find(entry => entry.assistantId === id)?.assistantName ?? id; }
  return <section className={styles.editor} aria-label="编辑课时课程草稿">
    <header><div><h3>逐课教学设计</h3><p>修改保存在新课程草稿中。发布团队版本、编译并启用后，才供新项目使用。</p></div>
      <a href="/settings/teams">管理导师团队与成员 →</a></header>
    {!team ? <p role="alert">课程团队尚未加载，暂不能选择导师。请先在团队管理中配置真实成员。</p> : null}
    {profiles.length > 1 ? <label>课时安排<select value={profile.id} onChange={event => setSelectedProfileId(event.target.value)}>
      {profiles.map(entry => <option key={entry.id} value={entry.id}>{entry.id}</option>)}</select></label> : null}
    {profile.sessions.map(lesson => <details key={lesson.id} className={styles.lesson}>
      <summary><strong>第 {lesson.sessionIndex} 课 · {lesson.title}</strong><span>{name(lesson.leadAssistantId ?? '') || '待安排导师'} · {lesson.durationMinutes} 分钟</span></summary>
      <fieldset disabled={disabled}><div className={styles.grid}>
        <label>课时名称<input value={lesson.title} maxLength={200} onChange={event => update(lesson.id, { title: event.target.value })} /></label>
        <label>本课主讲<select value={lesson.leadAssistantId ?? ''} disabled={!team} onChange={event => update(lesson.id, { leadAssistantId: event.target.value })}>
          <option value="" disabled>选择团队成员</option>{members.map(member => <option key={member.assistantId} value={member.assistantId}>{member.assistantName} · {member.roleLabel ?? member.role}</option>)}</select></label>
      </div>
      <label>学习目标<textarea value={lesson.learningGoal ?? ''} maxLength={1000} onChange={event => update(lesson.id, { learningGoal: event.target.value })} /></label>
      {lesson.opening ? <div className={styles.opening}><h4>本课固定开场</h4>
        <label>观察情境<textarea value={lesson.opening.scenario} maxLength={1000} onChange={event => update(lesson.id, { opening: { ...lesson.opening!, scenario: event.target.value } })} /></label>
        <label>第一个问题<textarea value={lesson.opening.prompt} maxLength={500} onChange={event => update(lesson.id, { opening: { ...lesson.opening!, prompt: event.target.value } })} /></label>
        {lesson.opening.options.map((option, index) => <div key={option.id} className={styles.grid}>
          <label>选项 {index + 1}<input value={option.label} maxLength={80} onChange={event => update(lesson.id, { opening: { ...lesson.opening!, options: lesson.opening!.options.map(entry => entry.id === option.id ? { ...entry, label: event.target.value } : entry) } })} /></label>
          <label>学生选择后发送的内容<input value={option.text} maxLength={500} onChange={event => update(lesson.id, { opening: { ...lesson.opening!, options: lesson.opening!.options.map(entry => entry.id === option.id ? { ...entry, text: event.target.value } : entry) } })} /></label>
        </div>)}
      </div> : null}
      <h4>活动指导</h4>{ACTIVITIES.filter(activity => lesson.blocks[activity.id] > 0).map(activity => <label key={activity.id}>{activity.label} · {lesson.blocks[activity.id]} 分钟
        <textarea value={lesson.activityGuidance?.[activity.id] ?? ''} maxLength={1500} onChange={event => update(lesson.id, { activityGuidance: { ...lesson.activityGuidance, [activity.id]: event.target.value } })} /></label>)}
      <h4>按需协作</h4>{(lesson.collaborators ?? []).map((collaborator, index) => <div className={styles.collaboration} key={`${lesson.id}:${index}`}>
        <label>协作导师<select value={collaborator.assistantId} onChange={event => update(lesson.id, { collaborators: lesson.collaborators!.map((entry, i) => i === index ? { ...entry, assistantId: event.target.value } : entry) })}>
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
      <p className={styles.note}>导师能力、模型和资料授权由 Admin 管理。课件可推荐已有资料、生成新图示或引用改编；活动证据与完成要求继续按本课合同检查。</p>
      </fieldset>
    </details>)}
  </section>;
}
