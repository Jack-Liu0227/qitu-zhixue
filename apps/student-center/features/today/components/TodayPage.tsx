'use client';

/**
 * 「今天」page composition root.
 *
 * Owns the five screen states and renders the §4.2 block order:
 * 今天 heading → 从一个想法开始 → 当前项目 → 今日任务 → AI搭档建议.
 * It never writes project state / task completion / AI decisions / growth
 * records / audit — all of those are server-owned.
 */
import { ErrorState, OfflineBanner, PermissionDenied, SectionCard, SkeletonBlock } from '@qitu/ui';

import { todayDataSource } from '../data';
import type { TodayDataSource } from '../data';
import { useTodayData } from '../hooks/useTodayData';
import { AiSuggestionCard } from './AiSuggestionCard';
import { ContinueProjectCard } from './ContinueProjectCard';
import { IdeaStartSection } from './IdeaStartSection';
import { TodayHeader } from './TodayHeader';
import { TodayLoading } from './TodayLoading';
import { TodayTaskCard } from './TodayTaskCard';

export interface TodayPageProps {
  /** Injectable data source; defaults to the module's swappable binding. */
  dataSource?: TodayDataSource;
  /** Called on 401 so route wiring / AuthGuard can redirect to login. */
  onUnauthenticated?: () => void;
  onBack?: () => void;
}

export function TodayPage({
  dataSource = todayDataSource,
  onUnauthenticated,
  onBack,
}: TodayPageProps) {
  const { state, offline, view, project, projectState, errorCode, retrying, retry } = useTodayData(
    dataSource,
    { onUnauthenticated },
  );

  const currentStageId = project
    ? project.stages.find((stage) => stage.status === 'active')?.stageId ?? null
    : null;

  return (
    <div className="qitu-today-page" style={{ display: 'grid', gap: 16 }}>
      {offline ? <OfflineBanner readOnly onRetry={retry} /> : null}

      {state === 'loading' ? <TodayLoading /> : null}

      {state === 'permission-denied' ? (
        <PermissionDenied
          title="无法访问「今天」"
          description="当前账号没有查看该学生数据的权限。如有疑问请联系班主任。"
          onBack={onBack}
        />
      ) : null}

      {state === 'error' ? (
        <ErrorState
          title="今天的内容加载失败"
          description="请稍后重试，其它页面仍可正常使用。"
          errorCode={errorCode ?? undefined}
          onRetry={retry}
          retrying={retrying}
        />
      ) : null}

      {state === 'offline' && !view ? (
        <ErrorState
          title="当前处于离线状态"
          description="网络恢复后会自动刷新。"
          onRetry={retry}
          retrying={retrying}
        />
      ) : null}

      {view && (state === 'ready' || state === 'empty' || state === 'offline') ? (
        <>
          <TodayHeader date={view.date} />
          <IdeaStartSection
            directions={view.directions}
            exploreHref={view.quickStart.exploreHref}
          />
          {projectState === 'loading' ? (
            <SectionCard title="当前项目">
              <SkeletonBlock lines={4} />
            </SectionCard>
          ) : projectState === 'error' ? (
            <SectionCard title="当前项目">
              <ErrorState title="当前项目加载失败" onRetry={retry} retrying={retrying} />
            </SectionCard>
          ) : (
            <ContinueProjectCard project={project} />
          )}
          <TodayTaskCard
            tasks={view.tasks}
            hasActiveProject={view.hasActiveProject}
            currentStageId={currentStageId}
            exploreHref={view.quickStart.exploreHref}
          />
          <AiSuggestionCard suggestion={view.suggestion} />
        </>
      ) : null}
    </div>
  );
}
