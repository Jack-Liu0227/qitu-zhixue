import { VisualAsset } from '@qitu/ui';

export function ProjectVisual({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact ? 'project-visual is-compact' : 'project-visual'}
    >
      <span className="project-visual-glow" />
      <span className="project-visual-desk" />
      <VisualAsset assetId="support-review-v1" size={compact ? 60 : 96} />
    </div>
  );
}
