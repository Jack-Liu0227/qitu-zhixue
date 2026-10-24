import { EntityCover, TagChips } from '@qitu/ui';
import { normalizeProjectTitle } from '@qitu/contracts';
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
      <div className={project.coverUrl || project.coverAssetId ? 'qitu-project-cover' : 'qitu-project-cover is-placeholder'} aria-hidden="true">
        {project.coverAssetId ? <EntityCover assetId={project.coverAssetId} height={140} /> : project.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.coverUrl} alt="" />
        ) : (
          <div className="qitu-project-cover-fallback"><span aria-hidden="true">✦</span><span>{project.kind === 'exploration' ? '兴趣探索' : project.kind === 'plan' ? '学习计划' : '项目探究'}</span></div>
        )}
      </div>
      <div className="qitu-project-card-body">
        {project.isCurrent ? <span className="qitu-badge qitu-badge-primary">当前项目</span> : null}
        <h3 className="qitu-project-card-title" title={normalizeProjectTitle(project.title)}>{normalizeProjectTitle(project.title)}</h3>
        <p className="qitu-project-card-subtitle">{project.subtitle}</p>
        <TagChips tags={project.tags} />
        {project.createdAt && Number.isFinite(Date.parse(project.createdAt)) ? <small className="qitu-project-created">创建于 {new Date(project.createdAt).toLocaleDateString('zh-CN')}</small> : null}
        <span className="qitu-project-card-action">{readOnly ? '离线 · 只读' : project.kind === 'plan' ? '未确认计划 · 只读' : project.kind === 'exploration' ? '继续探索 →' : '查看项目 →'}</span>
      </div>
    </>
  );

  if (readOnly || project.kind === 'plan') {
    return <article className="qitu-project-card is-readonly">{body}</article>;
  }

  return (
    <StudentLink className="qitu-project-card" href={project.kind === 'exploration' ? `/student/tutor?explorationId=${encodeURIComponent(project.id)}` : projectDetailHref(project.id)}>
      {body}
    </StudentLink>
  );
}
