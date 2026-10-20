import type { ReactNode } from 'react';
import { BreadcrumbBar, ProgressBar, SectionCard, TagChips } from '@qitu/ui';
import { renderBreadcrumbLink } from '../../../components/breadcrumb-link';
import type { ProjectStage } from '../types';

export interface ProjectHeaderProps {
  title: string;
  subtitle?: string;
  coverUrl?: string;
  /**
   * 服务端状态机状态。头部仅用于上下文展示（例如锁定提示），
   * 不在此做权限判定；门判定见 `lib/stage.ts`。
   */
  status: ProjectStage;
  progressPercent: number;
  tags?: string[];
  breadcrumbs?: { label: string; href?: string }[];
  action?: ReactNode;
}

/**
 * 项目头（详情页与**制作工作台**共用，spec §1）。
 *
 * Project lifecycle phases remain server policy; students see the lesson plan
 * separately rather than a second phase-based course spine.
 */
export function ProjectHeader({
  title,
  subtitle,
  coverUrl,
  progressPercent,
  tags,
  breadcrumbs,
  action,
}: ProjectHeaderProps) {
  return (
    <header className="qitu-project-header">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <BreadcrumbBar items={breadcrumbs} renderLink={renderBreadcrumbLink} />
      ) : null}
      <SectionCard>
        {coverUrl ? (
          <div className="qitu-project-header-cover">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coverUrl} alt="" />
          </div>
        ) : null}
        <h1 className="qitu-project-header-title">{title}</h1>
        {subtitle ? <p className="qitu-project-header-subtitle">{subtitle}</p> : null}
        {tags && tags.length > 0 ? <TagChips tags={tags} /> : null}
        <ProgressBar percent={progressPercent} label={`进度 ${progressPercent}%`} />
        {action ? <div className="qitu-project-header-action">{action}</div> : null}
      </SectionCard>
    </header>
  );
}
