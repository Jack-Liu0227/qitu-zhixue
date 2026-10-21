'use client';

import type { WorkbenchProject } from '../types/workbench';

export interface WorkbenchHeaderProps {
  project: WorkbenchProject;
}

export function WorkbenchHeader({ project }: WorkbenchHeaderProps) {
  return (
    <header className="qitu-workbench-header">
      <div className="qitu-workbench-header-main">
        <div className="qitu-workbench-cover" aria-hidden="true">
          {project.coverUrl ? <img src={project.coverUrl} alt="" /> : <span>封面</span>}
        </div>
        <div className="qitu-workbench-title">
          <h1>{project.title}</h1>
          <p className="qitu-workbench-subtitle">制作工作台</p>
        </div>
      </div>
    </header>
  );
}
