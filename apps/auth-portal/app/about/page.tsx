import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '../home/icons';
import { ScrollReveal } from '../home/scroll-reveal';
import { PublicPageShell } from '../public-shell';

export const metadata: Metadata = {
  title: '关于我们',
  description: '启途智学科技有限公司，由西安交通大学团队研发，专注于探究式学习与项目式 AI 教育。',
};

export default function AboutPage() {
  return (
    <PublicPageShell>
      {/* 第 1 屏：Hero 区域 */}
      <section className="home-hero react-bits-hero-wrapper home-section--fullscreen is-glow">
        <ScrollReveal>
          <div className="home-shell public-hero-heading">
            <p className="home-badge react-bits-badge">
              <span className="react-bits-badge-glow" />
              <span>源自 西安交通大学 团队研发</span>
              <span className="react-bits-badge-arrow">✨</span>
            </p>
            <h1 className="home-hero-title">
              让好奇心有方向，<span className="react-bits-shiny-text">让每个作品留下成长证据</span>
            </h1>
          </div>
          <div className="home-shell public-hero-grid">
            <div>
              <p className="home-hero-lead">
                启途智学科技有限公司由西安交通大学团队研发，面向中小学提供项目式 AI 学习支持。
                我们把问题、思考、实践和复盘连接起来，让学习者在真实世界的问题中建立独立判断与实践能力。
              </p>
              <div className="home-hero-actions">
                <Link className="home-btn home-btn--primary react-bits-star-border-btn" href="/learning">
                  了解项目式学习 <Icon name="arrowRight" size={18} />
                </Link>
                <Link className="home-btn home-btn--ghost react-bits-glass-btn" href="/contact">
                  合作联系
                </Link>
              </div>
            </div>
            <aside className="public-hero-note">
              <div className="public-hero-note-badge">
                <Icon name="verified" size={18} />
                <span>交大科研基因</span>
              </div>
              <h3>关于启途智学</h3>
              <p>
                团队来自西安交通大学，办公地址位于西安市碑林区，持续把探究式学习方法做成可使用、可追溯的产品。
              </p>
              <div className="public-hero-note-tags">
                <span className="home-tutor-tag">
                  <Icon name="school" size={14} /> 西安交通大学
                </span>
                <span className="home-tutor-tag">
                  <Icon name="location" size={14} /> 西安市碑林区
                </span>
              </div>
            </aside>
          </div>
        </ScrollReveal>
      </section>

      {/* 第 2 屏：核心原则卡片 */}
      <section className="home-section home-section--fullscreen is-tinted">
        <ScrollReveal delay={80}>
          <div className="home-shell">
            <div className="public-section-head">
              <p className="home-eyebrow">
                <Icon name="target" size={16} /> 核心原则 · Our Principles
              </p>
              <h2 className="home-section-title">学习不止于找到答案，也在于知道如何继续提问。</h2>
              <p className="home-section-lead">
                我们用清晰的学习过程和真实的作品，帮助学生、家长与老师看见每一步成长。
              </p>
            </div>
            <div className="public-card-grid">
              <article className="public-card rb-stagger-1">
                <span className="public-card-icon" aria-hidden="true">
                  <Icon name="search" size={22} />
                </span>
                <h3>从真实问题开始</h3>
                <p>从身边的观察和困惑出发，定义值得研究、值得动手验证的问题。</p>
                <small>问题意识</small>
              </article>
              <article className="public-card rb-stagger-2">
                <span className="public-card-icon" aria-hidden="true">
                  <Icon name="brain" size={22} />
                </span>
                <h3>与 AI 一起思考</h3>
                <p>AI 负责启发和反馈，学习者保留判断、选择和表达的主导权。</p>
                <small>人机协作</small>
              </article>
              <article className="public-card rb-stagger-3">
                <span className="public-card-icon" aria-hidden="true">
                  <Icon name="wrench" size={22} />
                </span>
                <h3>把想法做成作品</h3>
                <p>通过研究、原型和迭代把想法变成可展示、可复盘的真实成果。</p>
                <small>动手实践</small>
              </article>
              <article className="public-card rb-stagger-4">
                <span className="public-card-icon" aria-hidden="true">
                  <Icon name="chart" size={22} />
                </span>
                <h3>沉淀成长证据</h3>
                <p>记录过程中的选择、反馈和反思，让能力变化有迹可循。</p>
                <small>持续成长</small>
              </article>
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* 第 3 屏：团队背景与合作 */}
      <section className="home-section home-section--fullscreen is-deep">
        <ScrollReveal delay={80}>
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
              <div className="home-hero-actions">
                <Link className="home-btn home-btn--primary react-bits-star-border-btn" href="/contact">
                  前往合作联系 <Icon name="arrowRight" size={18} />
                </Link>
                <Link className="home-btn home-btn--ghost react-bits-glass-btn" href="/login">
                  进入学习平台
                </Link>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </section>
    </PublicPageShell>
  );
}