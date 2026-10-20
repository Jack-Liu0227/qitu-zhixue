'use client';

import { BreadcrumbBar, SectionCard, SkeletonBlock } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import { renderBreadcrumbLink } from '../../../components/breadcrumb-link';
import { CreateProjectEntry } from './CreateProjectEntry';
import { MentorNote } from './MentorNote';
import { NextStepCard } from './NextStepCard';
import { PracticeChecklist } from './PracticeChecklist';
import { ProjectHeader } from './ProjectHeader';
import { ScreenState } from './StateViews';
import { LessonScheduleCard } from './LessonScheduleCard';
import { TaskList } from './TaskList';
import {
  useMentorNote,
  useProjectOverview,
} from '../hooks/useProjectsData';
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

function ProjectLearnPanel({ projectId, parentOffline }: { projectId: string; parentOffline: boolean }) {
  return (
    <SectionCard title="与项目团队一起学习">
      <p>课件、板书、检查题和实验会在当前项目的 AI 搭档对话中生成，按课时任务逐步展开。</p>
      <p>回答与操作保存后，由服务端核验学习证据和下一步安排。</p>
      {parentOffline ? <p role="status">当前网络不可用，请恢复网络后继续学习。</p> : (
        <StudentLink className="qitu-button" href={`/student/tutor/${encodeURIComponent(projectId)}`}>
          进入此项目的 AI 搭档
        </StudentLink>
      )}
    </SectionCard>
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
  return (
    <>
      <PracticeChecklist
        tasks={tasks}
        locked={locked}
        theoryHref={projectDetailHref(projectId, { mode: 'learn' })}
        offline={offline}
      />
      <ProjectLearnPanel projectId={projectId} parentOffline={offline} />
    </>
  );
}

function ProjectShowcasePanel({ projectId, offline }: { projectId: string; offline: boolean }) {
  return <ProjectLearnPanel projectId={projectId} parentOffline={offline} />;
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
                parentOffline={offline}
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
