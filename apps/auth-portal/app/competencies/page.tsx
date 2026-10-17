import type { Metadata } from 'next';
import Link from 'next/link';

import { COMPETENCIES } from '../public-content';
import { Icon } from '../home/icons';
import { ScrollReveal } from '../home/scroll-reveal';
import { PublicPageShell } from '../public-shell';

export const metadata: Metadata = {
  title: '????',
  description: '???????????????????????????????',
};

export default function CompetenciesPage() {
  return (
    <PublicPageShell>
      {/* ? 1 ??Hero ???? */}
      <section className="home-hero react-bits-hero-wrapper home-section--fullscreen is-glow">
        <ScrollReveal>
          <div className="home-shell home-hero-grid">
            <div className="home-hero-copy">
              <p className="home-badge react-bits-badge">
                <span className="react-bits-badge-glow" />
                <span>?? ?????? ? ??????</span>
                <span className="react-bits-badge-arrow">?</span>
              </p>
              <h1 className="home-hero-title">
                ??????<span className="react-bits-shiny-text">??????????</span>
              </h1>
              <p className="home-hero-sub">?????????????????????????</p>
              <p className="home-hero-lead">
                ?????????????????????????????????????????????????????
              </p>
              <div className="home-hero-actions">
                <Link className="home-btn home-btn--primary home-btn--lg" href="/learning">
                  ?????? <Icon name="arrowRight" size={18} />
                </Link>
                <Link className="home-btn home-btn--outline home-btn--lg" href="/contact">
                  ??????
                </Link>
              </div>
            </div>

            <aside className="public-hero-note">
              <div className="public-hero-note-badge">
                <Icon name="target" size={18} />
                <span>?????????</span>
              </div>
              <h3>?????????????</h3>
              <p>????????????????????????????????????????????</p>
              <div className="public-hero-note-tags">
                <span className="home-eyebrow">????</span>
                <span className="home-eyebrow">????</span>
                <span className="home-eyebrow home-eyebrow--mint">????</span>
              </div>
            </aside>
          </div>
        </ScrollReveal>
      </section>

      {/* ? 2 ???????????? */}
      <section className="home-section home-section--fullscreen is-tinted">
        <ScrollReveal delay={80}>
          <div className="home-shell">
            <div className="public-section-head">
              <span className="home-eyebrow"><Icon name="chart" size={14} /> ??????</span>
              <h2 className="home-section-title">
                ????????<span className="react-bits-shiny-text">?????????</span>
              </h2>
              <p className="home-section-lead">
                ?????????????????????????????????????????????
              </p>
            </div>

            <div className="public-card-grid">
              {COMPETENCIES.map((item) => (
                <article className="public-card" key={item.name}>
                  <div className="public-card-top">
                    <span className="public-card-icon" aria-hidden="true">
                      <Icon name={item.icon} size={22} />
                    </span>
                    <span className="home-eyebrow">{item.metrics}</span>
                  </div>
                  <h3>{item.name}</h3>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* ? 3 ????????????? */}
      <section className="home-section home-section--fullscreen is-deep">
        <ScrollReveal delay={80}>
          <div className="home-shell home-summary-grid">
            <div className="home-summary-copy">
              <span className="home-eyebrow home-eyebrow--mint"><Icon name="verified" size={14} /> ???????</span>
              <h2 className="home-section-title">
                ??????<span className="react-bits-shiny-text">?????????????</span>
              </h2>
              <p className="home-section-lead">
                ????????????????????????????????????????
              </p>
              <div className="home-summary-list">
                <div className="home-summary-item">
                  <span>01</span>
                  <strong>???????????????</strong>
                  <Icon name="arrowRight" size={18} />
                </div>
                <div className="home-summary-item">
                  <span>02</span>
                  <strong>???????????????</strong>
                  <Icon name="arrowRight" size={18} />
                </div>
                <div className="home-summary-item">
                  <span>03</span>
                  <strong>???????????????</strong>
                  <Icon name="arrowRight" size={18} />
                </div>
              </div>
            </div>

            <div className="home-summary-metric">
              <span className="home-showcase-count">6D</span>
              <span>????????</span>
              <p style={{ margin: '14px 0 0', color: '#475569', fontSize: '0.95rem', lineHeight: 1.6 }}>
                ???????????????????????????????????????
              </p>
              <div style={{ marginTop: '20px' }}>
                <Link className="home-btn home-btn--primary" href="/login">
                  ????????? <Icon name="arrowRight" size={16} />
                </Link>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </section>
    </PublicPageShell>
  );
}
