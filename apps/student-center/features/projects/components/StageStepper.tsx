import { StageBadge } from '@qitu/ui';
import type { TemplateStage } from '../types';

export interface StageStepperProps {
  /** 冻结模板的 TemplateStage[]；数量（4 或 5）完全来自服务端，组件不写死。 */
  stages: TemplateStage[];
  activeIndex: number;
}

/**
 * 模块内 4/5 阶段条（StageStepper4 等价物）。
 *
 * 不硬编码阶段数，也不硬编码阶段名——全部来自 `stages`；工作台顶部复用此组件。
 */
export function StageStepper({ stages, activeIndex }: StageStepperProps) {
  return (
    <ol
      className="qitu-stage-stepper"
      aria-label="项目阶段"
      style={{ display: 'flex', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}
    >
      {stages.map((stage, index) => {
        const tone = index < activeIndex ? 'done' : index === activeIndex ? 'current' : 'locked';
        return (
          <li key={stage.id} style={{ flex: 1, textAlign: 'center' }}>
            <StageBadge label={stage.label} tone={tone} />
          </li>
        );
      })}
    </ol>
  );
}
