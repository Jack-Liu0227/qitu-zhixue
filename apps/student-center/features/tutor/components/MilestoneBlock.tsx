'use client';

import Link from 'next/link';

type MilestoneBlockProps = {
  phaseId: string;
  title: string;
  deliverables: { id: string; title: string; submitted: boolean }[];
  gate: { type: 'TheoryMastered' | 'review' | 'none'; status: 'pending' | 'passed' | 'failed' | 'not_required' };
  projectId?: string | null;
};

/** Read-only milestone projection. Gate status is never inferred from deliverables. */
export function MilestoneBlock({ phaseId, title, deliverables, gate, projectId }: MilestoneBlockProps) {
  const theoryBlocked = gate.type === 'TheoryMastered' && gate.status !== 'passed';
  const workbenchHref = projectId ? `/student/projects/${encodeURIComponent(projectId)}/workbench` : null;
  const worksHref = projectId ? `/student/works` : null;
  return (
    <section className="qitu-milestone-card" aria-label="阶段检查">
      <header className="qitu-milestone-header"><div><span className="qitu-quiz-badge">阶段检查</span><h4>{title}</h4><small>阶段 {phaseId}</small></div><GateStatus type={gate.type} status={gate.status} /></header>
      <ul className="qitu-milestone-deliverables">{deliverables.map((item) => <li key={item.id}><span aria-hidden="true">{item.submitted ? '✓' : '○'}</span><span>{item.title}</span><strong>{item.submitted ? '已提交' : '待提交'}</strong></li>)}</ul>
      {theoryBlocked ? <p className="qitu-milestone-lock" role="status">理论掌握门禁尚未通过，实践与制作入口暂不可用。</p> : (
        <div className="qitu-milestone-actions">{workbenchHref ? <Link className="qitu-button qitu-button-primary qitu-button-sm" href={workbenchHref}>进入制作工作台</Link> : null}{worksHref ? <Link className="qitu-button qitu-button-ghost qitu-button-sm" href={worksHref}>查看作品</Link> : null}</div>
      )}
    </section>
  );
}

function GateStatus({ type, status }: MilestoneBlockProps['gate']) {
  const labels = { pending: '待核验', passed: '已通过', failed: '未通过', not_required: '无需门禁' } as const;
  return <span className={`qitu-milestone-gate is-${status}`} title={`${type}：${labels[status]}`}>{labels[status]}</span>;
}
