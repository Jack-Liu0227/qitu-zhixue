import type { Metadata } from 'next';
import Link from 'next/link';

import type { PublicHomeTemplate } from '@qitu/contracts';

import { countLabel } from '../home/format';
import { Icon } from '../home/icons';
import { TemplateShowcase } from '../home/showcase';
import { loadHomeView } from '../public-data';
import { PublicPageShell } from '../public-shell';

export const metadata: Metadata = {
  title: '项目展厅',
  description: '浏览平台真实发布的公开项目模板，了解适龄、学科、阶段和学习目标。',
};

export const revalidate = 60;

export default async function ShowcasePage() {
  const { view, degraded } = await loadHomeView();
  const templates: PublicHomeTemplate[] = view?.templates ?? [];

  return (
    <PublicPageShell>
      <section className="public-hero">
        <div className="home-shell public-hero-grid">
          <div>
            <p className="public-kicker"><Icon name="compass" size={16} /> Project showcase</p>
            <h1 className="public-title">每一个项目，<span>都是一次认真思考的留下。</span></h1>
            <p className="public-lead">
              这里展示平台真实发布的公开模板。你可以从一个感兴趣的问题出发，了解项目阶段、学习目标和适合的年龄范围。
            </p>
            <div className="public-actions">
              <Link className="home-btn home-btn--primary home-btn--lg" href="/login">
                登录后探索全部 <Icon name="arrowRight" size={18} />
              </Link>
              <Link className="home-btn home-btn--outline home-btn--lg" href="/learning">
                了解学习方式
              </Link>
            </div>
          </div>
          <aside className="public-hero-note">
            <strong>{degraded ? '公开模板数据暂时不可用' : `当前共有 ${countLabel(templates.length)} 个公开模板`}</strong>
            <p>展厅只展示已发布且允许公开查看的模板。服务暂时不可用时，我们不会用虚构卡片替代真实数据。</p>
          </aside>
        </div>
      </section>

      <section className="public-section">
        <div className="home-shell">
          <div className="public-section-head">
            <p className="public-kicker"><Icon name="layers" size={16} /> Published templates</p>
            <h2>从一个真实问题，开始你的项目。</h2>
            <p>登录后可以基于模板发起项目，并在自己的工作空间中继续探索和创作。</p>
          </div>
          <TemplateShowcase templates={templates} />
        </div>
      </section>
    </PublicPageShell>
  );
}
