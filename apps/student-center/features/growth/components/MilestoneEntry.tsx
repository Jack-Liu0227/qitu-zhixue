import type { StudentGrowthEntry } from '../types';
import { EntryFooter } from './EntryFooter';
import { ObjectiveChip } from './ObjectiveChip';

/**
 * A project milestone (stage/project completed) card. The `source_type` title
 * and `summaryStudent` come from the server already strength-based.
 */
export function MilestoneEntry({
  entry,
  onSelect,
}: {
  entry: StudentGrowthEntry;
  onSelect?: (entry: StudentGrowthEntry) => void;
}) {
  return (
    <article className="qitu-milestone-entry">
      {entry.projectTitle ? (
        <p className="qitu-entry-context">{entry.projectTitle}</p>
      ) : null}
      <p className="qitu-entry-summary">{entry.summaryStudent}</p>
      <ObjectiveChip titles={entry.objectiveTitles} />
      <EntryFooter entry={entry} onSelect={onSelect} />
    </article>
  );
}
