import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '../home/icons';
import { PBL_STEPS } from '../public-content';
import { PublicPageShell } from '../public-shell';

export const metadata: Metadata = {
  title: '项目式学习',
  description: '从真实问题出发，在 AI 导师陪伴下完成研究、验证、制作与复盘。',
};

export default function LearningPage() {
  return (
    <PublicPageShell>
      <section className="public-hero">
        <div className="home-shell public-hero-grid">
          <div>
            <p className="public-kicker"><Icon name="layers" size={16} /> Project-based learning</p>
            <h1 className="public-title">把问题带进现实，<span>把想法做成作品。</span></h1>
            <p className="public-lead">
              项目式学习不是完成一张练习单，而是经历一次完整的研究过程：定义问题、提出假设、验证方向，
              最后留下自己能够讲清楚的成果。
            </p>
            <div className="public-actions">
              <Link className="home-btn home-btn--primary home-btn--lg" href="/login">
                开始一次 AI 探索 <Icon name="arrowRight" size={18} />
              </Link>
              <Link className="home-btn home-btn--outline home-btn--lg" href="/about">
                了解教育理念
              </Link>
            </div>
          </div>
          <aside className="public-hero-note">
            <strong>一条清晰的探索路径</strong>
            <p>从好奇出发，不急着寻找标准答案。AI 导师帮助梳理思路，真人班主任在关键时刻提供支持。</p>
          </aside>
        </div>
      </section>

      <section className="public-section">
        <div className="home-shell">
          <div className="public-section-head">
            <p className="public-kicker"><Icon name="compass" size={16} /> Four steps</p>
            <h2>学习从一个想法开始，成长在一次次尝试中发生。</h2>
            <p>每个项目都要留下问题、判断、过程和作品，而不仅是一份最后才出现的答案。</p>
          </div>
          <ol className="home-step-grid">
            {PBL_STEPS.map((step) => (
              <li className="home-step-card" key={step.index}>
                <span className="home-step-index">{step.index}</span>
                <span className="home-step-icon" aria-hidden="true"><Icon name={step.icon} size={22} /></span>
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
                <p className="home-deliverable"><Icon name="verified" size={16} /> 交付物：{step.outcome}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </PublicPageShell>
  );
}
