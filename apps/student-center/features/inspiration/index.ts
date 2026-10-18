/**
 * Student-center 「灵感空间」 feature module (route `/student/inspiration`).
 *
 * 推荐项目保留独立详情流程；点击开始后直接创建项目并进入对应团队。
 */
export type { InspirationTemplate, InspirationDifficulty } from './types';

export * from './data';
export * from './hooks/useInspirationData';

export { InspirationTabs } from './components/InspirationTabs';
export type { InspirationTabsProps, InspirationTab } from './components/InspirationTabs';
export { TemplateCard, templateExploreHref } from './components/TemplateCard';
export type { TemplateCardProps } from './components/TemplateCard';
export { RecommendedTemplates } from './components/RecommendedTemplates';
export { RecommendedTemplateDetail } from './components/RecommendedTemplateDetail';
export { RecommendedExplorationButton } from './components/RecommendedExplorationButton';
export type { RecommendedTemplatesProps } from './components/RecommendedTemplates';
export { FreeExplorePanel, freeExploreHref } from './components/FreeExplorePanel';
