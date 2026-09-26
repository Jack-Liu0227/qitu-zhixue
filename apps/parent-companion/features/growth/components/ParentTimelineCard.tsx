import { Badge, Button, SectionCard } from '@qitu/ui';
import type { ParentGrowthEntry } from '../types';
import { formatGrowthDate, parentArtifactHref, parentStageLabel } from './format';

/**
 * 家长端成长时间线。
 *
 * 每行只渲染家长投影字段：日期、标题、`summaryParent`、项目名与阶段（若有）、
 * 作品链接（若有 `artifactRef`）。不渲染 icon / 分数 / 排名 / 风险标签。
 */
export function ParentTimelineCard({
  items,
  hasNext,
  loadingMore,
  onLoadMore,
}: {
  items: ParentGrowthEntry[];
  hasNext: boolean;
  loadingMore: boolean;
  onLoadMore?: () => void;
}) {
  return (
    <SectionCard title="成长时间线" padded>
      {items.length === 0 ? (
        <p className="qitu-parent-timeline-empty">还没有记录，下一步就会出现在这里。</p>
      ) : (
        <ol className="qitu-parent-timeline">
          {items.map((item) => (
            <li key={item.id} className="qitu-parent-timeline-item">
              <time className="qitu-parent-timeline-date">{formatGrowthDate(item.occurredAt)}</time>
              <div className="qitu-parent-timeline-body">
                <h3 className="qitu-parent-timeline-title">{item.title}</h3>
                <p className="qitu-parent-timeline-summary">{item.summaryParent}</p>
                {item.projectTitle || item.stage ? (
                  <div className="qitu-parent-timeline-meta">
                    {item.projectTitle ? <Badge tone="primary">{item.projectTitle}</Badge> : null}
                    {item.stage ? <Badge tone="neutral">{parentStageLabel(item.stage)}</Badge> : null}
                  </div>
                ) : null}
                {item.artifactRef ? (
                  <a className="qitu-parent-artifact-link" href={parentArtifactHref(item.artifactRef)}>
                    查看作品
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {hasNext && onLoadMore ? (
        <div className="qitu-parent-timeline-more">
          <Button variant="ghost" onClick={onLoadMore} loading={loadingMore}>
            {loadingMore ? '加载中…' : '加载更多'}
          </Button>
        </div>
      ) : null}
    </SectionCard>
  );
}
