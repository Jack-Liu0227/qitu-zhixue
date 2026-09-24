import { AppShell, StatCard } from '@qitu/ui';
import { PRODUCT_NAME, colors } from '@qitu/design-tokens';

export default function StudentHomePage() {
  return (
    <AppShell title={`${PRODUCT_NAME} · 学生学习中心`} accent={colors.primary}>
      <section className="hero">
        <p className="eyebrow">STUDENT CENTER / M0</p>
        <h1>今天，从一个值得探索的问题开始。</h1>
        <p>学生学习中心的工程壳层已初始化，后续接入灵感空间、AI 导师和项目学习。</p>
      </section>
      <div className="stats-grid">
        <StatCard label="当前项目" value="待开始" />
        <StatCard label="今日任务" value="0" />
        <StatCard label="连续学习" value="0 天" />
      </div>
    </AppShell>
  );
}
