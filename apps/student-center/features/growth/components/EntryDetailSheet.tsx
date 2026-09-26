'use client';

import { TagChips } from '@qitu/ui';
import type { StudentGrowthEntry } from '../types';
import { formatGrowthDate } from './format';
import { ReflectionQuote } from './ReflectionQuote';

/**
 * Client island: expandable detail for a single growth entry. It renders only
 * the narrow student projection fields — there are no parent/mentor/risk
 * fields on `StudentGrowthEntry` to render.
 */
export function EntryDetailSheet({
  entry,
  onClose,
}: {
  entry: StudentGrowthEntry | null;
  onClose: () => void;
}) {
  if (entry === null) {
    return null;
  }

  return (
    <div className="qitu-entry-sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="qitu-entry-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={entry.title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="qitu-entry-sheet-header">
          <div>
            <h2 className="qitu-entry-sheet-title">{entry.title}</h2>
            <p className="qitu-entry-sheet-meta">
              {formatGrowthDate(entry.occurredAt)}
              {entry.projectTitle ? ` · ${entry.projectTitle}` : ''}
            </p>
          </div>
          <button type="button" className="qitu-button qitu-button-ghost" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="qitu-entry-sheet-body">
          {entry.type === 'reflection_created' ? (
            <ReflectionQuote>{entry.summaryStudent}</ReflectionQuote>
          ) : (
            <p className="qitu-entry-summary">{entry.summaryStudent}</p>
          )}
          {entry.objectiveTitles.length > 0 ? (
            <TagChips tags={entry.objectiveTitles} tone="completed" />
          ) : null}
          {entry.encouragement ? (
            <p className="qitu-entry-sheet-encouragement">{entry.encouragement}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
