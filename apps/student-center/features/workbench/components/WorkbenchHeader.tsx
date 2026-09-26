'use client';

import type { TemplateStage } from '@qitu/contracts';
import { ProgressBar } from '@qitu/ui';
import type { WorkbenchProject } from '../types/workbench';

export interface WorkbenchHeaderProps {
  project: WorkbenchProject;
  /** Same `TemplateStage[]` source as `StageRail` — never a hardcoded count. */
  stages: TemplateStage[];
  /** Display index only. Never used for a stage-gate decision. */
  activeIndex: number;
}

export function WorkbenchHeader({ project, stages, activeIndex }: WorkbenchHeaderProps) {
  return (
    <header className="qitu-workbench-header">
      <div className="qitu-workbench-header-main">
        <div className="qitu-workbench-cover" aria-hidden="true">
          {project.coverUrl ? <img src={project.coverUrl} alt="" /> : <span>封面</span>}
        </div>
        <div className="qitu-workbench-title">
          <h1>{project.title}</h1>
          <p className="qitu-workbench-subtitle">制作工作台</p>
          <ProgressBar percent={project.progressPercent} label="项目进度" />
        </div>
      </div>
      <ol className="qitu-workbench-stepbar" aria-label="项目阶段">
        {stages.map((stage, index) => {
          const tone =
            index < activeIndex ? 'is-done' : index === activeIndex ? 'is-current' : 'is-upcoming';
          return (
            <li key={stage.id} className={`qitu-workbench-step ${tone}`}>
              <span className="qitu-workbench-step-index">{index + 1}</span>
              <span className="qitu-workbench-step-label">{stage.label}</span>
            </li>
          );
        })}
      </ol>
    </header>
  );
}
