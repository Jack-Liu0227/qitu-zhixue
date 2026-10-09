import type { IconName } from './home/icons';

export interface PblStep {
  index: string;
  icon: IconName;
  title: string;
  detail: string;
  outcome: string;
}

export interface Competency {
  icon: IconName;
  name: string;
  en: string;
  detail: string;
  metrics: string;
}

export interface ContactRow {
  icon: IconName;
  label: string;
  value: string;
  hint?: string;
  href?: string;
}

export const PBL_STEPS: readonly PblStep[] = [
  {
    index: '01',
    icon: 'search',
    title: '真实问题精准定义',
    detail: '从身边的观察和困惑出发，明确值得研究的问题与假设。',
    outcome: '立项意向与研究假设',
  },
  {
    index: '02',
    icon: 'brain',
    title: 'AI 协同探究与验证',
    detail: '和 AI 导师对话，检索资料、比较证据并验证初步判断。',
    outcome: '研究资料与验证记录',
  },
  {
    index: '03',
    icon: 'wrench',
    title: '原型作品构建与迭代',
    detail: '通过设计、写作、编程或调研，把想法变成可交付的作品。',
    outcome: '可展示的原型作品',
  },
  {
    index: '04',
    icon: 'award',
    title: '多元复盘与能力沉淀',
    detail: '回看过程中的选择和反馈，形成可追溯的成长档案。',
    outcome: '成长记录与能力证据',
  },
];

export const COMPETENCIES: readonly Competency[] = [
  {
    icon: 'brain',
    name: '批判性思维与高质量提问',
    en: 'Critical Thinking & Inquiry',
    detail: '识别证据、追问原因，形成自己的判断。',
    metrics: '问题质量 / 证据意识',
  },
  {
    icon: 'terminal',
    name: '计算思维与跨学科建模',
    en: 'Computational Mindset',
    detail: '把复杂问题拆解成可理解、可验证的结构。',
    metrics: '抽象建模 / 逻辑表达',
  },
  {
    icon: 'wrench',
    name: '复杂问题解决与工程创作',
    en: 'Complex Problem Solving',
    detail: '通过持续试错，把想法变成可使用的作品。',
    metrics: '实践完整度 / 迭代能力',
  },
  {
    icon: 'refresh',
    name: '自主元认知与持续学习',
    en: 'Metacognition & Learning',
    detail: '知道自己已经掌握什么，也知道下一步如何补足。',
    metrics: '反思深度 / 策略调整',
  },
  {
    icon: 'hub',
    name: '人机协作与数字素养',
    en: 'AI Synergy & Future Literacy',
    detail: '把 AI 当作协作伙伴，同时保持判断和责任。',
    metrics: '协作效率 / 使用规范',
  },
  {
    icon: 'forum',
    name: '同理心沟通与团队协作',
    en: 'Empathic Collaboration',
    detail: '倾听不同观点，把复杂想法清晰地讲给别人听。',
    metrics: '团队反馈 / 表达清晰度',
  },
];

export const CONTACT_ROWS: readonly ContactRow[] = [
  { icon: 'verified', label: '公司主体', value: '启途智学科技有限公司' },
  { icon: 'hub', label: '研发团队', value: '西安交通大学团队' },
  {
    icon: 'location',
    label: '办公地址',
    value: '西安市碑林区',
    hint: '具体合作信息请通过合作联系表单提交',
  },
];
