import type { ProjectStage, ProjectSummary } from '@qitu/contracts';
import { SectionCard, StageBadge, TagChips } from '@qitu/ui';

/**
 * Left-column project card. DISPLAY ONLY.
 *
 * The stage label comes from the server's `ProjectSummary.stage`
 * (`ProjectStage`), which is the single stage truth. This card must never be
 * used to compute a stage gate.
 */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <SectionCard title="当前项目">
      <div className="qitu-tutor-project-card">
        <h3 className="qitu-tutor-project-title">{project.title}</h3>
        <div className="qitu-tutor-project-meta">
          <StageBadge label={stageLabel(project.stage)} tone="current" />
          <TagChips tags={['进行中']} tone="primary" />
        </div>
      </div>
    </SectionCard>
  );
}

function stageLabel(stage: ProjectStage): string {
  const labels: Record<ProjectStage, string> = {
    exploration: '探索',
    intent_confirmed: '确认意图',
    theory_learning: '理论学习',
    theory_check: '理论检验',
    practice_ready: '实践就绪',
    practice_building: '动手制作',
    artifact_review: '作品评审',
    reflection: '反思',
    published: '已发布',
    completed: '完成',
  };
  return labels[stage];
}
