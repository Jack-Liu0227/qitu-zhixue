import Link from 'next/link';

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
              企图智学科技有限公司由西安交通大学团队研发，专注于探究式学习与项目式 AI 教育，
              帮助学习者在真实问题中建立能力、沉淀作品与成长证据。
            </p>
            <p className="home-footer-social" aria-hidden="true">
              <span>
                <Icon name="forum" size={18} />
              </span>
              <span>
                <Icon name="mic" size={18} />
              </span>
              <span>
                <Icon name="share" size={18} />
              </span>
              <span>
                <Icon name="mail" size={18} />
              </span>
            </p>
          </div>

          <nav className="home-footer-col" aria-label="产品与学习">
            <h3>产品与学习</h3>
            <ul>
              <li>
                <Link href="/learning">项目式学习</Link>
              </li>
              <li>
                <Link href="/competencies">能力体系</Link>
              </li>
              <li>
                <Link href="/showcase">项目展厅</Link>
              </li>
              <li>
                <Link href="/login?next=%2Fstudent%2Ftutor">AI 导师工作区</Link>
              </li>
            </ul>
          </nav>

          <nav className="home-footer-col" aria-label="关于我们">
            <h3>关于我们</h3>
            <ul>
              <li>
                <Link href="/about">公司介绍</Link>
              </li>
              <li>
                <Link href="/contact">合作联系</Link>
              </li>
              <li>
                <Link href="/login">统一登录</Link>
              </li>
            </ul>
          </nav>

          <div className="home-footer-col">
            <h3>公司信息</h3>
            <ul className="home-footer-contact">
              <li>
                <Icon name="verified" size={16} /> 企图智学科技有限公司
              </li>
              <li>
                <Icon name="hub" size={16} /> 西安交通大学团队
              </li>
              <li>
                <Icon name="location" size={16} /> 西安市碑林区
              </li>
            </ul>
          </div>
        </div>

        <div className="home-footer-bottom">
          <p>© 2026 企图智学科技有限公司. 保留所有权利。</p>
          <p className="home-footer-legal">
            <span>启途智学项目式 AI 学习平台</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
