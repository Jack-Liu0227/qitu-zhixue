import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '../home/icons';
import { ScrollReveal } from '../home/scroll-reveal';
import { COMPETENCIES } from '../public-content';
import { PublicPageShell } from '../public-shell';

export const metadata: Metadata = {
  title: '能力体系',
  description: '在真实项目中发展批判性思维、计算思维、工程创造与人机协作能力。',
};

export default function CompetenciesPage() {
  return (
    <PublicPageShell>
      {/* 第 1 屏：Hero 区域 */}
      <section className="home-hero react-bits-hero-wrapper home-section--fullscreen is-glow">
        <ScrollReveal>
          <div className="home-shell home-hero-grid">
            <div className="home-hero-copy">
              <p className="home-badge react-bits-badge">
                <span className="react-bits-badge-glow" />
                <span>源自 西安交通大学 团队研发</span>
                <span className="react-bits-badge-arrow">✨</span>
              </p>
              <h1 className="home-hero-title">
                不只看结果，<span className="react-bits-shiny-text">更看如何走到这里</span>
              </h1>
              <p className="home-hero-sub">以真实项目行为为证据的六维素养成长罗盘</p>
              <p className="home-hero-lead">
                能力不是一张一次性测出来的分数表，而是在提出问题、修改判断、协作表达和完成作品的过程中逐渐显现的成长轨迹。
              </p>
              <div className="home-hero-actions">
                <Link className="home-btn home-btn--primary react-bits-star-border-btn" href="/learning">
                  查看学习路径 <Icon name="arrowRight" size={18} />
                </Link>
                <Link className="home-btn home-btn--ghost react-bits-glass-btn" href="/contact">
                  咨询合作方案
                </Link>
              </div>
            </div>

            <aside className="public-hero-note">
              <div className="public-hero-note-badge">
                <Icon name="target" size={18} />
                <span>六维能力罗盘</span>
              </div>
              <h3>六个持续生长的维度</h3>
              <p>
                能力画像基于真实项目过程记录，帮助学习者和陪伴者看见每一步的提升，
                而不是给成长贴上固定的标签。
              </p>
              <div className="public-hero-note-tags">
                <span className="home-tutor-tag">
                  <Icon name="brain" size={14} /> 批判性思维
                </span>
                <span className="home-tutor-tag">
                  <Icon name="terminal" size={14} /> 计算思维
                </span>
                <span className="home-tutor-tag">
                  <Icon name="layers" size={14} /> 工程创造
                </span>
              </div>
            </aside>
          </div>
        </ScrollReveal>
      </section>

      {/* 第 2 屏：六维能力卡片网格 */}
      <section className="home-section home-section--fullscreen is-tinted">
        <ScrollReveal delay={80}>
          <div className="home-shell">
            <div className="public-section-head">
              <p className="home-eyebrow">
                <Icon name="chart" size={16} /> 能力框架 · Six Dimensions
              </p>
              <h2 className="home-section-title">把看不见的成长，变成可以回顾的证据。</h2>
              <p className="home-section-lead">
                每一项能力都对应真实的项目行为和复盘记录，帮助孩子理解自己已经掌握什么，还可以继续探索什么。
              </p>
            </div>
            <div className="public-card-grid">
              {COMPETENCIES.map((item, idx) => (
                <article className={`public-card rb-stagger-${(idx % 4) + 1}`} key={item.name}>
                  <div className="public-card-top">
                    <span className="public-card-icon" aria-hidden="true">
                      <Icon name={item.icon} size={22} />
                    </span>
                    <span className="home-step-index">{`0${idx + 1}`}</span>
                  </div>
                  <h3>{item.name}</h3>
                  <p>{item.detail}</p>
                  <small>{item.metrics}</small>
                </article>
              ))}
            </div>
          </div>
        </ScrollReveal>
      </section>
    </PublicPageShell>
  );
}