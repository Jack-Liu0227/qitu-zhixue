import { EmptyState, ErrorState, OfflineBanner, PermissionDenied, SkeletonBlock } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import type { TutorLoadStatus, TutorProjectContext, TutorViewError } from '../types';
import { CurrentTask } from './CurrentTask';
import { ProjectCard } from './ProjectCard';
import { StageProgress } from './StageProgress';

/**
 * LEFT COLUMN — 「项目卡 + 阶段进度 + 当前任务」.
 *
 * PURE DISPLAY PROJECTION. Every value here comes from the server
 * (`/projects/:id` + `/stages` + `/tasks`). `currentStageIndex` /
 * `progressPercent` are ILLUSTRATIVE ONLY: if this page ever needs a stage
 * gate, it MUST read `project.stage` (`ProjectStage`, the server state machine)
 * and never these display fields. This panel is not a second source of truth
 * and contains no write path.
 */
export function ProjectContextPanel({
  status,
  project,
  error,
  offline,
  permissionDenied,
  onRetry,
  onReconnect,
}: {
  status: TutorLoadStatus;
  project: TutorProjectContext | null;
  error: TutorViewError | null;
  offline: boolean;
  permissionDenied: boolean;
  onRetry: () => void;
  onReconnect: () => void;
}) {
  if (permissionDenied) {
    return (
      <div className="qitu-tutor-col qitu-tutor-col-left">
        <PermissionDenied title="无法查看这个项目" description="你没有访问这个项目的权限。" />
      </div>
    );
  }

  return (
    <div className="qitu-tutor-col qitu-tutor-col-left">
      {offline ? <OfflineBanner readOnly onRetry={onReconnect} /> : null}

      {status === 'loading' ? (
        <div className="qitu-tutor-panel-loading" aria-busy="true">
          <SkeletonBlock lines={4} height={20} />
          <SkeletonBlock lines={3} />
          <SkeletonBlock lines={2} />
        </div>
      ) : null}

      {status === 'empty' ? (
        <EmptyState
          title="还没有进行中的项目"
          description="先去灵感空间把兴趣变成一个小项目，AI搭档就能陪你一起学了。"
          action={
            <StudentLink className="qitu-button qitu-button-primary" href="/student/inspiration">
              去灵感空间
            </StudentLink>
          }
        />
      ) : null}

      {status === 'error' ? (
        <ErrorState
          title="项目信息加载失败"
          description={error?.message}
          errorCode={error?.code}
          onRetry={onRetry}
        />
      ) : null}

      {status === 'ready' && project !== null ? (
        <div className="qitu-tutor-left-cards">
          <ProjectCard project={project.project} />
          <StageProgress stages={project.stages} progress={project.progress} />
          <CurrentTask task={project.currentTask} />
        </div>
      ) : null}
    </div>
  );
}
