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
 * 推荐项目模板卡。
 * 遵循 PBL 启发式探索设计：
 * - 顶部醒目展示项目图标、完整标题与元信息徽章；
 * - 摘要与短标签清晰呈现核心方向；
 * - 探究亮点（核心目标微型看板）帮助学生快速了解挑战内容；
 * - 底部主次分明的双按钮，支持【查看详情】与【与AI搭档开始】。
 */
export function TemplateCard({ template, readOnly = false, dataSource }: TemplateCardProps) {
  // 仅显示精简的规范短标签（<=12字，最多3个）
  const displayTags = (template.tags ?? [])
    .filter((t) => t && t.trim().length > 0 && t.length <= 12)
    .slice(0, 3);

  // 提取前2项代表性探究目标作为亮点速览
  const highlightObjectives = (template.learningObjectives ?? [])
    .filter((o) => o && o.trim().length > 0)
    .slice(0, 2);

  return (
    <article className="qitu-inspiration-template-card">
      <header className="qitu-inspiration-template-header">
        <span className="qitu-inspiration-template-cover" aria-hidden="true">
          <VisualAsset assetId={template.iconAssetId ?? 'subject-interdisciplinary-v1'} size={48} />
        </span>
        <div className="qitu-inspiration-template-heading">
          <h3 className="qitu-inspiration-template-title" title={template.title}>
            {template.title}
          </h3>
          <div className="qitu-inspiration-template-meta">
            {template.subject && (
              <span className="qitu-inspiration-meta-badge">{subjectLabel(template.subject)}</span>
            )}
            {template.difficulty && (
              <span className={`qitu-inspiration-difficulty qitu-difficulty-${template.difficulty}`}>
                {template.difficulty}
              </span>
            )}
            {template.lessonCount !== null && (
              <span className="qitu-inspiration-meta-text">约 {template.lessonCount} 课时</span>
            )}
          </div>
        </div>
      </header>

      <div className="qitu-inspiration-template-body">
        {template.summary ? (
          <p className="qitu-inspiration-template-summary" title={studentTemplateSummary(template.summary)}>
            {studentTemplateSummary(template.summary)}
          </p>
        ) : null}

        {displayTags.length > 0 ? (
          <div className="qitu-inspiration-tags-wrap">
            <TagChips tags={displayTags.map(subjectLabel)} />
          </div>
        ) : null}

        {highlightObjectives.length > 0 ? (
          <div className="qitu-inspiration-highlights">
            <span className="qitu-inspiration-highlights-label">核心探究方向</span>
            <ul className="qitu-inspiration-highlights-list">
              {highlightObjectives.map((obj, idx) => (
                <li key={idx} className="qitu-inspiration-highlight-item" title={obj}>
                  {obj}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {template.outcome ? (
          <div className="qitu-inspiration-template-outcome">
            <span className="qitu-inspiration-template-outcome-label">🎯 预期成果</span>
            <span className="qitu-inspiration-template-outcome-value" title={template.outcome}>
              {template.outcome}
            </span>
          </div>
        ) : null}
      </div>

      <footer className="qitu-inspiration-template-footer">
        <div className="qitu-inspiration-card-actions">
          {readOnly ? (
            <button type="button" className="qitu-button qitu-button-secondary qitu-card-btn" disabled>
              查看详情
            </button>
          ) : (
            <StudentLink
              className="qitu-button qitu-button-secondary qitu-card-btn"
              href={templateExploreHref(template.id)}
            >
              查看详情
            </StudentLink>
          )}

          {!readOnly && (
            <RecommendedExplorationButton
              template={template}
              dataSource={dataSource}
              className="qitu-button qitu-button-primary qitu-card-btn qitu-card-start-btn"
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
