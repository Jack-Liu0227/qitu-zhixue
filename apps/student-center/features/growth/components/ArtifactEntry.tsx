import type { StudentGrowthEntry } from '../types';
import { StudentLink } from '../../../components/student-link';
import { EntryFooter } from './EntryFooter';
import { ObjectiveChip } from './ObjectiveChip';

/**
 * A published-artifact card. Links to the student's own work in the 作品展厅
 * module; the growth page itself stays read-only and offers no edit affordance.
 */
export function ArtifactEntry({
  entry,
  onSelect,
}: {
  entry: StudentGrowthEntry;
  onSelect?: (entry: StudentGrowthEntry) => void;
}) {
  const href = entry.artifactRef ? `/student/works/${entry.artifactRef}` : null;

  return (
    <article className="qitu-artifact-entry">
      <div className="qitu-artifact-cover" aria-hidden="true">
        <span className="qitu-artifact-cover-mark">作品</span>
      </div>
      <div className="qitu-artifact-body">
        {entry.projectTitle ? <p className="qitu-entry-context">{entry.projectTitle}</p> : null}
        <p className="qitu-entry-summary">{entry.summaryStudent}</p>
        <ObjectiveChip titles={entry.objectiveTitles} />
        {href ? (
          <StudentLink className="qitu-button qitu-button-primary qitu-artifact-link" href={href}>
            去作品展厅看看
          </StudentLink>
        ) : null}
        <EntryFooter entry={entry} onSelect={onSelect} />
      </div>
    </article>
  );
}
