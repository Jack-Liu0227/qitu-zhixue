import type { StageProgressDisplay, TemplateStage } from '@qitu/contracts';
import { ProgressBar, SectionCard, StageBadge } from '@qitu/ui';

/**
 * Left-column stage rail. DISPLAY PROJECTION ONLY.
 *
 * `currentStageIndex` / `progressPercent` are explicitly illustrative and are
 * NEVER read for an authorization or stage-gate decision — gates read the
 * server `ProjectStage` (see `ProjectContextPanel`).
 */
export function StageProgress({
  stages,
  progress,
}: {
  stages: TemplateStage[];
  progress: StageProgressDisplay;
}) {
  return (
    <SectionCard title="阶段进度">
      <ProgressBar percent={progress.progressPercent} label={`${progress.currentStageIndex + 1}/${progress.stageTotal}`} />
      <ol className="qitu-tutor-stage-rail">
        {stages.map((stage, index) => {
          const tone =
            index < progress.currentStageIndex
              ? 'done'
              : index === progress.currentStageIndex
                ? 'current'
                : 'locked';
          return (
            <li key={stage.id} className="qitu-tutor-stage-item">
              <StageBadge label={stage.label} tone={tone} />
            </li>
          );
        })}
      </ol>
    </SectionCard>
  );
}
