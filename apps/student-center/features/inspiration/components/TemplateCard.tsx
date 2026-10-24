'use client';

import { VisualAsset } from '@qitu/ui';
import { subjectLabel, studentTemplateSummary } from '@qitu/contracts';
import { StudentLink } from '../../../components/student-link';
import { RecommendedExplorationButton } from './RecommendedExplorationButton';
import type { InspirationTemplate } from '../types';
import type { InspirationDataSource } from '../data';

export function templateExploreHref(templateId: string): string {
  return `/student/inspiration/recommended/${encodeURIComponent(templateId)}`;
}

export function templateMetaLine(template: InspirationTemplate): string {
  const lesson = template.lessonCount !== null ? `${template.lessonCount} 课时` : null;
  const minutes = template.lessonMinutes ? `每课 ${template.lessonMinutes} 分钟` : null;
  return [template.subject ? subjectLabel(template.subject) : null, template.difficulty, lesson, minutes].filter(Boolean).join(' · ');
}

export interface TemplateCardProps {
  template: InspirationTemplate;
  readOnly?: boolean;
  dataSource?: InspirationDataSource;
}

export function TemplateCard({ template, readOnly = false, dataSource }: TemplateCardProps) {
  return <article className="qitu-inspiration-template-card">
    <header className="qitu-inspiration-template-header">
      <span className="qitu-inspiration-template-cover" aria-hidden="true">
        <VisualAsset assetId={template.iconAssetId ?? 'subject-interdisciplinary-v1'} size={40} />
      </span>
      <div className="qitu-inspiration-template-heading">
        <div className="qitu-inspiration-template-category">{template.subject ? subjectLabel(template.subject) : '跨学科探究'}</div>
        <h3 className="qitu-inspiration-template-title">{template.title}</h3>
      </div>
    </header>
    {template.summary ? <p className="qitu-inspiration-template-summary">{studentTemplateSummary(template.summary)}</p> : null}
    <div className="qitu-inspiration-template-meta">
      {template.lessonCount !== null ? <span>{template.lessonCount} 课时{template.lessonMinutes ? ` · 每课 ${template.lessonMinutes} 分钟` : ''}</span> : null}
      {template.difficulty ? <span>{template.difficulty}</span> : null}
    </div>
    <footer className="qitu-inspiration-template-footer">
      <div className="qitu-inspiration-card-actions">
        {readOnly ? <button type="button" className="qitu-button qitu-button-secondary qitu-card-btn" disabled>查看项目</button>
          : <StudentLink className="qitu-button qitu-button-secondary qitu-card-btn" href={templateExploreHref(template.id)}>查看项目</StudentLink>}
        {!readOnly ? <RecommendedExplorationButton template={template} dataSource={dataSource}
          className="qitu-button qitu-button-primary qitu-card-btn qitu-card-start-btn" /> : null}
      </div>
    </footer>
  </article>;
}
