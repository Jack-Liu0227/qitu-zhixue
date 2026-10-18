import { RobotMascot } from '@qitu/ui';

export function ProjectVisual({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact ? 'project-visual is-compact' : 'project-visual'}
    >
      <span className="project-visual-glow" />
      <span className="project-visual-desk" />
      <RobotMascot size={compact ? 60 : 96} />
    </div>
  );
}
