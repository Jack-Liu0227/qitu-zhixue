'use client';

import { BreadcrumbBar, SkeletonBlock } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import { renderBreadcrumbLink } from '../../../components/breadcrumb-link';
import { CreateProjectEntry } from './CreateProjectEntry';
import { MentorNote } from './MentorNote';
import { NextStepCard } from './NextStepCard';
import { ProjectHeader } from './ProjectHeader';
import { StageTimeline } from './StageTimeline';
import { ScreenState } from './StateViews';
import { TaskList } from './TaskList';
import {
  useMentorNote,
  useProjectOverview,
  useTemplateStages,
} from '../hooks/useProjectsData';
import { isPracticeLocked } from '../lib/stage';
import type { ScreenScenario } from '../lib/loadable';

export interface ProjectDetailScreenProps {
  projectId: string;
  scenario?: ScreenScenario;
}

/** `/student/projects/:projectId` 详情 + 阶段时间轴 + 任务。 */
export function ProjectDetailScreen({ projectId, scenario }: ProjectDetailScreenProps) {
  const overview = useProjectOverview(projectId, { scenario });
  const templateVersionId =
    overview.state.status === 'ready' || overview.state.status === 'offline'
      ? overview.state.data.project?.templateVersionId
      : undefined;
  const templates = useTemplateStages(templateVersionId ?? '', { scenario });
  const mentor = useMentorNote(projectId, { scenario });

  return (
    <ScreenState
      state={overview.state}
      onRetry={overview.retry}
      retrying={overview.retrying}
      loading={<SkeletonBlock lines={6} />}
      emptyTitle="项目暂时没有阶段"
      emptyDescription="去灵感空间确认一个想做的方向。"
      emptyAction={<CreateProjectEntry />}
      render={(data, offline) => {
        const project = data.project;
        if (!project) return null;
        const practiceLocked = isPracticeLocked(project);
        const templateStages = templates.state.status === 'ready' ? templates.state.data : [];
        const activeIndex = data.stages.findIndex((stage) => stage.status === 'active');
        const stepperIndex = activeIndex >= 0 ? activeIndex : data.stages.length;
        return (
          <div className="qitu-project-detail-screen">
            <BreadcrumbBar
              renderLink={renderBreadcrumbLink}
              items={[
                { label: '我的项目', href: '/student/projects' },
                { label: project.title },
              ]}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <StudentLink className="qitu-button" href={`/student/growth?projectId=${project.id}`}>
                查看成长轨迹
              </StudentLink>
            </div>
            <ProjectHeader
              title={project.title}
              subtitle={project.subtitle}
              coverUrl={project.coverUrl}
              status={project.status}
              currentStageIndex={project.currentStageIndex}
              stageTotal={project.stageTotal}
              progressPercent={project.progressPercent}
              tags={project.tags}
              stages={templateStages}
              activeIndex={stepperIndex}
            />
            {data.nextStep ? <NextStepCard nextStep={data.nextStep} disabled={offline} /> : null}
            <StageTimeline
              projectId={project.id}
              stages={data.stages}
              practiceLocked={practiceLocked}
              offline={offline}
            />
            <TaskList tasks={data.tasks} readOnly />
            {mentor.state.status === 'ready' && mentor.state.data ? (
              <MentorNote note={mentor.state.data} />
            ) : null}
          </div>
        );
      }}
    />
  );
}
