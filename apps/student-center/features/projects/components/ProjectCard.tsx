import { ProgressBar, TagChips } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import { projectDetailHref } from '../lib/links';
import type { ProjectListItem } from '../types';

export interface ProjectCardProps {
  project: ProjectListItem;
  /** 断网只读时禁用「继续制作」，仍可查看封面与进度。 */
  readOnly?: boolean;
}

/**
 * 项目卡：字段全部来自 C1/C3，无客户端计算（验收 5）。
 * `currentStageIndex` / `stageTotal` / `progressPercent` 仅用于展示。
 */
export function ProjectCard({ project, readOnly = false }: ProjectCardProps) {
  const body = (
    <>
      <div className="qitu-project-cover" aria-hidden={!project.coverUrl}>
        {project.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.coverUrl} alt="" />
        ) : (
          <span className="qitu-project-cover-fallback" />
        )}
      </div>
      <div className="qitu-project-card-body">
        <h3 className="qitu-project-card-title">{project.title}</h3>
        <p className="qitu-project-card-subtitle">{project.subtitle}</p>
        <TagChips tags={project.tags} />
        <p className="qitu-project-card-stage">
          第 {project.currentStageIndex} 阶段 / 共 {project.stageTotal} 阶段
        </p>
        <ProgressBar percent={project.progressPercent} label={`进度 ${project.progressPercent}%`} />
      </div>
    </>
  );

  if (readOnly) {
    return <article className="qitu-project-card is-readonly">{body}</article>;
  }

  return (
    <StudentLink className="qitu-project-card" href={projectDetailHref(project.id)}>
      {body}
    </StudentLink>
  );
}
