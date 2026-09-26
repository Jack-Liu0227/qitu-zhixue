import { EmptyState, SectionCard } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';

import type { TodayTask } from '../types';
import { TaskCard } from './TaskCard';

/**
 * 「今日任务」card. Shows only current-stage tasks (the server already scopes
 * C1 to the current stage; `currentStageId` is applied as a defensive display
 * filter). The empty branch is part of the page-level empty state: no active
 * project shows a meaningful CTA into 灵感空间 rather than an error.
 */
export function TodayTaskCard({
  tasks,
  hasActiveProject,
  currentStageId,
  exploreHref = '/student/inspiration',
}: {
  tasks: TodayTask[];
  hasActiveProject: boolean;
  currentStageId: string | null;
  exploreHref?: string;
}) {
  const visible = currentStageId ? tasks.filter((task) => task.stageId === currentStageId) : tasks;

  if (!hasActiveProject) {
    return (
      <SectionCard title="今日任务">
        <EmptyState
          title="还没有进行中的项目"
          description="从一个想法开始，AI搭档会陪你把它变成真正的作品。"
          action={<StudentLink href={exploreHref}>进入灵感空间</StudentLink>}
        />
      </SectionCard>
    );
  }

  if (visible.length === 0) {
    return (
      <SectionCard title="今日任务">
        <EmptyState
          title="今天暂时没有任务"
          description="当前阶段的任务已经完成，明天再来看看吧。"
          action={<StudentLink href={exploreHref}>去灵感空间逛逛</StudentLink>}
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="今日任务">
      <div style={{ display: 'grid', gap: 10 }}>
        {visible.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
    </SectionCard>
  );
}
