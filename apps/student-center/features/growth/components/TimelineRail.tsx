import { SectionCard } from '@qitu/ui';
import type { StudentGrowthEntry } from '../types';
import { TimelineEntry } from './TimelineEntry';

/**
 * Module-local vertical timeline rail (growth-spec.md §10 OQ3: `StageRail5` /
 * `TimelineRail` are not shipped by `@qitu/ui`). It renders only the four
 * child-visible entry types and offers no way to add, edit, or delete a record.
 */
export function TimelineRail({
  items,
  hasNext = false,
  onLoadMore,
  onSelect,
  loadingMore = false,
}: {
  items: StudentGrowthEntry[];
  hasNext?: boolean;
  onLoadMore?: () => void;
  onSelect?: (entry: StudentGrowthEntry) => void;
  loadingMore?: boolean;
}) {
  return (
    <SectionCard title="成长时间线" padded>
      {items.length === 0 ? (
        <p className="qitu-timeline-empty-hint">还没有记录，下一步就会出现在这里。</p>
      ) : (
        <ol className="qitu-timeline-rail">
          {items.map((item, index) => (
            <TimelineEntry
              key={item.id}
              item={item}
              last={index === items.length - 1 && !hasNext}
              onSelect={onSelect}
            />
          ))}
        </ol>
      )}
      {hasNext && onLoadMore ? (
        <div className="qitu-timeline-more">
          <button
            type="button"
            className="qitu-button qitu-button-ghost"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? '加载中…' : '加载更多'}
          </button>
        </div>
      ) : null}
    </SectionCard>
  );
}
