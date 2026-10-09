/**
 * 路由级加载骨架（`/` 与 `/login` 共用）。
 *
 * 覆盖 AGENTS.md 的「loading 状态」要求：首页首屏需要等服务端取回真实数据
 * （学校数 / 精选项目），这段时间用与真实版式同构的骨架占位，避免白屏跳动。
 */
export default function PortalLoading() {
  return (
    <div className="home-page">
      <div className="home-orbs" aria-hidden="true">
        <span className="home-orb home-orb--primary" />
        <span className="home-orb home-orb--mint" />
      </div>

      <main className="portal-skeleton" role="status" aria-busy="true" aria-live="polite">
        <span className="portal-visually-hidden">正在加载页面内容…</span>

        <div className="portal-skeleton-head">
          <span className="portal-skeleton-block portal-skeleton-block--brand" />
          <span className="portal-skeleton-block portal-skeleton-block--badge" />
          <span className="portal-skeleton-block portal-skeleton-block--title" />
          <span className="portal-skeleton-block portal-skeleton-block--title portal-skeleton-block--short" />
          <span className="portal-skeleton-block portal-skeleton-block--line" />
          <span className="portal-skeleton-block portal-skeleton-block--line portal-skeleton-block--short" />
          <div className="portal-skeleton-actions">
            <span className="portal-skeleton-block portal-skeleton-block--button" />
            <span className="portal-skeleton-block portal-skeleton-block--button" />
          </div>
        </div>

        <div className="portal-skeleton-grid" aria-hidden="true">
          <span className="portal-skeleton-card" />
          <span className="portal-skeleton-card" />
          <span className="portal-skeleton-card" />
        </div>
      </main>
    </div>
  );
}
