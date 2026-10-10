'use client';

import { useState } from 'react';
import { EmptyState, ErrorState, OfflineBanner, PermissionDenied, SkeletonBlock } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import type { TutorLoadStatus, TutorProjectContext, TutorViewError } from '../types';
import { CurrentTask } from './CurrentTask';
import { PinnedSourcesRail, type PinnedSourceItem } from './PinnedSourcesRail';
import { ProjectCard } from './ProjectCard';
import { StageProgress } from './StageProgress';

/**
 * LEFT COLUMN — 「Pinned sources (固定材料) + 项目卡与阶段进度」.
 *
 * Echoes the reference design with a prominent NotebookLM-style "Pinned sources"
 * rail, while preserving the full read-only PBL stage machine display.
 */
export function ProjectContextPanel({
  status,
  project,
  error,
  offline,
  permissionDenied,
  onRetry,
  onReconnect,
  onSelectSource,
  activeSourceIndex,
}: {
  status: TutorLoadStatus;
  project: TutorProjectContext | null;
  error: TutorViewError | null;
  offline: boolean;
  permissionDenied: boolean;
  onRetry: () => void;
  onReconnect: () => void;
  onSelectSource?: (source: PinnedSourceItem) => void;
  activeSourceIndex?: number | null;
}) {
  const [activeTab, setActiveTab] = useState<'sources' | 'stages'>('sources');

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

      <div className="qitu-tutor-left-tabs" role="tablist" aria-label="左侧视图切换">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'sources'}
          className={`qitu-tutor-tab-button${activeTab === 'sources' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('sources')}
        >
          📌 固定材料
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'stages'}
          className={`qitu-tutor-tab-button${activeTab === 'stages' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('stages')}
        >
          🎯 项目阶段
        </button>
      </div>

      {activeTab === 'sources' ? (
        <div className="qitu-tutor-left-cards">
          <PinnedSourcesRail
            project={project}
            onSelectSource={onSelectSource}
            activeSourceIndex={activeSourceIndex}
          />
          {status === 'ready' && project !== null && (
            <div className="qitu-pinned-project-brief">
              <span className="qitu-pinned-brief-label">当前课题</span>
              <strong>{project.project.title}</strong>
              <p>阶段：{project.stages[project.progress.currentStageIndex]?.label ?? '探索中'}</p>
            </div>
          )}
        </div>
      ) : (
        <>
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
                <StudentLink
                  className="qitu-button qitu-button-primary"
                  href="/student/inspiration"
                >
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
        </>
      )}
    </div>
  );
}
