'use client';

import { BreadcrumbBar, SkeletonBlock } from '@qitu/ui';
import { renderBreadcrumbLink } from '../../../components/breadcrumb-link';
import { ReflectionForm } from './ReflectionForm';
import { ScreenState } from './StateViews';
import { useProjectOverview } from '../hooks/useProjectsData';
import { projectDetailHref } from '../lib/links';
import type { ScreenScenario } from '../lib/loadable';

export interface ReflectionScreenProps {
  projectId: string;
  scenario?: ScreenScenario;
}

/** `/student/projects/:projectId/reflection` 反思。 */
export function ReflectionScreen({ projectId, scenario }: ReflectionScreenProps) {
  const overview = useProjectOverview(projectId, { scenario });

  return (
    <ScreenState
      state={overview.state}
      onRetry={overview.retry}
      retrying={overview.retrying}
      loading={<SkeletonBlock lines={5} />}
      emptyTitle="暂时无法反思"
      emptyDescription="项目阶段尚未到达反思环节。"
      render={(data, offline) => {
        const project = data.project;
        if (!project) return null;
        const activeStage = data.stages.find((stage) => stage.status === 'active') ?? data.stages[0];
        const stageId = activeStage?.id ?? '';
        return (
          <div className="qitu-reflection-screen">
            <BreadcrumbBar
              renderLink={renderBreadcrumbLink}
              items={[
                { label: '我的项目', href: '/student/projects' },
                { label: project.title, href: projectDetailHref(project.id) },
                { label: '反思' },
              ]}
            />
            <ReflectionForm projectId={project.id} stageId={stageId} offline={offline} />
          </div>
        );
      }}
    />
  );
}
