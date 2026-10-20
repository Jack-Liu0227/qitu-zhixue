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

/** 一条推荐项目模板（只读展示；点击开始后创建对应项目并进入团队）。 */
export interface InspirationTemplate {
  id: string;
  title: string;
  summary: string;
  subject: string;
  tags: string[];
  /** 服务端未提供可识别的难度时为 null：不显示，也不编造。 */
  difficulty: InspirationDifficulty | null;
  /** 由服务端 estimatedDurationMinutes 换算；无数据时为 null（不显示）。 */
  lessonCount: number | null;
  lessonMinutes: 60 | 120 | null;
  /** The published template version bound to recommended explorations; null means unavailable. */
  templateVersionId: string | null;
  /** 阶段明细逐字来自模板数据；组件只负责渲染。 */
  stages: TemplateStage[];
  outcome: string;
  coverEmoji?: string;
}
