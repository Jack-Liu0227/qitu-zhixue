import type {
  ReminderCategory,
  ReminderTemplateId,
  ReminderTriggerSource,
} from '@qitu/contracts';
import { LEARNING_PROGRESS_STALL_SOURCE } from './learning-stall-signal';

/**
 * 服务端独占的提醒模板白名单。
 *
 * 设计约束（ISSUE-T2 / R-T2）：
 * - 服务端是**唯一**的文案来源，客户端只能读渲染后的 `ReminderView`；
 * - 文案只描述「休息一下」或「找人帮忙」这类**学习行为建议**，不涉及情绪、
 *   心情、诊断、医疗、心理状态、风险标签或对未成年人贴标签；
 * - 所有模板都必须在模块加载时通过 `assertNonMedicalTemplate()`，命中任何
 *   敏感词会在启动期直接抛错（fail-fast），而不是等到线上才发出违规文案。
 */

export interface ReminderTemplate {
  id: ReminderTemplateId;
  category: ReminderCategory;
  source: ReminderTriggerSource;
  title: string;
  body: string;
}

export const REMINDER_TEMPLATES: Readonly<Record<ReminderTemplateId, ReminderTemplate>> = {
  learning_stall_take_break: {
    id: 'learning_stall_take_break',
    category: 'rest_suggestion',
    source: LEARNING_PROGRESS_STALL_SOURCE,
    title: '先歇一会儿？',
    body: '你在这个问题上已经停了几轮。起身喝口水、走一走，回来再看也可以。',
  },
  learning_stall_ask_for_help: {
    id: 'learning_stall_ask_for_help',
    category: 'help_suggestion',
    source: LEARNING_PROGRESS_STALL_SOURCE,
    title: '可以找人聊聊',
    body: '卡住的时候，把已经想清楚的那部分讲给老师或同学听，也许会有新线索。',
  },
};

export const REMINDER_TEMPLATE_IDS = Object.keys(REMINDER_TEMPLATES) as ReminderTemplateId[];

/**
 * 非医疗 / 非标签化的禁用词。
 *
 * 这是确定性的最后闸门：即使将来模板被改动，命中禁用词也会在启动期失败。
 * 它**不是**分类器，只做子串匹配，宁可拦多也不放过。
 */
export const NON_MEDICAL_FORBIDDEN_TERMS: readonly string[] = [
  // 中文：医疗 / 诊断 / 情绪 / 风险 / 标签
  '诊断',
  '抑郁',
  '焦虑',
  '症状',
  '治疗',
  '医疗',
  '疾病',
  '障碍',
  '药物',
  '心理',
  '情绪',
  '心情',
  '压力',
  '风险',
  '躯体',
  '疲惫',
  '崩溃',
  '内耗',
  '烦躁',
  '低落',
  // 英文：medical / diagnosis / emotion / risk
  'diagnos',
  'depress',
  'anxiet',
  'symptom',
  'therapy',
  'disorder',
  'mental',
  'emotion',
  'stress',
  'risk',
];

/** 命中禁用词时抛出的错误；属于编码 / 配置错误，应在启动期暴露。 */
export class NonMedicalTemplateViolationError extends Error {
  constructor(
    readonly templateId: ReminderTemplateId,
    readonly term: string,
  ) {
    super(`提醒模板「${templateId}」命中非医疗禁用词「${term}」`);
    this.name = 'NonMedicalTemplateViolationError';
  }
}

/** 校验单个模板只包含非医疗、非标签化的文案。 */
export function assertNonMedicalTemplate(template: ReminderTemplate): void {
  const haystack = `${template.title}\n${template.body}`;
  for (const term of NON_MEDICAL_FORBIDDEN_TERMS) {
    if (haystack.includes(term)) {
      throw new NonMedicalTemplateViolationError(template.id, term);
    }
  }
}

// 启动期 fail-fast：白名单里有一个违规模板，整个服务就不该起来。
for (const template of Object.values(REMINDER_TEMPLATES)) {
  assertNonMedicalTemplate(template);
}

/** 类型守卫：拒绝来自客户端 / 外部数据的任意字符串。 */
export function isReminderTemplateId(value: unknown): value is ReminderTemplateId {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(REMINDER_TEMPLATES, value)
  );
}

/**
 * 按停滞轮数确定性地选择一个白名单模板。
 *
 * 不使用随机数，便于 QA 复现；同一个停滞计数必然得到同一条文案。
 */
export function pickReminderTemplate(stallCount: number): ReminderTemplate {
  return stallCount % 2 === 0
    ? REMINDER_TEMPLATES.learning_stall_take_break
    : REMINDER_TEMPLATES.learning_stall_ask_for_help;
}
