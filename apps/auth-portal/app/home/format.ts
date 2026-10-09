import type { PublicHomeTemplate } from '@qitu/contracts';

/**
 * 首页展示用的格式化工具。
 *
 * 两条硬约束：
 * 1. 全部是**纯函数且不依赖运行环境**（不用 `toLocaleString` / `Intl` / `Date`），
 *    因为首页在服务端渲染后由浏览器接管，Node 与浏览器的 Intl 数据可能不同，
 *    会造成 hydration 不匹配；
 * 2. 数据库里存的是英文枚举（`programming` / `beginner`），展示需要中文，
 *    映射表缺失时**原样回退**，不猜测、不隐藏数据。
 */

/** 学科领域：与 `project_templates.domain` 的取值对应。 */
const DOMAIN_LABELS: Record<string, string> = {
  programming: '编程与算法',
  design: '设计与创意',
  art: '艺术表达',
  science: '科学探究',
  engineering: '工程构建',
  humanities: '人文与社科',
  ai: '人工智能',
  data: '数据科学',
  language: '语言与表达',
};

/** 难度：与 `project_templates.difficulty` 的取值对应。 */
const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: '入门友好',
  intermediate: '进阶级别',
  advanced: '高阶挑战',
  easy: '入门友好',
  medium: '进阶级别',
  hard: '高阶挑战',
};

export function domainLabel(domain: string | null): string | null {
  if (domain === null || domain.trim() === '') return null;
  const key = domain.trim().toLowerCase();
  return DOMAIN_LABELS[key] ?? domain;
}

export function difficultyLabel(difficulty: string | null): string | null {
  if (difficulty === null || difficulty.trim() === '') return null;
  const key = difficulty.trim().toLowerCase();
  return DIFFICULTY_LABELS[key] ?? difficulty;
}

/** `10-14` → `10-14 岁`；已是中文描述时原样返回。 */
export function ageRangeLabel(ageRange: string | null): string | null {
  if (ageRange === null || ageRange.trim() === '') return null;
  const value = ageRange.trim();
  if (value.includes('岁')) return value;
  return `${value} 岁`;
}

/** 分钟转「约 N 小时 / 约 N 分钟」，用于卡片上的预计投入。 */
export function durationLabel(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 60) return `约 ${Math.round(minutes)} 分钟`;
  const hours = minutes / 60;
  const rounded = Math.round(hours * 10) / 10;
  return `约 ${rounded} 小时`;
}

/** 千分位分隔；手写实现以避免 Intl 在服务端与浏览器上的差异。 */
export function countLabel(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 参与人数文案。
 *
 * 真实数据里刚上线的模板参与人数就是 0 —— 与其显示「0 人已参与」，
 * 不如如实说明它还没有参与者。
 */
export function participantsLabel(participants: number): string {
  if (!Number.isFinite(participants) || participants <= 0) return '暂无参与者，等你第一篇';
  return `${countLabel(participants)} 人已参与`;
}

/** `2025-04-18T09:30:00.000Z` → `2025-04-18`；不做时区换算，避免跨时区显示漂移。 */
export function publishedDateLabel(publishedAt: string | null): string | null {
  if (publishedAt === null || publishedAt.length < 10) return null;
  return publishedAt.slice(0, 10);
}

/** 卡片副标题的「跨学科」串：领域 + 年龄 + 难度 + 时长，缺项自动跳过。 */
export function templateFacts(template: PublicHomeTemplate): string[] {
  const facts = [
    domainLabel(template.domain),
    ageRangeLabel(template.ageRange),
    difficultyLabel(template.difficulty),
    durationLabel(template.estimatedDurationMinutes),
  ];
  return facts.filter((fact): fact is string => fact !== null);
}

/** 阶段标签串，例如「探索 · 理论 · 实践 · 展示」。 */
export function stageSummary(template: PublicHomeTemplate): string | null {
  const labels = template.stages.map((stage) => stage.label).filter((label) => label.trim() !== '');
  return labels.length > 0 ? labels.join(' · ') : null;
}
