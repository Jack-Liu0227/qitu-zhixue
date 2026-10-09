import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '../home/icons';
import { PublicPageShell } from '../public-shell';

export const metadata: Metadata = {
  title: '关于我们',
  description: '启途智学科技有限公司，由西安交通大学团队研发，专注于探究式学习与项目式 AI 教育。',
};

export default function AboutPage() {
  return (
    <PublicPageShell>
      <section className="public-hero">
        <div className="home-shell public-hero-grid">
          <div>
            <p className="public-kicker">
              <Icon name="verified" size={16} /> About QITU
            </p>
            <h1 className="public-title">
              让好奇心有方向，<span>让每个作品留下成长证据。</span>
            </h1>
            <p className="public-lead">
              启途智学科技有限公司由西安交通大学团队研发，面向中小学提供项目式 AI 学习支持。
              我们把问题、思考、实践和复盘连接起来，让学习者在真实问题中建立能力。
            </p>
            <div className="public-actions">
              <Link className="home-btn home-btn--primary home-btn--lg" href="/learning">
                了解项目式学习 <Icon name="arrowRight" size={18} />
              </Link>
              <Link className="home-btn home-btn--outline home-btn--lg" href="/contact">
                合作联系
              </Link>
            </div>
          </div>
          <aside className="public-hero-note">
            <strong>关于启途智学</strong>
            <p>
              团队来自西安交通大学，办公地址位于西安市碑林区，持续把探究式学习方法做成可使用、可追溯的产品。
            </p>
          </aside>
        </div>
      </section>

      <section className="public-section public-section--tinted">
        <div className="home-shell">
          <div className="public-section-head">
            <p className="public-kicker">
              <Icon name="target" size={16} /> Our principles
            </p>
            <h2>学习不止于找到答案，也在于知道如何继续提问。</h2>
            <p>我们用清晰的学习过程和真实的作品，帮助学生、家长与老师看见每一步成长。</p>
          </div>
          <div className="public-card-grid">
            <article className="public-card">
              <span className="public-card-icon" aria-hidden="true">
                <Icon name="search" size={22} />
              </span>
              <h3>从真实问题开始</h3>
              <p>从身边的观察和困惑出发，定义值得研究、值得动手验证的问题。</p>
              <small>问题意识</small>
            </article>
            <article className="public-card">
              <span className="public-card-icon" aria-hidden="true">
                <Icon name="brain" size={22} />
              </span>
              <h3>与 AI 一起思考</h3>
              <p>AI 负责启发和反馈，学习者保留判断、选择和表达的主导权。</p>
              <small>人机协作</small>
            </article>
            <article className="public-card">
              <span className="public-card-icon" aria-hidden="true">
                <Icon name="wrench" size={22} />
              </span>
              <h3>把想法做成作品</h3>
              <p>通过研究、原型和迭代把想法变成可展示、可复盘的真实成果。</p>
              <small>动手实践</small>
            </article>
            <article className="public-card">
              <span className="public-card-icon" aria-hidden="true">
                <Icon name="chart" size={22} />
              </span>
              <h3>沉淀成长证据</h3>
              <p>记录过程中的选择、反馈和反思，让能力变化有迹可循。</p>
              <small>持续成长</small>
            </article>
          </div>
        </div>
      </section>

      <section className="public-section">
        <div className="home-shell public-contact-grid">
          <div className="public-contact-panel">
            <h2>我们是谁</h2>
            <p>启途智学科技有限公司专注于探究式学习与项目式 AI 教育。</p>
            <ul className="public-contact-list">
              <li>
                <Icon name="verified" size={20} aria-hidden="true" />
                <div>
                  <strong>公司主体</strong>
                  <span>启途智学科技有限公司</span>
                </div>
              </li>
              <li>
                <Icon name="hub" size={20} aria-hidden="true" />
                <div>
                  <strong>研发团队</strong>
                  <span>西安交通大学团队</span>
                </div>
              </li>
              <li>
                <Icon name="location" size={20} aria-hidden="true" />
                <div>
                  <strong>办公地址</strong>
                  <span>西安市碑林区</span>
                </div>
              </li>
            </ul>
          </div>
          <div className="public-form-panel">
            <h2>一起把学习做得更真实</h2>
            <p>通过合作联系提交需求，了解学校、家庭与研学项目的合作方式。</p>
            <div className="public-actions">
              <Link className="home-btn home-btn--primary" href="/contact">
                前往合作联系 <Icon name="arrowRight" size={18} />
              </Link>
              <Link className="home-btn home-btn--outline" href="/login">
                进入学习平台
              </Link>
            </div>
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
