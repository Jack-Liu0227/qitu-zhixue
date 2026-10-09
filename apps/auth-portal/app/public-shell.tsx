import Link from 'next/link';

import { CONTACT_ROWS, FOOTER_COLUMNS } from './public-content';
import { Icon } from './home/icons';
import { SiteNav } from './home/site-nav';

export function PublicPageShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="home-page public-page">
      <div className="home-orbs" aria-hidden="true">
        <span className="home-orb home-orb--primary" />
        <span className="home-orb home-orb--mint" />
        <span className="home-orb home-orb--violet" />
      </div>
      <SiteNav />
      <main className="public-main">{children}</main>
      <PublicFooter />
    </div>
  );
}

export function PublicFooter() {
  return (
    <footer className="home-footer">
      <div className="home-shell">
        <div className="home-footer-grid">
          <div className="home-footer-brand">
            <p className="home-brand-name">启途智学</p>
            <p className="home-footer-desc">
              启途智学是面向 10–18 岁学生的项目式 AI 学习平台，陪伴学习者从问题出发，
              在真实项目中理解知识、完成作品并留下成长记录。
            </p>
            <p className="home-footer-social" aria-hidden="true">
              <span><Icon name="forum" size={18} /></span>
              <span><Icon name="mic" size={18} /></span>
              <span><Icon name="share" size={18} /></span>
              <span><Icon name="mail" size={18} /></span>
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <nav className="home-footer-col" key={column.title} aria-label={column.title}>
              <h3>{column.title}</h3>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div className="home-footer-col">
            <h3>联系与支持</h3>
            <ul className="home-footer-contact">
              {CONTACT_ROWS.slice(1, 3).map((row) => (
                <li key={row.label}>
                  <Icon name={row.icon} size={16} />
                  {row.href !== undefined ? <a href={row.href}>{row.value}</a> : row.value}
                </li>
              ))}
              <li>
                <Icon name="location" size={16} /> 西安市碑林区创智天地科创中心 12 栋
              </li>
              <li>
                <Icon name="headset" size={16} /> 工作日 09:00 - 19:00 在线客服
              </li>
            </ul>
          </div>
        </div>

        <div className="home-footer-bottom">
          <p>© 2025 启途智学（西安）智能科技有限公司。保留所有权利。</p>
          <p className="home-footer-legal">
            <span>陕ICP备2024018899号-1</span>
            <span>公网安备 61011302005520号</span>
            <span>服务条款与隐私政策整理中</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
