'use client';

import { TagChips } from '@qitu/ui';

import { StudentLink } from '../../../components/student-link';
import type { InspirationTemplate } from '../types';

/** 「我想做这个」只进入探索确认流程；用 `template-<id>` 作为确定性 sessionId。 */
export function templateExploreHref(templateId: string): string {
  return `/student/inspiration/explore/template-${templateId}`;
}

export interface TemplateCardProps {
  template: InspirationTemplate;
  /** 断网只读时禁用「我想做这个」，仍可浏览模板详情。 */
  readOnly?: boolean;
}

/**
 * 推荐项目模板卡。只读展示，不写项目状态、不创建正式项目；
 * 唯一动作是跳转到 `/student/inspiration/explore/template-<id>` 进行意图确认。
 *
 * 样式全部在 `styles/inspiration.css`（qitu-inspiration-* 类），不用内联样式，
 * 这样悬停/焦点/窄屏响应式才能生效。
 */
export function TemplateCard({ template, readOnly = false }: TemplateCardProps) {
  return (
    <article className="qitu-inspiration-template-card">
      <header className="qitu-inspiration-template-header">
        <span className="qitu-inspiration-template-cover" aria-hidden="true">
          {template.coverEmoji ?? template.title.charAt(0)}
        </span>
        <div className="qitu-inspiration-template-heading">
          <h3 className="qitu-inspiration-template-title">{template.title}</h3>
          <p className="qitu-inspiration-template-meta">
            {template.subject} · {template.difficulty} · 约 {template.durationWeeks} 周
          </p>
        </div>
      </header>

      <p className="qitu-inspiration-template-summary">{template.summary}</p>

      <TagChips tags={template.tags} />

      <ol className="qitu-inspiration-stages">
        {template.stages.map((stage, index) => (
          <li key={stage.id} className="qitu-inspiration-stage">
            <span className="qitu-inspiration-stage-index" aria-hidden="true">
              {index + 1}
            </span>
            <span className="qitu-inspiration-stage-label">{stage.label}</span>
          </li>
        ))}
      </ol>

      <p className="qitu-inspiration-template-outcome">
        <span className="qitu-inspiration-template-outcome-label">成果</span>
        <span>{template.outcome}</span>
      </p>

      <footer className="qitu-inspiration-template-footer">
        {readOnly ? (
          <button type="button" className="qitu-button qitu-button-primary" disabled>
            我想做这个
          </button>
        ) : (
          <StudentLink
            className="qitu-button qitu-button-primary"
            href={templateExploreHref(template.id)}
          >
            我想做这个
          </StudentLink>
        )}
        <span className="qitu-inspiration-template-hint">
          {readOnly ? '恢复网络后再进入探索' : '先和 AI搭档确认想法，暂不创建项目'}
        </span>
      </footer>
    </article>
  );
}
