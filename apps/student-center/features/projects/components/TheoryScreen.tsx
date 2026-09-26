'use client';

import { BreadcrumbBar, EmptyState, SkeletonBlock } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import { renderBreadcrumbLink } from '../../../components/breadcrumb-link';
import { ScreenState } from './StateViews';
import { TheoryCheck } from './TheoryCheck';
import { TheoryModule } from './TheoryModule';
import { useProjectOverview, useTheoryContent } from '../hooks/useProjectsData';
import { projectDetailHref } from '../lib/links';
import type { ScreenScenario } from '../lib/loadable';

export interface TheoryScreenProps {
  projectId: string;
  scenario?: ScreenScenario;
}

/** `/student/projects/:projectId/theory` 理论学习 + TheoryCheck。 */
export function TheoryScreen({ projectId, scenario }: TheoryScreenProps) {
  const overview = useProjectOverview(projectId, { scenario });
  const theory = useTheoryContent(projectId, { scenario });

  return (
    <ScreenState
      state={overview.state}
      onRetry={overview.retry}
      retrying={overview.retrying}
      loading={<SkeletonBlock lines={6} />}
      emptyTitle="项目暂时没有阶段"
      emptyDescription="去灵感空间确认一个想做的方向。"
      render={(data, offline) => {
        const project = data.project;
        if (!project) return null;
        return (
          <div className="qitu-theory-screen">
            <BreadcrumbBar
              renderLink={renderBreadcrumbLink}
              items={[
                { label: '我的项目', href: '/student/projects' },
                { label: project.title, href: projectDetailHref(project.id) },
                { label: '理论学习' },
              ]}
            />
            <ScreenState
              state={theory.state}
              onRetry={theory.retry}
              retrying={theory.retrying}
              loading={<SkeletonBlock lines={4} />}
              emptyTitle="当前无需校验"
              emptyDescription="这个阶段没有需要完成的校验，先回项目详情。"
              emptyAction={<StudentLink href={projectDetailHref(project.id)}>返回项目</StudentLink>}
              render={(content) => (
                <>
                  {content.material ? <TheoryModule material={content.material} /> : null}
                  {content.questions.length > 0 ? (
                    <TheoryCheck
                      projectId={project.id}
                      questions={content.questions}
                      mastered={project.theoryMastered}
                      offline={offline}
                    />
                  ) : (
                    <EmptyState
                      title="当前无需校验"
                      description="先阅读材料，等待老师安排校验。"
                    />
                  )}
                </>
              )}
            />
          </div>
        );
      }}
    />
  );
}
