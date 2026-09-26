import { SectionCard } from '@qitu/ui';
import { StudentLink } from '../../../components/student-link';

import type { IdeaDirection } from '../types';
import { DirectionCard } from './DirectionCard';

/**
 * 「从一个想法开始」3 方向卡 + 进入灵感空间。
 * Data source for these cards is still Q2 (reuse C4 vs extend C1); the
 * component is read-only and only navigates.
 */
export function IdeaStartSection({
  directions,
  exploreHref = '/student/inspiration',
}: {
  directions: IdeaDirection[];
  exploreHref?: string;
}) {
  return (
    <SectionCard
      title="从一个想法开始"
      action={<StudentLink href={exploreHref}>进入灵感空间</StudentLink>}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        {directions.map((direction) => (
          <DirectionCard key={direction.templateId} direction={direction} />
        ))}
      </div>
    </SectionCard>
  );
}
