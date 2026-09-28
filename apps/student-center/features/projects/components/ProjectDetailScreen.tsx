'use client';

import { BreadcrumbBar, SectionCard, SkeletonBlock } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import { renderBreadcrumbLink } from '../../../components/breadcrumb-link';
import { CreateProjectEntry } from './CreateProjectEntry';
import { MentorNote } from './MentorNote';
import { NextStepCard } from './NextStepCard';
import { PracticeChecklist } from './PracticeChecklist';
import { ProjectHeader } from './ProjectHeader';
import { ReflectionForm } from './ReflectionForm';
import { ScreenState } from './StateViews';
import { StageTimeline } from './StageTimeline';
import { SubmissionPanel } from './SubmissionPanel';
import { TaskList } from './TaskList';
import { TheoryCheck } from './TheoryCheck';
import { TheoryModule } from './TheoryModule';
import {
  useMentorNote,
  useProjectOverview,
  useTemplateStages,
  useTheoryContent,
} from '../hooks/useProjectsData';
import { useTaskCompleteList } from '../hooks/useProjectsMutations';
import { projectDetailHref } from '../lib/links';
import { isPracticeLocked } from '../lib/stage';
import type { ScreenScenario } from '../lib/loadable';
import type { ProjectStage, ProjectViewMode, TaskView } from '../types';

export interface ProjectDetailScreenProps {
  projectId: string;
  taskId?: string | null;
  mode?: ProjectViewMode | null;
  scenario?: ScreenScenario;
}

function defaultModeForStage(stage: ProjectStage): ProjectViewMode {
  if (stage === 'theory_learning' || stage === 'theory_check') return 'learn';
  if (
    stage === 'practice_ready' ||
    stage === 'practice_building' ||
    stage === 'artifact_review'
  ) {
    return 'practice';
  }
  if (stage === 'reflection' || stage === 'published' || stage === 'completed') {
    return 'showcase';
  }
  return 'overview';
}

function ProjectLearnPanel({
  projectId,
  scenario,
  parentOffline,
  mastered,
}: {
  projectId: string;
  scenario?: ScreenScenario;
  parentOffline: boolean;
  mastered: boolean;
}) {
  const theory = useTheoryContent(projectId, { scenario });
  return (
    <ScreenState
      state={theory.state}
      onRetry={theory.retry}
      retrying={theory.retrying}
      loading={<SkeletonBlock lines={4} />}
      emptyTitle="当前无需校验"
      emptyDescription="这个阶段没有需要完成的校验，先回到项目概览。"
      render={(content, offline) => (
        <>
          {content.material ? <TheoryModule material={content.material} /> : null}
          {content.questions.length > 0 ? (
            <TheoryCheck
              projectId={projectId}
              questions={content.questions}
              mastered={mastered}
              offline={parentOffline || offline}
            />
          ) : null}
        </>
      )}
    />
  );
}

function ProjectPracticePanel({
  projectId,
  tasks,
  locked,
  offline,
}: {
  projectId: string;
  tasks: TaskView[];
  locked: boolean;
  offline: boolean;
}) {
  const { complete, pendingTaskId } = useTaskCompleteList();
  const activeTask = tasks.find((task) => task.status === 'doing' || task.status === 'todo');
  return (
    <>
      <PracticeChecklist
        tasks={tasks}
        locked={locked}
        theoryHref={projectDetailHref(projectId, { mode: 'learn' })}
        offline={offline}
        completingTaskId={pendingTaskId}
        onCompleteTask={locked || offline ? undefined : (id) => void complete(id)}
      />
      {!locked && activeTask ? (
        <SubmissionPanel taskId={activeTask.id} stageId={activeTask.stageId} disabled={offline} />
      ) : null}
    </>
  );
}

function ProjectShowcasePanel({
  projectId,
  stageId,
  offline,
}: {
  projectId: string;
  stageId: string;
  offline: boolean;
}) {
  return <ReflectionForm projectId={projectId} stageId={stageId} offline={offline} />;
}

/**
 * 统一项目详情容器。
 *
 * `task_id` / `mode` 只改变默认聚焦面板；项目、阶段、任务和权限仍由同一份
 * `ProjectOverview` 决定。旧的 `/theory`、`/practice`、`/reflection` 页面只作
 * 兼容入口并重定向到这里，避免四端继续产生多套项目容器。
 */
export function ProjectDetailScreen({
  projectId,
  taskId = null,
  mode = null,
  scenario,
}: ProjectDetailScreenProps) {
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
        const selectedMode = mode ?? defaultModeForStage(project.status);
        const activeStage =
          data.stages.find((stage) => stage.status === 'active') ?? data.stages[0];
        const focusedTask = taskId
          ? data.tasks.find((task) => task.id === taskId)
          : undefined;

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
            {taskId && !focusedTask ? (
              <p role="status" className="qitu-form-hint">
                当前任务已不可用，已回到项目当前阶段。
              </p>
            ) : null}
            {focusedTask ? (
              <SectionCard title="当前任务">
                <p>{focusedTask.title}</p>
                <p className="qitu-form-hint">
                  已根据任务入口定位到这里，项目状态仍由服务端决定。
                </p>
              </SectionCard>
            ) : null}
            {selectedMode === 'learn' ? (
              <ProjectLearnPanel
                projectId={project.id}
                scenario={scenario}
                parentOffline={offline}
                mastered={project.theoryMastered}
              />
            ) : null}
            {selectedMode === 'practice' ? (
              <ProjectPracticePanel
                projectId={project.id}
                tasks={data.tasks}
                locked={practiceLocked}
                offline={offline}
              />
            ) : null}
            {selectedMode === 'showcase' ? (
              <ProjectShowcasePanel
                projectId={project.id}
                stageId={activeStage?.id ?? ''}
                offline={offline}
              />
            ) : null}
            <StageTimeline
              projectId={project.id}
              stages={data.stages}
              practiceLocked={practiceLocked}
              offline={offline}
            />
            <TaskList tasks={data.tasks} readOnly focusedTaskId={taskId} />
            {mentor.state.status === 'ready' && mentor.state.data ? (
              <MentorNote note={mentor.state.data} />
            ) : null}
          </div>
        );
      }}
    />
  );
}
