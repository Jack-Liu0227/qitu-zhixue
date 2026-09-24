import { AppShell, StatCard } from '@qitu/ui';
import { PRODUCT_NAME, colors } from '@qitu/design-tokens';

export default function ParentHomePage() {
  return (
    <AppShell title={`${PRODUCT_NAME} · 家长陪伴中心`} accent={colors.completed}>
      <section className="hero">
        <p className="eyebrow">PARENT COMPANION / M0</p>
        <h1>看见学习过程，也看见成长证据。</h1>
        <p>家长陪伴中心的工程壳层已初始化，默认只展示授权后的脱敏成长快照。</p>
      </section>
      <div className="stats-grid">
        <StatCard label="学习次数" value="0" />
        <StatCard label="投入时长" value="0 分钟" />
        <StatCard label="项目进度" value="待同步" />
      </div>
    </AppShell>
  );
}
