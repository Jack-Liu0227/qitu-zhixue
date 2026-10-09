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
    detail:
      '从碳足迹量化、城市潮汐车道优化到历史档案重构。学生在多元社会图景中捕捉痛点，明确核心研究议题。',
    outcome: '立项意向与研究假设书',
  },
  {
    index: '02',
    icon: 'brain',
    title: 'AI 协同探究与验证',
    detail:
      '对话定制化领域智能体。借助多维文献检索、数据仿真与逆向推演，快速验证初步假设的严密性与可行性。',
    outcome: '多变量数据仿真图谱',
  },
  {
    index: '03',
    icon: 'wrench',
    title: '原型作品构建与迭代',
    detail:
      '告别纸上谈兵。结合低代码开发、3D 建模、硬件原型或交互式大模型问答引擎，将理论转化为可交互工程实体。',
    outcome: '高保真原型系统与代码库',
  },
  {
    index: '04',
    icon: 'award',
    title: '多元复盘与能力认证',
    detail:
      '组织同行评审答辩，AI 全流程评估推演日志，自动沉淀形成可追溯的个人成长能力档案与数字学术徽章。',
    outcome: '可追溯的能力认证记录',
  },
];

export const COMPETENCIES: readonly Competency[] = [
  {
    icon: 'brain',
    name: '批判性思维与深度问辨',
    en: 'Critical Thinking & Prompt Inquiry',
    detail:
      '拒绝轻信标准答案，掌握向生成式大模型提出高质量反思性 Prompt 的技能。学会识别逻辑漏洞、因果颠倒及认知偏见。',
    metrics: '逻辑链深度 / 逆向追问频次',
  },
  {
    icon: 'terminal',
    name: '计算思维与跨学科建模',
    en: 'Computational & Algorithmic Mindset',
    detail:
      '将混沌复杂的大千世界拆解为可计算的数据结构与算法流程。融汇物理原理、社会学规律与统计学模型解决现实挑战。',
    metrics: '抽象建模能力 / 参数鲁棒性',
  },
  {
    icon: 'wrench',
    name: '复杂问题解决与工程创造',
    en: 'Complex Problem Solving',
    detail:
      '具备强韧的「动手做」精神，完成智能物联网硬件打样、定制软件开发或实地调研论文，从 0 到 1 产出具有实用价值的物化作品。',
    metrics: '工程实操完整度 / 迭代抗挫力',
  },
  {
    icon: 'refresh',
    name: '自主元认知与终身学习力',
    en: 'Metacognition & Adaptive Learning',
    detail:
      '清晰洞察「我知道什么」与「我不知道什么」。借助平台即时认知回溯树，实时审视思维盲区，自发制定学习补强计划。',
    metrics: '自我反思深度 / 策略敏捷调整率',
  },
  {
    icon: 'hub',
    name: '人机协作与数字共创素养',
    en: 'AI Synergy & Future Literacy',
    detail:
      '不再将 AI 视作替身，而是将之作为第二大脑与智囊团。熟练运用协同编码、生成式图像推演与文献聚类加速研究进程。',
    metrics: '人机工作流效率 / AI 伦理合规',
  },
  {
    icon: 'forum',
    name: '同理心沟通与共情领导力',
    en: 'Empathic Leadership & Storytelling',
    detail:
      '在团队协作中换位思考、倾听异见，将晦涩的科技方案转译为打动人心的叙事。在公开答辩与路演中展现自信与领导力。',
    metrics: '团队同行评价 / 演讲说服力指数',
  },
];

export const TESTIMONIALS = [
  {
    initial: '陈',
    name: '陈思齐（高二年级）',
    note: '完成 3 项 PBL 课题 · 获 ISEF 省级选拔推荐',
    quote:
      '以前做题总是只看考卷给的标准答案，在启途做完《微塑料降解菌种环境模拟》项目后，我发现真实世界的科学没有唯一解。AI 导师从不直接告诉我答案，而是一步步追问，逼我自己理顺实验因果逻辑。',
  },
  {
    initial: '张',
    name: '张工（资深算法架构师 / 初中生家长）',
    note: '持续伴学 180 天',
    quote:
      '作为计算机系家长，我最抗拒把 AI 当作「偷懒作弊工具」。启途智学的引导机制太妙了，它把孩子培养成驾驭 AI 的领航员，教孩子自己提问、自查逻辑，这种自主元认知是课本里学不到的无价之宝。',
  },
  {
    initial: '李',
    name: '李建荣 特级教师',
    note: '重点示范高中科创教研组长',
    quote:
      '我们学校引入启途的项目工作坊后，孩子们的课堂参与度有了飞跃。特别是「能力罗盘报告」，每学期生成的多维雷达评估能清晰展示出学生的跨学科整合力，是面向新高考与综合素质评价的重器。',
  },
] as const;

export const CONTACT_ROWS: readonly ContactRow[] = [
  {
    icon: 'location',
    label: '总部研发中心',
    value: '西安市碑林区创智天地科创中心 12 栋',
  },
  {
    icon: 'mail',
    label: '商务与生态合作邮箱',
    value: 'partner@qituzhixue.com',
    href: 'mailto:partner@qituzhixue.com',
  },
  {
    icon: 'phone',
    label: '全国课程与研学热线',
    value: '400-820-9188',
    hint: '周一至周日 09:00 - 21:00',
    href: 'tel:4008209188',
  },
  {
    icon: 'qr',
    label: '微信公众号',
    value: '启途智学科创智库',
    hint: '关注后回复「样章」获取课程样章',
  },
];

export const FOOTER_COLUMNS = [
  {
    title: '创新产品',
    links: [
      { label: 'AI 驱动 PBL 项目工坊', href: '/learning' },
      { label: '21 世纪核心能力罗盘', href: '/competencies' },
      { label: '苏格拉底式导师引擎', href: '/login' },
      { label: '高校与实验室互联链', href: '/contact' },
    ],
  },
  {
    title: '关于生态',
    links: [
      { label: '关于启途智学', href: '/about' },
      { label: '品牌与教育理念', href: '/about' },
      { label: '研学基地合作', href: '/contact' },
      { label: '学术导师智库', href: '/contact' },
      { label: '教育公平公益计划', href: '/contact' },
      { label: '热门项目展厅', href: '/showcase' },
    ],
  },
] as const;
