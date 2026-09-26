import { SectionCard, SkeletonBlock } from '@qitu/ui';

/**
 * Loading state: one skeleton per region so the first paint has no layout
 * shift. Reached while C1–C3 are in flight.
 */
export function TodayLoading() {
  return (
    <div style={{ display: 'grid', gap: 16 }} aria-busy="true" aria-live="polite">
      <SkeletonBlock lines={1} height={28} width="30%" />
      <SectionCard title="从一个想法开始">
        <SkeletonBlock lines={3} height={64} />
      </SectionCard>
      <SectionCard title="当前项目">
        <SkeletonBlock lines={4} height={16} />
      </SectionCard>
      <SectionCard title="今日任务">
        <SkeletonBlock lines={3} height={48} />
      </SectionCard>
      <SectionCard title="AI搭档建议">
        <SkeletonBlock lines={2} height={16} />
      </SectionCard>
    </div>
  );
}
