'use client';

import { TagChips, VisualAsset } from '@qitu/ui';
import { subjectLabel, studentTemplateSummary } from '@qitu/contracts';

import { StudentLink } from '../../../components/student-link';
import { RecommendedExplorationButton } from './RecommendedExplorationButton';
import type { InspirationTemplate } from '../types';
import type { InspirationDataSource } from '../data';

/** 推荐卡保留独立推荐项目详情；开始推荐探索时进入统一 AI搭档。 */
export function templateExploreHref(templateId: string): string {
  return `/student/inspiration/recommended/${encodeURIComponent(templateId)}`;
}

/** 元信息行：只拼接服务端真实提供的字段，缺失项直接不显示。 */
export function templateMetaLine(template: InspirationTemplate): string {
  const lesson = template.lessonCount !== null ? `约 ${template.lessonCount} 课时` : null;
  return [template.subject ? subjectLabel(template.subject) : null, template.difficulty, lesson].filter(Boolean).join(' · ');
}

export interface TemplateCardProps {
  template: InspirationTemplate;
  /** 断网只读时禁用「我想做这个」，仍可浏览模板详情。 */
  readOnly?: boolean;
  dataSource?: InspirationDataSource;
}

/**
 * 推荐项目模板卡。只读展示，不写项目状态、不创建正式项目；
 * 唯一动作是进入推荐项目详情，项目创建和团队绑定均由灵感空间/Projects owner 完成。
 *
 * 样式全部在 `styles/inspiration.css`（qitu-inspiration-* 类），不用内联样式，
 * 这样悬停/焦点/窄屏响应式才能生效。
 */
export function TemplateCard({ template, readOnly = false, dataSource }: TemplateCardProps) {
  return (
    <article className="qitu-inspiration-template-card">
      <header className="qitu-inspiration-template-header">
        <span className="qitu-inspiration-template-cover" aria-hidden="true">
          {template.iconAssetId ? <VisualAsset assetId={template.iconAssetId} size={48} /> : template.coverEmoji ?? template.title.charAt(0)}
        </span>
        <div className="qitu-inspiration-template-heading">
          <h3 className="qitu-inspiration-template-title">{template.title}</h3>
          <p className="qitu-inspiration-template-meta">{templateMetaLine(template)}</p>
        </div>
      </header>

      <p className="qitu-inspiration-template-summary">{studentTemplateSummary(template.summary)}</p>

      <TagChips tags={template.tags.map(subjectLabel)} />

      {template.outcome ? (
        <p className="qitu-inspiration-template-outcome">
          <span className="qitu-inspiration-template-outcome-label">成果</span>
          <span>{template.outcome}</span>
        </p>
      ) : null}

      <footer className="qitu-inspiration-template-footer" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 'auto' }}>
        <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
          {readOnly ? (
            <button type="button" className="qitu-button qitu-button-primary" style={{ flex: 1 }} disabled>
              查看详情
            </button>
          ) : (
            <StudentLink
              className="qitu-button qitu-button-primary"
              style={{ flex: 1, textAlign: 'center' }}
              href={templateExploreHref(template.id)}
            >
              查看详情
            </StudentLink>
          )}

          {!readOnly && (
            <RecommendedExplorationButton
              template={template}
              dataSource={dataSource}
              className="qitu-button"
            />
          )}
        </div>
        <span className="qitu-inspiration-template-hint">
          {readOnly ? '恢复网络后再查看推荐详情' : '点击开始后直接进入对应 AI 导师团队'}
        </span>
      </footer>
    </article>
  );
}
