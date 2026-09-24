import { AppShell, StatCard } from '@qitu/ui';
import { PRODUCT_NAME, colors } from '@qitu/design-tokens';

export default function AdminHomePage() {
  return (
    <AppShell title={`${PRODUCT_NAME} · 平台管理后台`} accent={colors.heading}>
      <section className="hero">
        <p className="eyebrow">ADMIN CONSOLE / M0</p>
        <h1>让账户、策略、模板和审计保持可追溯。</h1>
        <p>平台管理后台的工程壳层已初始化，后续接入账户、项目模板、AI 策略和审计。</p>
      </section>
      <div className="stats-grid">
        <StatCard label="账户总数" value="0" />
        <StatCard label="模板版本" value="0" />
        <StatCard label="审计事件" value="0" />
      </div>
    </AppShell>
  );
}
