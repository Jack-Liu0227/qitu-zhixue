import Link from 'next/link';

import type { PublicHomeTemplate } from '@qitu/contracts';

import {
  domainLabel,
  participantsLabel,
  publishedDateLabel,
  stageSummary,
  templateFacts,
} from './format';
import { Icon, type IconName } from './icons';

const TONES = ['violet', 'mint', 'amber', 'sky'] as const;

const DOMAIN_ICONS: Record<string, IconName> = {
  programming: 'terminal',
  design: 'compass',
  art: 'sparkle',
  science: 'search',
  engineering: 'wrench',
  ai: 'robot',
  data: 'chart',
  humanities: 'forum',
  language: 'forum',
};

function toneFor(index: number): string {
  return TONES[index % TONES.length] ?? 'violet';
}

function iconFor(domain: string | null): IconName {
  if (domain === null) return 'layers';
  return DOMAIN_ICONS[domain.trim().toLowerCase()] ?? 'layers';
}

/**
 * 项目展厅。
 *
 * 卡片内容全部来自 `GET /api/v1/public/home` 的**真实已发布模板**；
 * 没有可用数据时给出明确的空状态，而不是拿写死的卡片顶替。
 */
export function TemplateShowcase({ templates }: { templates: PublicHomeTemplate[] }) {
  if (templates.length === 0) {
    return (
      <div className="home-empty" role="status">
        <span className="home-empty-icon" aria-hidden="true">
          <Icon name="layers" size={26} />
        </span>
        <h3>暂时没有可展示的公开模板</h3>
        <p>平台模板库正在整理中，登录后仍可以看到已授权给你的全部项目模板与历史项目。</p>
        <Link className="home-btn home-btn--outline" href="/login?next=%2Fstudent%2Finspiration">
          登录查看模板库
          <Icon name="arrowRight" size={18} />
        </Link>
      </div>
    );
  }

  return (
    <div className="home-template-grid">
      {templates.map((template, index) => {
        const facts = templateFacts(template);
        const stages = stageSummary(template);
        const published = publishedDateLabel(template.publishedAt);
        const domain = domainLabel(template.domain);
        const objectives = template.learningObjectives.slice(0, 2);
        return (
          <article className="home-template-card" key={template.id}>
            <div className={`home-thumb home-thumb--${toneFor(index)}`}>
              <span className="home-thumb-glyph" aria-hidden="true">
                <Icon name={iconFor(template.domain)} size={26} />
              </span>
              <span className="home-thumb-domain">{domain ?? '项目式学习'}</span>
              <span className="home-thumb-version">{template.version ?? '未发布'}</span>
            </div>

            <div className="home-template-body">
              <h3 className="home-template-title">{template.title}</h3>
              {facts.length > 0 ? <p className="home-template-facts">{facts.join(' · ')}</p> : null}
              <p className="home-template-summary">{template.summary}</p>

              {objectives.length > 0 ? (
                <ul className="home-objectives">
                  {objectives.map((objective) => (
                    <li key={objective}>
                      <Icon name="checkCircle" size={15} />
                      {objective}
                    </li>
                  ))}
                </ul>
              ) : null}

              {stages !== null ? (
                <p className="home-template-stages">
                  <Icon name="layers" size={15} /> {stages}
                </p>
              ) : null}
            </div>

            <div className="home-template-foot">
              <span className="home-template-participants">
                <Icon name="group" size={16} />
                {participantsLabel(template.participants)}
              </span>
              <span className="home-template-published">
                {published !== null ? (
                  <>
                    <Icon name="clock" size={15} /> 更新于 {published}
                  </>
                ) : (
                  '版本整理中'
                )}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
