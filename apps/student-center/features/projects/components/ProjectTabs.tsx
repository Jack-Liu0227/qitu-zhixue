'use client';

import { PROJECT_TABS } from '../constants';
import type { ProjectTab } from '../types';

export interface ProjectTabsProps {
  active: ProjectTab;
  onChange: (tab: ProjectTab) => void;
}

/** 进行中 / 草稿 / 已完成。切换只改请求 query，不改导航（验收 3）。 */
export function ProjectTabs({ active, onChange }: ProjectTabsProps) {
  return (
    <div className="qitu-project-tabs" role="tablist" aria-label="项目分组">
      {PROJECT_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className={tab.id === active ? 'qitu-tab is-active' : 'qitu-tab'}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
