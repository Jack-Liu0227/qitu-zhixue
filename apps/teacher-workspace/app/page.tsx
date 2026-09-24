import { AppShell, StatCard } from '@qitu/ui';
import { PRODUCT_NAME, colors } from '@qitu/design-tokens';

export default function TeacherHomePage() {
  return (
    <AppShell title={`${PRODUCT_NAME} · 班主任工作台`} accent={colors.attention}>
      <section className="hero">
        <p className="eyebrow">TEACHER WORKSPACE / M0</p>
        <h1>把需要人工介入的问题，及时变成可行动的任务。</h1>
        <p>班主任工作台的工程壳层已初始化，后续接入学生档案、问题处理和干预流程。</p>
      </section>
      <div className="stats-grid">
        <StatCard label="负责学生" value="0" />
        <StatCard label="进行中项目" value="0" />
        <StatCard label="待处理问题" value="0" />
      </div>
    </AppShell>
  );
}
