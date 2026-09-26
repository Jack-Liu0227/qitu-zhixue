import { SectionCard } from '@qitu/ui';
import { StageCard } from './StageCard';
import { isPracticeStage, stageEntryHref } from '../lib/stage';
import type { ProjectStageView } from '../types';

export interface StageTimelineProps {
  projectId: string;
  stages: ProjectStageView[];
  /** 实践阶段是否锁定（服务端判定结果，由详情屏传入）。 */
  practiceLocked: boolean;
  /** 断网时阶段入口不可点击（离线导航无效）。 */
  offline?: boolean;
}

/** 「项目阶段」纵向时间轴；阶段数与名称全部来自服务端（验收 8）。 */
export function StageTimeline({ projectId, stages, practiceLocked, offline = false }: StageTimelineProps) {
  return (
    <SectionCard title="项目阶段">
      <ol className="qitu-stage-timeline" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {stages.map((view) => {
          const href = offline ? null : stageEntryHref(projectId, view.stage);
          const locked = practiceLocked && isPracticeStage(view.stage);
          return <StageCard key={view.id} view={view} href={href} locked={locked} />;
        })}
      </ol>
    </SectionCard>
  );
}
