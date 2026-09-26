import { HandwrittenNote, SectionCard } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';
import type { NextStep } from '../types';

export interface NextStepCardProps {
  nextStep: NextStep;
  /** 断网 / 阶段锁定时置灰操作，只展示缓存的下一步。 */
  disabled?: boolean;
}

/** 右栏「下一步」橙色卡（验收 6）；数据来自 C10，无数据时不渲染。 */
export function NextStepCard({ nextStep, disabled = false }: NextStepCardProps) {
  return (
    <SectionCard title="下一步">
      <div className="qitu-next-step">
        <h3>{nextStep.title}</h3>
        <p>{nextStep.description}</p>
        {disabled ? (
          <HandwrittenNote>网络恢复后可继续</HandwrittenNote>
        ) : (
          <StudentLink className="qitu-button qitu-button-primary" href={nextStep.deepLink}>
            继续
          </StudentLink>
        )}
      </div>
    </SectionCard>
  );
}
