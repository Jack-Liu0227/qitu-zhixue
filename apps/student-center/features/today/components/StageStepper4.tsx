import { StageBadge } from '@qitu/ui';

import type { ProjectStageView } from '../types';

/**
 * Module-local stage progress strip. `@qitu/ui` does not export
 * `StageStepper4` yet (Wave 3 unavailable list). It is display-only: stage
 * statuses are server-computed and are never used for gate decisions here.
 */
export function StageStepper4({ stages }: { stages: ProjectStageView[] }) {
  return (
    <ol
      className="qitu-stage-stepper"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        listStyle: 'none',
        margin: 0,
        padding: 0,
      }}
    >
      {stages.map((stage) => (
        <li key={stage.stageId} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StageBadge
            label={`${stage.index}. ${stage.name}`}
            tone={
              stage.status === 'done' ? 'done' : stage.status === 'active' ? 'current' : 'locked'
            }
          />
        </li>
      ))}
    </ol>
  );
}
