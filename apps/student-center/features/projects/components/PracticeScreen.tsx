'use client';

import { BreadcrumbBar, SkeletonBlock } from '@qitu/ui';
import { renderBreadcrumbLink } from '../../../components/breadcrumb-link';
import { PracticeChecklist } from './PracticeChecklist';
import { ScreenState } from './StateViews';
import { SubmissionPanel } from './SubmissionPanel';
import { useTaskCompleteList } from '../hooks/useProjectsMutations';
import { useProjectOverview } from '../hooks/useProjectsData';
import { projectDetailHref, projectTheoryHref } from '../lib/links';
import { isPracticeLocked } from '../lib/stage';
import type { ScreenScenario } from '../lib/loadable';

export interface PracticeScreenProps {
  projectId: string;
  scenario?: ScreenScenario;
}

/** `/student/projects/:projectId/practice` 实践清单 + 提交。 */
export function PracticeScreen({ projectId, scenario }: PracticeScreenProps) {
  const overview = useProjectOverview(projectId, { scenario });
  const { complete, pendingTaskId } = useTaskCompleteList();

  return (
    <ScreenState
      state={overview.state}
      onRetry={overview.retry}
      retrying={overview.retrying}
      loading={<SkeletonBlock lines={6} />}
      emptyTitle="等待阶段解锁"
      emptyDescription="这个阶段还没有实践任务。"
      render={(data, offline) => {
        const project = data.project;
        if (!project) return null;
        const locked = isPracticeLocked(project);
        const activeTask = data.tasks.find(
          (task) => task.status === 'doing' || task.status === 'todo',
        );
        return (
          <div className="qitu-practice-screen">
            <BreadcrumbBar
              renderLink={renderBreadcrumbLink}
              items={[
                { label: '我的项目', href: '/student/projects' },
                { label: project.title, href: projectDetailHref(project.id) },
                { label: '实践' },
              ]}
            />
            <PracticeChecklist
              tasks={data.tasks}
              locked={locked}
              theoryHref={projectTheoryHref(project.id)}
              offline={offline}
              completingTaskId={pendingTaskId}
              onCompleteTask={
                locked || offline ? undefined : (taskId) => void complete(taskId)
              }
            />
            {!locked && activeTask ? (
              <SubmissionPanel
                taskId={activeTask.id}
                stageId={activeTask.stageId}
                disabled={offline}
              />
            ) : null}
          </div>
        );
      }}
    />
  );
}
