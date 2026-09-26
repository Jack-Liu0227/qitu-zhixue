import { SectionCard, StatTriple } from '@qitu/ui';
import type { StudentGrowthSummary } from '../types';

/**
 * Positive, non-ranking counts only (growth-spec.md §3.3, §6). No score, no
 * rank, no average, no peer comparison is representable by the data type or
 * rendered here.
 */
export function GrowthSummaryCard({
  summary,
  brandNew = false,
}: {
  summary: StudentGrowthSummary;
  brandNew?: boolean;
}) {
  const items = [
    { label: '连续学习（天）', value: String(summary.streakDays), tone: 'completed' as const },
    { label: '完成项目', value: String(summary.projectsCompleted), tone: 'default' as const },
    { label: '掌握目标', value: String(summary.objectivesMastered), tone: 'default' as const },
    { label: '发布作品', value: String(summary.artifactsPublished), tone: 'attention' as const },
  ];

  return (
    <SectionCard title={brandNew ? '从今天开始记录' : '我的成长小计'}>
      <StatTriple items={items} />
      <p className="qitu-growth-summary-note">
        {brandNew
          ? '完成第一个小目标后，这里就会亮起来。'
          : '这些都是你自己一步步攒起来的。'}
      </p>
    </SectionCard>
  );
}
