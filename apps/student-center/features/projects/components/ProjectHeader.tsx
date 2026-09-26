import type { ReactNode } from 'react';
import { BreadcrumbBar, ProgressBar, SectionCard, TagChips } from '@qitu/ui';
import { renderBreadcrumbLink } from '../../../components/breadcrumb-link';
import { StageStepper } from './StageStepper';
import type { ProjectStage, TemplateStage } from '../types';

export interface ProjectHeaderProps {
  title: string;
  subtitle?: string;
  coverUrl?: string;
  /**
   * 服务端状态机状态。头部仅用于上下文展示（例如锁定提示），
   * 不在此做权限判定；门判定见 `lib/stage.ts`。
   */
  status: ProjectStage;
  currentStageIndex: number;
  stageTotal: number;
  progressPercent: number;
  tags?: string[];
  breadcrumbs?: { label: string; href?: string }[];
  stages?: TemplateStage[];
  /** 由服务端阶段 status 派生的高亮下标（纯展示）。 */
  activeIndex?: number;
  action?: ReactNode;
}

/**
 * 项目头（详情页与**制作工作台**共用，spec §1）。
 *
 * `currentStageIndex` / `stageTotal` / `progressPercent` 均为服务端下发的
 * 展示投影，仅用于渲染，绝不参与门判定。
 */
export function ProjectHeader({
  title,
  subtitle,
  coverUrl,
  currentStageIndex,
  stageTotal,
  progressPercent,
  tags,
  breadcrumbs,
  stages,
  activeIndex = 0,
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
        <p className="qitu-project-header-stage">
          第 {currentStageIndex} 阶段 / 共 {stageTotal} 阶段
        </p>
        <ProgressBar percent={progressPercent} label={`进度 ${progressPercent}%`} />
        {stages && stages.length > 0 ? (
          <StageStepper stages={stages} activeIndex={activeIndex} />
        ) : null}
        {action ? <div className="qitu-project-header-action">{action}</div> : null}
      </SectionCard>
    </header>
  );
}
