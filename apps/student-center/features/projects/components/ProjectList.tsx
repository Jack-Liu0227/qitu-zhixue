import { SectionCard } from '@qitu/ui';
import type { ReactNode } from 'react';
import { ProjectCard } from './ProjectCard';
import type { ProjectListItem } from '../types';

export interface ProjectListProps {
  projects: ProjectListItem[];
  readOnly?: boolean;
  renderActions?: (project:ProjectListItem)=>ReactNode;
}

/** 项目卡网格；断网只读时卡片不可进入制作。 */
export function ProjectList({ projects, readOnly = false,renderActions }: ProjectListProps) {
  return (
    <SectionCard title="我的项目">
      <div className="qitu-project-grid" style={{ display: 'grid', gap: 16 }}>
        {projects.map((project) => (
          <div key={`${project.kind ?? 'project'}:${project.id}`}>
            <ProjectCard project={project} readOnly={readOnly} />
            {renderActions?.(project)}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
