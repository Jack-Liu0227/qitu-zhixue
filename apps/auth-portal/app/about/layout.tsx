import './about-base.css';

/**
 * `/about` 的布局。
 *
 * 只做一件事：把「关于我们」页需要的基础样式层（页头 / 页脚 / 展示动画）挂到这一条路由上。
 * 这些规则原本写在整站级的 `home-design.css` 里，含 `body`、`a`、`footer`、`:root` 等全局选择器；
 * 若在根布局引入，会被客户端路由带到 `/`（Stitch 首页）与 `/login`（统一登录），改写它们的排版。
 */
export default function AboutLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
