import type { StudentGrowthEntry } from '../types';
import { ArtifactEntry } from './ArtifactEntry';
import { formatGrowthDate } from './format';
import { MilestoneEntry } from './MilestoneEntry';
import { ObjectiveChip } from './ObjectiveChip';
import { ObservationNote } from './ObservationNote';
import { ReflectionEntry } from './ReflectionEntry';
import { VersionStep } from './VersionStep';

const ICON_GLYPH: Record<StudentGrowthEntry['icon'], string> = {
  stage: '◆',
  artifact: '★',
  reflection: '✎',
  objective: '✓',
};

/**
 * One timeline row. Dispatches to the child-safe card for its (already narrow,
 * four-value) `type`. An adult-only source type is not representable here.
 */
export function TimelineEntry({
  item,
  last = false,
  onSelect,
}: {
  item: StudentGrowthEntry;
  last?: boolean;
  onSelect?: (entry: StudentGrowthEntry) => void;
}) {
  return (
    <VersionStep
      tone="done"
      label={item.title}
      meta={formatGrowthDate(item.occurredAt)}
      last={last}
    >
      <span className="qitu-entry-icon" aria-hidden="true">
        {ICON_GLYPH[item.icon]}
      </span>
      {item.type === 'project_stage_completed' ? (
        <MilestoneEntry entry={item} onSelect={onSelect} />
      ) : null}
      {item.type === 'artifact_published' ? (
        <ArtifactEntry entry={item} onSelect={onSelect} />
      ) : null}
      {item.type === 'reflection_created' ? (
        <ReflectionEntry entry={item} onSelect={onSelect} />
      ) : null}
      {item.type === 'objective_mastered' ? (
        <article className="qitu-objective-entry">
          {item.projectTitle ? <p className="qitu-entry-context">{item.projectTitle}</p> : null}
          <p className="qitu-entry-summary">{item.summaryStudent}</p>
          <ObjectiveChip titles={item.objectiveTitles} />
          <ObservationNote state={item.observationState} />
        </article>
      ) : null}
    </VersionStep>
  );
}
