import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '../home/icons';
import { ScrollReveal } from '../home/scroll-reveal';
import { PBL_STEPS } from '../public-content';
import { PublicPageShell } from '../public-shell';

export const metadata: Metadata = {
  title: '项目式学习',
  description: '从真实问题出发，在 AI 导师陪伴下完成研究、验证、制作与复盘。',
};

export default function LearningPage() {
  return (
    <PublicPageShell>
      {/* 第 1 屏：Hero 区域（对齐首页布局、字体与粒子动效） */}
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
                把问题带进现实，<span className="react-bits-shiny-text">把想法做成作品</span>
              </h1>
              <p className="home-hero-sub">以真实问题为导向，AI 全程陪伴的探究式成长</p>
              <p className="home-hero-lead">
                项目式学习不是完成一张练习单，而是经历一次完整的研究过程：定义问题、提出假设、验证方向，
                最后留下自己能够讲清楚的成果与成长证据。
              </p>
              <div className="home-hero-actions">
                <Link className="home-btn home-btn--primary react-bits-star-border-btn" href="/login">
                  开始一次 AI 探索 <Icon name="arrowRight" size={18} />
                </Link>
                <Link className="home-btn home-btn--ghost react-bits-glass-btn" href="/about">
                  了解关于我们
                </Link>
              </div>
            </div>

            <aside className="public-hero-note">
              <div className="public-hero-note-badge">
                <Icon name="verified" size={18} />
                <span>清晰探索路径</span>
              </div>
              <h3>不仅是给出答案，更是学会提问</h3>
              <p>
                从好奇出发，不急着寻找标准答案。AI 导师帮助梳理思路，真人班主任在关键时刻提供支持，
                让每个学习者在实践中形成独立思考能力。
              </p>
              <div className="public-hero-note-tags">
                <span className="home-tutor-tag">
                  <Icon name="brain" size={14} /> 真实问题驱动
                </span>
                <span className="home-tutor-tag">
                  <Icon name="award" size={14} /> 可交付作品
                </span>
                <span className="home-tutor-tag">
                  <Icon name="chart" size={14} /> 过程可追溯
                </span>
              </div>
            </aside>
          </div>
        </ScrollReveal>
      </section>

      {/* 第 2 屏：核心四步法（滚动渐入与卡片交错） */}
      <section className="home-section home-section--fullscreen is-tinted">
        <ScrollReveal delay={80}>
          <div className="home-shell">
            <div className="public-section-head">
              <p className="home-eyebrow">
                <Icon name="compass" size={16} /> 学习路径 · Four Steps
              </p>
              <h2 className="home-section-title">学习从一个想法开始，成长在一次次尝试中发生。</h2>
              <p className="home-section-lead">
                每个项目都要留下问题、判断、过程和作品，而不仅是一份最后才出现的答案。
              </p>
            </div>
            <ol className="home-step-grid">
              {PBL_STEPS.map((step, idx) => (
                <li className={`home-step-card rb-stagger-${idx + 1}`} key={step.index}>
                  <span className="home-step-index">{step.index}</span>
                  <span className="home-step-icon" aria-hidden="true">
                    <Icon name={step.icon} size={22} />
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                  <p className="home-deliverable">
                    <Icon name="verified" size={16} /> 交付物：{step.outcome}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </ScrollReveal>
      </section>
    </PublicPageShell>
  );
}