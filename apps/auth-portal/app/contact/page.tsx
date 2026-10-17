import type { Metadata } from 'next';
import Link from 'next/link';

import { CONTACT_ROWS } from '../public-content';
import { Icon } from '../home/icons';
import { ConsultationForm } from '../home/consult-form';
import { ScrollReveal } from '../home/scroll-reveal';
import { PublicPageShell } from '../public-shell';

export const metadata: Metadata = {
  title: '????',
  description: '????????????????????????????',
};

export default function ContactPage() {
  return (
    <PublicPageShell>
      {/* ? 1 ??Hero ????????? */}
      <section className="home-hero react-bits-hero-wrapper home-section--fullscreen is-glow">
        <ScrollReveal>
          <div className="home-shell public-contact-grid">
            <aside className="public-contact-panel">
              <p className="home-badge react-bits-badge">
                <span className="react-bits-badge-glow" />
                <span>?? ???? ? ??????</span>
                <span className="react-bits-badge-arrow">?</span>
              </p>
              <h1 className="home-hero-title">
                ??????<span className="react-bits-shiny-text">????????????</span>
              </h1>
              <p className="home-hero-lead">
                ??????????????????????????????????
                ?????? 1 ?????????????????
              </p>
              <ul className="public-contact-list">
                {CONTACT_ROWS.slice(0, 3).map((row) => (
                  <li key={row.label}>
                    <Icon name={row.icon} size={20} aria-hidden="true" />
                    <div>
                      <strong>{row.label}</strong>
                      {row.href !== undefined ? <a href={row.href}>{row.value}</a> : <span>{row.value}</span>}
                      {row.hint !== undefined ? <span>{row.hint}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </aside>

            <div className="public-form-panel">
              <span className="home-eyebrow"><Icon name="mail" size={14} /> ???????</span>
              <h2>????? / ??????</h2>
              <p>???????????????????????????</p>
              <ConsultationForm />
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* ? 2 ????????????? */}
      <section className="home-section home-section--fullscreen is-tinted">
        <ScrollReveal delay={80}>
          <div className="home-shell">
            <div className="public-section-head">
              <span className="home-eyebrow"><Icon name="hub" size={14} /> ????</span>
              <h2 className="home-section-title">
                ??????<span className="react-bits-shiny-text">????????????</span>
              </h2>
              <p className="home-section-lead">?????????????????????????????????</p>
            </div>

            <div className="public-card-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <article className="public-card">
                <div className="public-card-top">
                  <span className="public-card-icon" aria-hidden="true"><Icon name="school" size={22} /></span>
                  <span className="home-eyebrow">????</span>
                </div>
                <h3>????????</h3>
                <p>?????????? PBL ????????????????????????????????</p>
              </article>

              <article className="public-card">
                <div className="public-card-top">
                  <span className="public-card-icon" aria-hidden="true"><Icon name="group" size={22} /></span>
                  <span className="home-eyebrow">????</span>
                </div>
                <h3>?????????</h3>
                <p>1?1 AI ??????????????????????????????????????</p>
              </article>

              <article className="public-card">
                <div className="public-card-top">
                  <span className="public-card-icon" aria-hidden="true"><Icon name="layers" size={22} /></span>
                  <span className="home-eyebrow home-eyebrow--mint">????</span>
                </div>
                <h3>??????????</h3>
                <p>????????????????????????????????-????-???????????</p>
              </article>
            </div>
          </div>
        </ScrollReveal>
      </section>
    </PublicPageShell>
  );
}
