import type { Metadata } from 'next';

import { ConsultationForm } from '../home/consult-form';
import { Icon } from '../home/icons';
import { ScrollReveal } from '../home/scroll-reveal';
import { CONTACT_ROWS } from '../public-content';
import { PublicPageShell } from '../public-shell';

export const metadata: Metadata = {
  title: '合作联系',
  description: '联系启途智学，预约体验课或咨询学校、机构与家庭学习方案。',
};

export default function ContactPage() {
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
              一起为孩子，<span className="react-bits-shiny-text">做一段值得留下的学习旅程</span>
            </h1>
            <p className="home-hero-lead">
              无论你是学生、家长、学校还是研学机构，都可以通过表单告诉我们正在关注的问题，
              我们会在 1 个工作日内与你联系。
            </p>
          </div>
        </ScrollReveal>
      </section>

      {/* 第 2 屏：表单与联系方式 */}
      <section className="home-section home-section--fullscreen is-tinted">
        <ScrollReveal delay={80}>
          <div className="home-shell public-contact-grid">
            <aside className="public-contact-panel">
              <h2>联系我们</h2>
              <p>欢迎了解项目式 AI 学习、校本课程合作和家庭学习方案。</p>
              <ul className="public-contact-list">
                {CONTACT_ROWS.slice(0, 3).map((row) => (
                  <li key={row.label}>
                    <Icon name={row.icon} size={20} aria-hidden="true" />
                    <div>
                      <strong>{row.label}</strong>
                      {row.href !== undefined ? (
                        <a href={row.href}>{row.value}</a>
                      ) : (
                        <span>{row.value}</span>
                      )}
                      {row.hint !== undefined ? <span>{row.hint}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </aside>

            <div className="public-form-panel">
              <h2>预约体验课 / 机构合作洽谈</h2>
              <p>提交信息后，教育顾问会根据你的需求准备合适的方案建议。</p>
              <ConsultationForm />
            </div>
          </div>
        </ScrollReveal>
      </section>
    </PublicPageShell>
  );
}