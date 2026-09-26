/**
 * Student-center 「灵感空间」 feature module (route `/student/inspiration`).
 *
 * 推荐项目只读展示；「我想做这个」进入 `/student/inspiration/explore/` 确认流程，
 * 不创建正式项目（AGENTS.md）。自由探索保留既有 `demo-session` 入口。
 */
export type { InspirationTemplate, InspirationDifficulty } from './types';

export * from './data';
export * from './hooks/useInspirationData';

export { InspirationTabs } from './components/InspirationTabs';
export type { InspirationTabsProps, InspirationTab } from './components/InspirationTabs';
export { TemplateCard, templateExploreHref } from './components/TemplateCard';
export type { TemplateCardProps } from './components/TemplateCard';
export { RecommendedTemplates } from './components/RecommendedTemplates';
export type { RecommendedTemplatesProps } from './components/RecommendedTemplates';
export { FreeExplorePanel, freeExploreHref, FREE_EXPLORE_SESSION_ID } from './components/FreeExplorePanel';
