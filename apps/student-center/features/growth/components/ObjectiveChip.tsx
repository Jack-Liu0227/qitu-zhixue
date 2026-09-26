import { TagChips } from '@qitu/ui';

/**
 * Mastered-objective chips, phrased as 「我学会了…」 — positive, never a score
 * (growth-spec.md §6). Empty input renders nothing.
 */
export function ObjectiveChip({ titles }: { titles: string[] }) {
  if (titles.length === 0) {
    return null;
  }
  return (
    <div className="qitu-objective-chip">
      <span className="qitu-objective-chip-prefix">我学会了</span>
      <TagChips tags={titles} tone="completed" />
    </div>
  );
}
