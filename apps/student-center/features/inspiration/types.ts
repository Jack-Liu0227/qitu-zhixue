/**
 * 学生端「灵感空间」模块类型。
 *
 * `stages` 直接复用契约里的 `TemplateStage`（id + label），不在这里再造一套
 * 阶段模型。阶段名来自冻结模板数据（探索与发现 / 意图确认 / 理论学习 /
 * 实践制作 / 成果反思 这一套词汇），组件代码不设阶段名常量。
 */
import type { TemplateStage } from '@qitu/contracts';

export type { TemplateStage } from '@qitu/contracts';

export type InspirationDifficulty = '入门' | '进阶' | '挑战';

/** 一条推荐项目模板（只读展示；点击后进入探索确认流程，不直接创建项目）。 */
export interface InspirationTemplate {
  id: string;
  title: string;
  summary: string;
  subject: string;
  tags: string[];
  difficulty: InspirationDifficulty;
  durationWeeks: number;
  /** 阶段明细逐字来自模板数据；组件只负责渲染。 */
  stages: TemplateStage[];
  outcome: string;
  coverEmoji?: string;
}
