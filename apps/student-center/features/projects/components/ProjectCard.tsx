import { TagChips, EntityCover } from '@qitu/ui';
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
      <div className={project.coverUrl ? 'qitu-project-cover' : 'qitu-project-cover is-placeholder'} aria-hidden={!project.coverUrl}>
        {project.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.coverUrl} alt="" />
        ) : (
          <EntityCover assetId="brand-pbl-v1" height={140} />
        )}
      </div>
      <div className="qitu-project-card-body">
        {project.isCurrent ? <span className="qitu-badge qitu-badge-primary">当前项目</span> : null}
        <h3 className="qitu-project-card-title" title={project.title}>{project.title}</h3>
        <p className="qitu-project-card-subtitle">{project.subtitle}</p>
        <TagChips tags={project.tags} />
        <span className="qitu-project-card-action">{readOnly ? '离线 · 只读' : '查看项目 →'}</span>
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
