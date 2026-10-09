import Link from 'next/link';

import type { PublicHomeTemplate } from '@qitu/contracts';

import { DemoModal } from './home/demo-modal';
import { countLabel } from './home/format';
import { HeroTutorDemo } from './home/hero-demo';
import { Icon, type IconName } from './home/icons';
import { SiteNav } from './home/site-nav';
import { COMPETENCIES, PBL_STEPS } from './public-content';
import { FALLBACK_STATS, loadHomeView } from './public-data';

export const revalidate = 60;

export default async function HomePage() {
  const { view, degraded } = await loadHomeView();
  const stats = view?.stats ?? FALLBACK_STATS;
  const templates: PublicHomeTemplate[] = view?.templates ?? [];
  const heroStats: ReadonlyArray<{ icon: IconName; value: string; label: string; hint: string }> = [
    {
      icon: 'group',
      value: countLabel(stats.learners),
      label: '在册学习者',
      hint: '平台真实账号统计',
    },
    {
      icon: 'school',
      value: countLabel(stats.schools),
      label: '已接入学校',
      hint: '已完成接入并启用',
    },
    {
      icon: 'layers',
      value: countLabel(stats.publishedTemplates),
      label: '公开项目模板',
      hint: '已发布的共享模板',
    },
  ];

  return (
    <div className="home-page">
      <div className="home-orbs" aria-hidden="true">
        <span className="home-orb home-orb--primary" />
        <span className="home-orb home-orb--mint" />
        <span className="home-orb home-orb--violet" />
      </div>
      <SiteNav />

      <main className="home-main" id="top">
        <section className="home-hero">
          <div className="home-shell home-hero-grid">
            <div className="home-hero-copy">
              <p className="home-badge">
                <span className="home-badge-pill">NEW</span>AI 驱动的项目式学习平台
              </p>
              <h1 className="home-hero-title">
                让每一次学习<span className="home-hero-title-accent">都有明确方向</span>
              </h1>
              <p className="home-hero-sub">与 AI 共成长，启发真实世界新思维</p>
              <p className="home-hero-lead">
                从真实问题出发，与 AI
                导师一起研究、实践和复盘，把灵感变成作品，也把过程沉淀为可追溯的成长证据。
              </p>
              <div className="home-hero-actions">
                <Link
                  className="home-btn home-btn--primary home-btn--lg"
                  href="/login?next=%2Fstudent%2Ftutor"
                >
                  立即开启 AI 探索之旅 <Icon name="arrowRight" size={18} />
                </Link>
                <DemoModal
                  label="进入项目式学习"
                  variant="outline"
                  icon="play"
                  className="home-btn--lg"
                  destination="/learning"
                />
              </div>
              <p className="home-trust">
                <span>
                  <Icon name="school" size={16} /> 校本课程与项目模板
                </span>
                <span>
                  <Icon name="brain" size={16} /> 苏格拉底式启发提问
                </span>
                <span>
                  <Icon name="bolt" size={16} /> 理论达标再进入实践
                </span>
              </p>
              {degraded ? (
                <p className="home-data-note" role="status">
                  <Icon name="sensors" size={18} /> 实时数据暂时不可用，统计显示为
                  —。你仍可直接登录查看自己的项目数据。
                </p>
              ) : null}
              <dl className="home-hero-stats">
                {heroStats.map((item) => (
                  <div className="home-stat" key={item.label}>
                    <dt>
                      <Icon name={item.icon} size={16} /> {item.label}
                    </dt>
                    <dd>
                      <strong>{degraded ? '—' : item.value}</strong>
                      <span>{item.hint}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <HeroTutorDemo />
          </div>
        </section>

        <section className="home-section home-section--compact">
          <div className="home-shell home-summary-grid">
            <div className="home-summary-copy">
              <p className="home-eyebrow">
                <Icon name="layers" size={16} /> 项目式学习
              </p>
              <h2 className="home-section-title">把真实问题，变成一次完整的探索。</h2>
              <p className="home-section-lead">
                学生从定义问题开始，经过研究、验证、创作和复盘，留下属于自己的学习作品。
              </p>
              <Link className="home-btn home-btn--ghost" href="/learning">
                查看学习路径 <Icon name="arrowRight" size={18} />
              </Link>
            </div>
            <div className="home-summary-list">
              {PBL_STEPS.slice(0, 3).map((step) => (
                <div className="home-summary-item" key={step.index}>
                  <span>{step.index}</span>
                  <strong>{step.title}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="home-section home-section--tinted home-section--compact">
          <div className="home-shell home-summary-grid">
            <div className="home-summary-copy">
              <p className="home-eyebrow home-eyebrow--mint">
                <Icon name="target" size={16} /> 能力体系
              </p>
              <h2 className="home-section-title">不只完成项目，也看见能力如何生长。</h2>
              <p className="home-section-lead">
                每一次提问、判断、协作和迭代，都会成为成长档案的一部分。
              </p>
              <Link className="home-btn home-btn--ghost" href="/competencies">
                查看六维能力体系 <Icon name="arrowRight" size={18} />
              </Link>
            </div>
            <div className="home-summary-list">
              {COMPETENCIES.slice(0, 3).map((item) => (
                <div className="home-summary-item" key={item.name}>
                  <Icon name={item.icon} size={18} />
                  <strong>{item.name}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="home-section home-section--compact">
          <div className="home-shell home-summary-grid">
            <div className="home-summary-copy">
              <p className="home-eyebrow">
                <Icon name="compass" size={16} /> 项目展厅
              </p>
              <h2 className="home-section-title">每一个真实项目，都值得被看见。</h2>
              <p className="home-section-lead">
                浏览平台公开的真实项目模板，登录后即可在授权范围内发起自己的探索。
              </p>
              <Link className="home-btn home-btn--ghost" href="/showcase">
                查看项目展厅 <Icon name="arrowRight" size={18} />
              </Link>
            </div>
            <div className="home-summary-metric">
              <span className="home-showcase-count">
                {degraded ? '—' : countLabel(templates.length)}
              </span>
              <span>公开项目模板</span>
            </div>
          </div>
        </section>

        <section className="home-section home-section--deep" id="about">
          <div className="home-shell">
            <div className="home-about-grid">
              <div className="home-about-copy">
                <p className="home-eyebrow">
                  <Icon name="verified" size={16} /> 关于启途智学科技有限公司
                </p>
                <h2 className="home-section-title">
                  源自西安交通大学团队，
                  <br />
                  为真实学习建立一条清晰路径。
                </h2>
                <p>
                  启途智学科技有限公司专注于探究式学习与项目式 AI
                  教育，面向中小学提供可使用、可追溯的学习支持。
                </p>
                <p>
                  我们相信，AI
                  应该帮助学习者提出更好的问题、做出自己的判断，并在一次次实践中留下成长证据。
                </p>
                <div className="home-about-more">
                  <Link className="home-btn home-btn--ghost" href="/about">
                    了解关于我们 <Icon name="arrowRight" size={18} />
                  </Link>
                </div>
              </div>
              <dl className="home-stat-grid">
                <div className="home-stat-tile">
                  <dt>
                    <span className="home-stat-tile-icon">
                      <Icon name="group" size={20} />
                    </span>
                    在册学习者
                  </dt>
                  <dd>
                    <strong>{degraded ? '—' : countLabel(stats.learners)}</strong>
                    <span>真实平台账号</span>
                  </dd>
                </div>
                <div className="home-stat-tile">
                  <dt>
                    <span className="home-stat-tile-icon">
                      <Icon name="school" size={20} />
                    </span>
                    已接入学校
                  </dt>
                  <dd>
                    <strong>{degraded ? '—' : countLabel(stats.schools)}</strong>
                    <span>已启用的学校</span>
                  </dd>
                </div>
                <div className="home-stat-tile">
                  <dt>
                    <span className="home-stat-tile-icon">
                      <Icon name="layers" size={20} />
                    </span>
                    公开项目模板
                  </dt>
                  <dd>
                    <strong>{degraded ? '—' : countLabel(stats.publishedTemplates)}</strong>
                    <span>可浏览的模板</span>
                  </dd>
                </div>
                <div className="home-stat-tile">
                  <dt>
                    <span className="home-stat-tile-icon">
                      <Icon name="rocket" size={20} />
                    </span>
                    公开作品
                  </dt>
                  <dd>
                    <strong>{degraded ? '—' : countLabel(stats.publishedWorks)}</strong>
                    <span>真实公开作品</span>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <section className="home-section home-section--deep home-section--compact">
          <div className="home-shell home-summary-grid">
            <div className="home-summary-copy">
              <p className="home-eyebrow home-eyebrow--mint">
                <Icon name="hub" size={16} /> 合作联系
              </p>
              <h2 className="home-section-title">一起为孩子，做一段值得留下的学习旅程。</h2>
              <p className="home-section-lead">
                学校、家庭和研学团队可以通过合作联系提交真实需求。
              </p>
              <Link className="home-btn home-btn--primary" href="/contact">
                前往合作联系 <Icon name="arrowRight" size={18} />
              </Link>
            </div>
            <div className="home-summary-contact">
              <strong>启途智学科技有限公司</strong>
              <span>西安交通大学团队</span>
              <span>西安市碑林区</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="home-shell">
          <div className="home-footer-grid">
            <div className="home-footer-brand">
              <img className="home-footer-logo" src="/brand-logo.png" alt="启途智学" />
              <p className="home-footer-desc">
                启途智学科技有限公司由西安交通大学团队研发，专注于探究式学习与项目式 AI 教育。
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
                  <Icon name="verified" size={16} /> 启途智学科技有限公司
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
            <p>© 2026 启途智学科技有限公司. 保留所有权利。</p>
            <p className="home-footer-legal">
              <span>启途智学项目式 AI 学习平台</span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
