import { SectionCard } from '@qitu/ui';
import { ProjectCard } from './ProjectCard';
import type { ProjectListItem } from '../types';

export interface ProjectListProps {
  projects: ProjectListItem[];
  readOnly?: boolean;
}

/** 项目卡网格；断网只读时卡片不可进入制作。 */
export function ProjectList({ projects, readOnly = false }: ProjectListProps) {
  return (
    <SectionCard title="我的项目">
      <div className="qitu-project-grid" style={{ display: 'grid', gap: 16 }}>
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} readOnly={readOnly} />
        ))}
      </div>
    </SectionCard>
  );
}
