import type { StudentGrowthEntry } from '../types';
import { EntryFooter } from './EntryFooter';
import { ReflectionQuote } from './ReflectionQuote';

/**
 * The child's own 自述/反思 (matrix row 6: student sees their own). The page
 * shows the server-provided student summary only; guardian/mentor text never
 * enters this component.
 */
export function ReflectionEntry({
  entry,
  onSelect,
}: {
  entry: StudentGrowthEntry;
  onSelect?: (entry: StudentGrowthEntry) => void;
}) {
  return (
    <article className="qitu-reflection-entry">
      {entry.projectTitle ? <p className="qitu-entry-context">{entry.projectTitle}</p> : null}
      <ReflectionQuote>{entry.summaryStudent}</ReflectionQuote>
      <EntryFooter entry={entry} onSelect={onSelect} />
    </article>
  );
}
