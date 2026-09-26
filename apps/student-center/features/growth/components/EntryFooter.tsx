import { HandwrittenNote } from '@qitu/ui';
import type { StudentGrowthEntry } from '../types';

/**
 * Shared footer for timeline cards: the server-computed encouragement note (if
 * any) and the detail affordance. The note is already child-facing wording
 * produced through `projection-gate.ts`; no raw internal label can reach here.
 */
export function EntryFooter({
  entry,
  onSelect,
}: {
  entry: StudentGrowthEntry;
  onSelect?: (entry: StudentGrowthEntry) => void;
}) {
  return (
    <div className="qitu-entry-footer">
      {entry.encouragement ? (
        <HandwrittenNote rotate={-2}>{entry.encouragement}</HandwrittenNote>
      ) : null}
      {onSelect ? (
        <button
          type="button"
          className="qitu-button qitu-button-ghost qitu-entry-detail-button"
          onClick={() => onSelect(entry)}
        >
          查看详情
        </button>
      ) : null}
    </div>
  );
}
