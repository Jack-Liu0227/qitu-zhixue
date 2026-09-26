'use client';

import type { TemplateStage } from '@qitu/contracts';
import { StageBadge } from '@qitu/ui';

export interface StageRailProps {
  /** Same `TemplateStage[]` source as `WorkbenchHeader` — never a hardcoded count. */
  stages: TemplateStage[];
  /** Display index only. Never used for a stage-gate decision. */
  activeIndex: number;
}

export function StageRail({ stages, activeIndex }: StageRailProps) {
  return (
    <aside className="qitu-stage-rail" aria-label="阶段轨道">
      <p className="qitu-stage-rail-current">
        当前处于第 {Math.min(activeIndex + 1, Math.max(stages.length, 1))} 阶段
      </p>
      {stages.length === 0 ? (
        <p className="qitu-stage-rail-empty">暂时没有阶段信息</p>
      ) : (
        <ol className="qitu-stage-rail-list">
          {stages.map((stage, index) => {
            const tone =
              index < activeIndex
                ? 'done'
                : index === activeIndex
                  ? 'current'
                  : ('locked' as const);
            return (
              <li key={stage.id} className={`qitu-stage-rail-item is-${index === activeIndex ? 'current' : 'other'}`}>
                <span className="qitu-stage-rail-dot" aria-hidden="true" />
                <StageBadge label={stage.label} tone={tone} />
              </li>
            );
          })}
        </ol>
      )}
      <p className="qitu-stage-rail-note">阶段由服务端模板决定，这里只做展示。</p>
    </aside>
  );
}
