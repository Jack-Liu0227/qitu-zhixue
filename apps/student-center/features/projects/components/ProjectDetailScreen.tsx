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
import { LessonScheduleCard } from './LessonScheduleCard';
import { SubmissionPanel } from './SubmissionPanel';
import { TaskList } from './TaskList';
import { TheoryCheck } from './TheoryCheck';
import { TheoryModule } from './TheoryModule';
import {
  useMentorNote,
  useProjectOverview,
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
  if (stage === 'theory_learning' || stage === 'theory_check' || stage === 'intent_confirmed') return 'learn';
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
                onMastered={(isMastered) => {
                  // The server issues one pending question at a time.  A
                  // non-mastered response therefore refreshes the next bounded
                  // question instead of pretending the static card is complete.
                  if (!isMastered) theory.retry();
                }}
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
  const mentor = useMentorNote(projectId, { scenario });

  return (
    <ScreenState
      state={overview.state}
      onRetry={overview.retry}
      retrying={overview.retrying}
      loading={<SkeletonBlock lines={6} />}
      emptyTitle="项目暂时没有可用课时"
      emptyDescription="去灵感空间确认一个想做的方向，系统会生成课时安排。"
      emptyAction={<CreateProjectEntry />}
      render={(data, offline) => {
        const project = data.project;
        if (!project) return null;
        const practiceLocked = isPracticeLocked(project);
        const selectedMode = mode ?? defaultModeForStage(project.status);
        const activeStage =
          data.stages.find((stage) => stage.status === 'active') ?? data.stages[0];
        const focusedTask = taskId
          ? data.tasks.find((task) => task.id === taskId)
          : undefined;

        return (
          <div className="qitu-project-detail-screen">
            <div className="qitu-project-detail-toolbar">
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
            </div>
            <ProjectHeader
              title={project.title}
              subtitle={project.subtitle}
              coverUrl={project.coverUrl}
              status={project.status}
              tags={project.tags}
            />
            <LessonScheduleCard schedule={data.lessonSchedule} />
            {/* 学习视图导航栏：支持学生在项目概览、理论学习与微观仿真课件、实践制作工作台之间自如切换 */}
            <nav aria-label="项目视图模式" style={{ display: 'flex', gap: '8px', margin: '16px 0', padding: '6px', background: '#f1f5f9', borderRadius: '12px', width: 'fit-content' }}>
              <StudentLink
                href={projectDetailHref(project.id, { mode: 'overview' })}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  textDecoration: 'none',
                  background: selectedMode === 'overview' ? '#ffffff' : 'transparent',
                  color: selectedMode === 'overview' ? '#1e293b' : '#64748b',
                  boxShadow: selectedMode === 'overview' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>📋</span>
                <span>项目概览</span>
              </StudentLink>
              <StudentLink
                href={projectDetailHref(project.id, { mode: 'learn' })}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  textDecoration: 'none',
                  background: selectedMode === 'learn' ? '#2563eb' : 'transparent',
                  color: selectedMode === 'learn' ? '#ffffff' : '#64748b',
                  boxShadow: selectedMode === 'learn' ? '0 1px 3px rgba(37,99,235,0.25)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>🔬</span>
                <span>动态微观物理课件与理论</span>
              </StudentLink>
              <StudentLink
                href={projectDetailHref(project.id, { mode: 'practice' })}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  textDecoration: 'none',
                  background: selectedMode === 'practice' ? '#ffffff' : 'transparent',
                  color: selectedMode === 'practice' ? '#1e293b' : '#64748b',
                  boxShadow: selectedMode === 'practice' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>🛠️</span>
                <span>实践制作工作台</span>
              </StudentLink>
            </nav>
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
