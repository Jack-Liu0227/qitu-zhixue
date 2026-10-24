import { Button, SectionCard } from '@qitu/ui';
import { normalizeProjectTitle } from '@qitu/contracts';
import type { ParentGrowthEntry } from '../types';
import { formatGrowthDate, parentArtifactHref, parentStageLabel } from './format';

/**
 * 家长端成长时间线。
 *
 * 现代化时间轴卡片设计，展示明确的节点连线、日期胶囊、成长阶段与关联作品链接。
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
        <div className="qitu-parent-timeline-wrapper">
          <ul className="qitu-parent-timeline">
            {items.map((item) => {
              const isProjectComplete = item.title.includes('完成') || item.stage === 'completed';
              return (
                <li key={item.id} className={`qitu-parent-timeline-item ${isProjectComplete ? 'is-complete' : ''}`}>
                  <div className="qitu-parent-timeline-node" aria-hidden="true">
                    <span className="qitu-parent-timeline-dot" />
                  </div>
                  <div className="qitu-parent-timeline-content">
                    <div className="qitu-parent-timeline-header">
                      <time className="qitu-parent-timeline-date">{formatGrowthDate(item.occurredAt)}</time>
                      {item.stage ? (
                        <span className="qitu-parent-stage-pill">{parentStageLabel(item.stage)}</span>
                      ) : null}
                    </div>
                    <div className="qitu-parent-timeline-body">
                      <h3 className="qitu-parent-timeline-title">{item.title}</h3>
                      <p className="qitu-parent-timeline-summary">{item.summaryParent}</p>
                      <div className="qitu-parent-timeline-footer">
                        {item.projectTitle ? (
                          <span className="qitu-parent-project-tag">
                            {normalizeProjectTitle(item.projectTitle)}
                          </span>
                        ) : null}
                        {item.artifactRef ? (
                          <a
                            className="qitu-parent-artifact-link"
                            href={parentArtifactHref(item.artifactRef)}
                          >
                            查看成果作品 →
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
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
