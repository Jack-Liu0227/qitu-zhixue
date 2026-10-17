import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '../home/icons';
import { ScrollReveal } from '../home/scroll-reveal';
import { PublicPageShell } from '../public-shell';

export const metadata: Metadata = {
  title: '????',
  description: '??????????????????????????????????? AI ???',
};

export default function AboutPage() {
  return (
    <PublicPageShell>
      {/* ? 1 ??Hero ???? */}
      <section className="home-hero react-bits-hero-wrapper home-section--fullscreen is-glow">
        <ScrollReveal>
          <div className="home-shell home-hero-grid">
            <div className="home-hero-copy">
              <p className="home-badge react-bits-badge">
                <span className="react-bits-badge-glow" />
                <span>?? ???????? ? ??? AI ??</span>
                <span className="react-bits-badge-arrow">?</span>
              </p>
              <h1 className="home-hero-title">
                ????????<span className="react-bits-shiny-text">???????????</span>
              </h1>
              <p className="home-hero-sub">????????????????????? AI ????????</p>
              <p className="home-hero-lead">
                ???????????????????????????????? AI ?????
                ??????????????????????????????????
              </p>
              <div className="home-hero-actions">
                <Link className="home-btn home-btn--primary home-btn--lg" href="/learning">
                  ??????? <Icon name="arrowRight" size={18} />
                </Link>
                <Link className="home-btn home-btn--outline home-btn--lg" href="/contact">
                  ????
                </Link>
              </div>
            </div>

            <aside className="public-hero-note">
              <div className="public-hero-note-badge">
                <Icon name="verified" size={18} />
                <span>????????</span>
              </div>
              <h3>???????????</h3>
              <p>
                ???????????????????????????????????????????????
              </p>
              <div className="public-hero-note-tags">
                <span className="home-eyebrow">?????</span>
                <span className="home-eyebrow">????</span>
                <span className="home-eyebrow home-eyebrow--mint">????</span>
              </div>
            </aside>
          </div>
        </ScrollReveal>
      </section>

      {/* ? 2 ???????? */}
      <section className="home-section home-section--fullscreen is-tinted">
        <ScrollReveal delay={80}>
          <div className="home-shell">
            <div className="public-section-head">
              <span className="home-eyebrow"><Icon name="target" size={14} /> Our principles</span>
              <h2 className="home-section-title">
                ??????????<span className="react-bits-shiny-text">???????????</span>
              </h2>
              <p className="home-section-lead">???????????????????????????????????</p>
            </div>
            <div className="public-card-grid">
              <article className="public-card">
                <div className="public-card-top">
                  <span className="public-card-icon" aria-hidden="true">
                    <Icon name="search" size={22} />
                  </span>
                  <span className="home-eyebrow">????</span>
                </div>
                <h3>???????</h3>
                <p>?????????????????????????????</p>
              </article>
              <article className="public-card">
                <div className="public-card-top">
                  <span className="public-card-icon" aria-hidden="true">
                    <Icon name="brain" size={22} />
                  </span>
                  <span className="home-eyebrow">????</span>
                </div>
                <h3>? AI ????</h3>
                <p>AI ??????????????????????????</p>
              </article>
              <article className="public-card">
                <div className="public-card-top">
                  <span className="public-card-icon" aria-hidden="true">
                    <Icon name="wrench" size={22} />
                  </span>
                  <span className="home-eyebrow">????</span>
                </div>
                <h3>???????</h3>
                <p>????????????????????????????</p>
              </article>
              <article className="public-card">
                <div className="public-card-top">
                  <span className="public-card-icon" aria-hidden="true">
                    <Icon name="chart" size={22} />
                  </span>
                  <span className="home-eyebrow home-eyebrow--mint">????</span>
                </div>
                <h3>??????</h3>
                <p>?????????????????????????</p>
              </article>
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* ? 3 ??????????? */}
      <section className="home-section home-section--fullscreen is-deep">
        <ScrollReveal delay={80}>
          <div className="home-shell public-contact-grid">
            <div className="public-contact-panel">
              <span className="home-eyebrow"><Icon name="hub" size={14} /> ????</span>
              <h2>????</h2>
              <p>?????????????????????? AI ?????????????????????????????</p>
              <ul className="public-contact-list">
                <li>
                  <Icon name="verified" size={20} aria-hidden="true" />
                  <div>
                    <strong>????</strong>
                    <span>??????????</span>
                  </div>
                </li>
                <li>
                  <Icon name="hub" size={20} aria-hidden="true" />
                  <div>
                    <strong>????</strong>
                    <span>????????????</span>
                  </div>
                </li>
                <li>
                  <Icon name="location" size={20} aria-hidden="true" />
                  <div>
                    <strong>????</strong>
                    <span>??????</span>
                  </div>
                </li>
              </ul>
            </div>
            <div className="public-form-panel">
              <span className="home-eyebrow home-eyebrow--mint"><Icon name="hub" size={14} /> ????</span>
              <h2>??????????</h2>
              <p>????????????????????????????? AI ??????????</p>
              <div className="public-actions" style={{ marginTop: '28px' }}>
                <Link className="home-btn home-btn--primary" href="/contact">
                  ?????? <Icon name="arrowRight" size={18} />
                </Link>
                <Link className="home-btn home-btn--outline" href="/login">
                  ??????
                </Link>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </section>
    </PublicPageShell>
  );
}
