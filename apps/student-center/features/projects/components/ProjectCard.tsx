import { TagChips } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import { projectDetailHref } from '../lib/links';
import type { ProjectListItem } from '../types';

export interface ProjectCardProps {
  project: ProjectListItem;
  /** 断网只读时禁用「继续制作」，仍可查看项目信息。 */
  readOnly?: boolean;
}

/**
 * 项目卡只呈现项目身份信息；学习进度以冻结课时安排为主轴。
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
