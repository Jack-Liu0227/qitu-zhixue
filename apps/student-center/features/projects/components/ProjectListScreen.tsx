'use client';

import { useState } from 'react';
import { SkeletonBlock } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import { CreateProjectEntry } from './CreateProjectEntry';
import { NextStepCard } from './NextStepCard';
import { ProjectList } from './ProjectList';
import { ProjectSearch } from './ProjectSearch';
import { ProjectTabs } from './ProjectTabs';
import { ScreenState } from './StateViews';
import { useProjectList, useProjectNextStep } from '../hooks/useProjectsData';
import type { ScreenScenario } from '../lib/loadable';
import type { ProjectTab } from '../types';

export interface ProjectListScreenProps {
  initialTab?: ProjectTab;
  initialQuery?: string;
  /** 五态演示入口；Wave 4 从路由 query 注入。 */
  scenario?: ScreenScenario;
}

/** `/student/projects` 列表屏：进行中 / 草稿 / 已完成 + 搜索 + 下一步。 */
export function ProjectListScreen({
  initialTab = 'active',
  initialQuery = '',
  scenario,
}: ProjectListScreenProps) {
  const [tab, setTab] = useState<ProjectTab>(initialTab);
  const [query, setQuery] = useState(initialQuery);
  const list = useProjectList(tab, query, { scenario });
  const listData =
    list.state.status === 'ready' || list.state.status === 'offline' ? list.state.data : [];
  const primary = listData.find(
    (item) => item.status !== 'completed' && item.status !== 'exploration',
  );
  const nextStep = useProjectNextStep(primary?.id, { scenario });

  return (
    <div className="qitu-projects-list-screen">
      <div className="qitu-screen-toolbar">
        <h1>我的项目</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <StudentLink className="qitu-button" href="/student/growth">查看成长轨迹</StudentLink>
          <CreateProjectEntry />
        </div>
      </div>
      <ProjectTabs active={tab} onChange={setTab} />
      <ProjectSearch value={query} onChange={setQuery} />
      <ScreenState
        state={list.state}
        onRetry={list.retry}
        retrying={list.retrying}
        loading={<SkeletonBlock lines={6} />}
        emptyTitle="还没有项目"
        emptyDescription="去灵感空间找一找，想做的事会变成正式项目。"
        emptyAction={<CreateProjectEntry />}
        render={(projects, offline) => (
          <div className="qitu-projects-layout" style={{ display: 'grid', gap: 16 }}>
            <ProjectList projects={projects} readOnly={offline} />
            {(nextStep.state.status === 'ready' || nextStep.state.status === 'offline') && nextStep.state.data ? (
              <NextStepCard nextStep={nextStep.state.data} disabled={offline} />
            ) : null}
          </div>
        )}
      />
    </div>
  );
}
