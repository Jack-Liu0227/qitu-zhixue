import { SectionCard, StatTriple } from '@qitu/ui';
import type { ParentGrowthSummary } from '../types';

/**
 * 正向、过程性计数（连续天数 / 完成项目 / 掌握目标 / 发布作品）。
 *
 * 契约类型里刻意没有分数、排名、等级或百分位，这里也不渲染任何此类内容。
 */
export function ParentGrowthSummaryCard({ summary }: { summary: ParentGrowthSummary }) {
  const items = [
    { label: '连续天数', value: String(summary.streakDays), tone: 'completed' as const },
    { label: '完成项目', value: String(summary.projectsCompleted), tone: 'default' as const },
    { label: '掌握目标', value: String(summary.objectivesMastered), tone: 'default' as const },
    { label: '发布作品', value: String(summary.artifactsPublished), tone: 'attention' as const },
  ];

  return (
    <SectionCard title={`${summary.childDisplayName} 的成长小计`}>
      <StatTriple items={items} />
      <p className="qitu-parent-sync-note">
        这份成长轨迹与孩子在自己的成长轨迹里看到的是同一份服务端记录，家长端只展示脱敏后的过程性内容。
      </p>
    </SectionCard>
  );
}
