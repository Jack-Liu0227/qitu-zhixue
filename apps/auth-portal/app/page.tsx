import Link from 'next/link';

import type { PublicHomeTemplate } from '@qitu/contracts';

import { DemoModal } from './home/demo-modal';
import { countLabel } from './home/format';
import { HeroTutorDemo } from './home/hero-demo';
import { COMPETENCIES, FOOTER_COLUMNS, PBL_STEPS } from './public-content';
import { loadHomeView, FALLBACK_STATS } from './public-data';
import { Icon, type IconName } from './home/icons';
import { LegacyHashRedirect } from './home/legacy-hash-redirect';
import { SiteNav } from './home/site-nav';

/**
 * 营销首页（服务端渲染）。
 *
 * 数据来源：`GET /api/v1/public/home`（公开只读，只回聚合计数与平台共享模板）。
 * 后端不可用时**不伪造数字**：统计位显示 `—` 并给出降级提示，展厅回到空状态。
 */
export const revalidate = 60;

export default async function HomePage() {
  const { view, degraded } = await loadHomeView();
  const stats = view?.stats ?? FALLBACK_STATS;
  const templates: PublicHomeTemplate[] = view?.templates ?? [];

  const heroStats = [
    {
      icon: 'group' as IconName,
      value: countLabel(stats.learners),
      label: '名在册学习者',
      hint: '平台在册学生账号，实时统计',
    },
    {
      icon: 'school' as IconName,
      value: countLabel(stats.schools),
      label: '所已接入学校',
      hint: '已完成接入并处于启用状态',
    },
    {
      icon: 'layers' as IconName,
      value: countLabel(stats.publishedTemplates),
      label: '个公开项目模板',
      hint: '平台共享且已发布的模板',
    },
  ];

  const aboutStats = [
    {
      icon: 'group' as IconName,
      value: countLabel(stats.learners),
      label: '在册学习者',
      hint: '正在平台上开展项目的学生账号',
    },
    {
      icon: 'school' as IconName,
      value: countLabel(stats.schools),
      label: '已接入学校',
      hint: '与平台完成接入并处于启用状态',
    },
    {
      icon: 'layers' as IconName,
      value: countLabel(stats.publishedTemplates),
      label: '公开项目模板',
      hint: '平台共享、可直接发起项目的模板',
    },
    {
      icon: 'rocket' as IconName,
      value: countLabel(stats.publishedWorks),
      label: '公开作品',
      hint: '学生作品中选择公开分享的数量',
    },
  ];

  return (
    <div className="home-page">
      <div className="home-orbs" aria-hidden="true">
        <span className="home-orb home-orb--primary" />
        <span className="home-orb home-orb--mint" />
        <span className="home-orb home-orb--violet" />
      </div>

      <LegacyHashRedirect />
      <SiteNav />

      <main className="home-main">
        <section className="home-hero">
          <div className="home-shell home-hero-grid">
            <div className="home-hero-copy">
              <p className="home-badge">
                <span className="home-badge-pill">NEW</span>
                全新发布 · AI 驱动的沉浸式个性化项目学习平台 3.0
              </p>
              <h1 className="home-hero-title">
                让每一次学习
                <span className="home-hero-title-accent">都有明确方向</span>
              </h1>
              <p className="home-hero-sub">与 AI 共成长，启发真实世界新思维</p>
              <p className="home-hero-lead">
                在苏格拉底式启发对话中与 AI 导师一同探究真实挑战，在动手实践中让灵感成形。
                启途智学为你生成动态成长路径，并沉淀 6 维核心能力图谱。
              </p>
              <div className="home-hero-actions">
                <Link className="home-btn home-btn--primary home-btn--lg" href="/login">
                  立即开启 AI 探索之旅
                  <Icon name="arrowRight" size={18} />
                </Link>
                <DemoModal
                  label="观看 PBL 项目演示"
                  variant="outline"
                  icon="play"
                  className="home-btn--lg"
                />
              </div>
              <p className="home-trust">
                <span>
                  <Icon name="school" size={16} /> 校本课程与校本模板
                </span>
                <span>
                  <Icon name="brain" size={16} /> 苏格拉底式启发提问
                </span>
                <span>
                  <Icon name="bolt" size={16} /> 理论达标才解锁实践
                </span>
              </p>

              {degraded ? (
                <p className="home-data-note" role="status">
                  <Icon name="sensors" size={18} />
                  平台实时数据暂时无法获取，下方统计显示为「—」。稍后刷新页面即可重新获取，
                  你也可以直接登录查看自己的项目数据。
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
              <p className="home-eyebrow"><Icon name="layers" size={16} /> 项目式学习</p>
              <h2 className="home-section-title">从真实问题出发，经历一次完整的探索。</h2>
              <p className="home-section-lead">
                启途智学陪伴学习者完成研究、假设、验证与落地，把一个还不完整的想法慢慢做成作品。
              </p>
              <Link className="home-btn home-btn--ghost" href="/learning">
                查看完整学习路径 <Icon name="arrowRight" size={18} />
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
              <p className="home-eyebrow home-eyebrow--mint"><Icon name="target" size={16} /> 能力体系</p>
              <h2 className="home-section-title">不只看结果，也看孩子如何走到这里。</h2>
              <p className="home-section-lead">
                六个能力维度来自真实项目过程记录，帮助学习者理解已经会什么，以及下一步可以继续练习什么。
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
              <p className="home-eyebrow"><Icon name="compass" size={16} /> 项目展厅</p>
              <h2 className="home-section-title">从一个真实问题，开始你的项目。</h2>
              <p className="home-section-lead">
                浏览平台真实发布的公开模板，了解适龄、学科、阶段和学习目标，登录后即可继续探索。
              </p>
              <Link className="home-btn home-btn--ghost" href="/showcase">
                浏览项目展厅 <Icon name="arrowRight" size={18} />
              </Link>
            </div>
            <div className="home-summary-metric">
              <span className="home-showcase-count">{degraded ? '—' : countLabel(templates.length)}</span>
              <span>个公开项目模板</span>
            </div>
          </div>
        </section>

        <section className="home-section home-section--deep">
          <div className="home-shell">
            <div className="home-about-grid">
              <div className="home-about-copy">
                <p className="home-eyebrow">
                  <Icon name="verified" size={16} /> 关于启途智学（QiTu Smart Learning）
                </p>
                <h2 className="home-section-title">
                  源自启途智学的项目式 AI 学习实践，
                  <br />
                  让每个孩子把好奇做成作品
                </h2>
                <p>
                  启途智学，是面向 10–18 岁学生的项目式 AI 学习平台。
                  我们相信，学习不只是获得知识，更是发现自己能够做什么。
                </p>
                <p>
                  孩子从一个问题、一个兴趣或一个想法出发，和 AI 导师持续对话，在真实项目中学习知识，
                  做出作品；真人班主任陪伴过程，在需要帮助的时候及时介入。
                </p>
                <div className="home-about-more">
                  <Link className="home-btn home-btn--ghost" href="/about">
                    了解教育主张与品牌历程
                    <Icon name="arrowRight" size={18} />
                  </Link>
                </div>
                <p className="home-about-footnote">
                  下方数字为平台实时统计口径，随真实使用情况变化。
                </p>
              </div>

              <dl className="home-stat-grid">
                {aboutStats.map((item) => (
                  <div className="home-stat-tile" key={item.label}>
                    <dt>
                      <span className="home-stat-tile-icon" aria-hidden="true">
                        <Icon name={item.icon} size={20} />
                      </span>
                      {item.label}
                    </dt>
                    <dd>
                      <strong>{degraded ? '—' : item.value}</strong>
                      <span>{item.hint}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="home-summary-grid">
              <p className="home-summary-note">完整的项目案例、能力说明与真实评价，请在对应专题页继续了解。</p>
              <Link className="home-btn home-btn--ghost" href="/about">了解关于启途智学 <Icon name="arrowRight" size={18} /></Link>
            </div>
          </div>
        </section>

        <section className="home-section home-section--deep home-section--compact">
          <div className="home-shell home-summary-grid">
            <div className="home-summary-copy">
              <p className="home-eyebrow home-eyebrow--mint"><Icon name="hub" size={16} /> 合作联系</p>
              <h2 className="home-section-title">一起为孩子，做一段值得留下的学习旅程。</h2>
              <p className="home-section-lead">
                欢迎学生、家长、学校和研学机构联系我们，告诉我们正在关注的问题，我们会为你准备合适的项目式 AI 学习方案。
              </p>
              <Link className="home-btn home-btn--primary" href="/contact">
                预约体验课 / 合作洽谈 <Icon name="arrowRight" size={18} />
              </Link>
            </div>
            <div className="home-summary-contact">
              <a href="tel:4008209188">400-820-9188</a>
              <a href="mailto:partner@qituzhixue.com">partner@qituzhixue.com</a>
              <span>西安市碑林区创智天地科创中心 12 栋</span>
            </div>
          </div>
        </section>
      </main>

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
                <li>
                  <Icon name="phone" size={16} />
                  <a href="tel:4008209188">400-820-9188</a>
                </li>
                <li>
                  <Icon name="mail" size={16} />
                  <a href="mailto:partner@qituzhixue.com">partner@qituzhixue.com</a>
                </li>
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
            <p>© 2025 启途智学（西安）智能科技有限公司. 保留所有权利。</p>
            <p className="home-footer-legal">
              <span>陕ICP备2024018899号-1</span>
              <span>公网安备 61011302005520号</span>
              <span>服务条款与隐私政策整理中</span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
