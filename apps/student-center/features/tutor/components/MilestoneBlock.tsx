'use client';

import { StudentLink } from '../../../components/student-link';

type MilestoneBlockProps = {
  phaseId: string;
  title: string;
  deliverables: { id: string; title: string; submitted: boolean }[];
  gate: { type: 'TheoryMastered' | 'review' | 'none'; status: 'pending' | 'passed' | 'failed' | 'not_required' };
  projectId?: string | null;
};

/** Read-only milestone projection. Gate status is never inferred from deliverables. */
export function MilestoneBlock({ phaseId, title, deliverables, gate, projectId }: MilestoneBlockProps) {
  const phaseLabel = ({ exploration: '灵感探索', concept_mastery: '理论探究', practice: '实践制作', reflection: '反思完善' } as Record<string, string>)[phaseId] ?? '当前阶段';
  const isTheorySide = phaseId === 'exploration' || phaseId === 'concept_mastery';
  const theoryBlocked = gate.type === 'TheoryMastered' && gate.status !== 'passed';
  const workbenchHref = projectId ? `/student/projects/${encodeURIComponent(projectId)}/workbench` : null;
  const worksHref = projectId ? `/student/works` : null;
  return (
    <section className="qitu-milestone-card" aria-label="阶段检查">
      <header className="qitu-milestone-header"><div><span className="qitu-quiz-badge">阶段检查</span><h4>{title}</h4><small>{phaseLabel}</small></div><GateStatus type={gate.type} status={gate.status} /></header>
      <ul className="qitu-milestone-deliverables">{deliverables.map((item) => <li key={item.id}><span aria-hidden="true">{item.submitted ? '✓' : '○'}</span><span>{item.title}</span><strong>{item.submitted ? '已提交' : '待提交'}</strong></li>)}</ul>
      {theoryBlocked || isTheorySide ? (
        <p className="qitu-milestone-lock" role="status">
          {theoryBlocked ? '理论掌握门禁尚未通过，需先完成理论学习与检验。' : '当前处于理论探究阶段，完成阶段目标后将进入制作实践。'}
        </p>
      ) : (
        <div className="qitu-milestone-actions">
          {workbenchHref ? <StudentLink className="qitu-button qitu-button-primary qitu-button-sm" href={workbenchHref}>进入制作工作台</StudentLink> : null}
          {worksHref ? <StudentLink className="qitu-button qitu-button-ghost qitu-button-sm" href={worksHref}>查看作品</StudentLink> : null}
        </div>
      )}
    </section>
  );
}

function GateStatus({ type, status }: MilestoneBlockProps['gate']) {
  const labels = { pending: '待核验', passed: '已通过', failed: '未通过', not_required: '无需门禁' } as const;
  return <span className={`qitu-milestone-gate is-${status}`} title={`${type}：${labels[status]}`}>{labels[status]}</span>;
}
