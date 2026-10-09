import type { Metadata } from 'next';
import Link from 'next/link';

import { COMPETENCIES } from '../public-content';
import { Icon } from '../home/icons';
import { PublicPageShell } from '../public-shell';

export const metadata: Metadata = {
  title: '能力体系',
  description: '在真实项目中发展批判性思维、计算思维、工程创造与人机协作能力。',
};

export default function CompetenciesPage() {
  return (
    <PublicPageShell>
      <section className="public-hero">
        <div className="home-shell public-hero-grid">
          <div>
            <p className="public-kicker"><Icon name="target" size={16} /> Competency compass</p>
            <h1 className="public-title">不只看结果，<span>也看孩子如何走到这里。</span></h1>
            <p className="public-lead">
              能力不是一张一次性测出来的分数表，而是在提出问题、修改判断、协作表达和完成作品的过程中逐渐显现的成长轨迹。
            </p>
            <div className="public-actions">
              <Link className="home-btn home-btn--primary home-btn--lg" href="/learning">
                查看学习路径 <Icon name="arrowRight" size={18} />
              </Link>
              <Link className="home-btn home-btn--outline home-btn--lg" href="/contact">
                咨询合作方案
              </Link>
            </div>
          </div>
          <aside className="public-hero-note">
            <strong>六个持续生长的维度</strong>
            <p>能力画像基于真实项目过程记录，帮助学习者和陪伴者看见下一步，而不是给成长贴上固定标签。</p>
          </aside>
        </div>
      </section>

      <section className="public-section public-section--tinted">
        <div className="home-shell">
          <div className="public-section-head">
            <p className="public-kicker"><Icon name="chart" size={16} /> Six dimensions</p>
            <h2>把看不见的成长，变成可以回顾的证据。</h2>
            <p>每一项能力都对应真实的项目行为和复盘记录，帮助孩子理解自己已经会什么，还可以继续练习什么。</p>
          </div>
          <div className="public-card-grid">
            {COMPETENCIES.map((item) => (
              <article className="public-card" key={item.name}>
                <span className="public-card-icon" aria-hidden="true"><Icon name={item.icon} size={22} /></span>
                <h3>{item.name}</h3>
                <p>{item.detail}</p>
                <small>{item.metrics}</small>
              </article>
            ))}
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
