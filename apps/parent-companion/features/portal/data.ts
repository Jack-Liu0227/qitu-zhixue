export const childProfile = {
  name: '林小宇',
  grade: '七年级',
  avatar: '宇',
  lastSynced: '今天 20:42',
};

export const homeMetrics = [
  { label: '本周学习', value: '8 次', delta: '比上周多 1 次', tone: 'blue', icon: '频' },
  { label: '投入时长', value: '5.6 小时', delta: '节奏稳定', tone: 'purple', icon: '时' },
  { label: '项目进度', value: '62%', delta: '正在实践制作', tone: 'orange', icon: '进' },
  { label: '连续学习', value: '8 天', delta: '本月最长记录', tone: 'teal', icon: '续' },
] as const;

export const projectStages = [
  { label: '兴趣确认', detail: '已完成', status: 'done' },
  { label: '理论学习', detail: '已掌握', status: 'done' },
  { label: '实践制作', detail: '进行中', status: 'current' },
  { label: '作品完善', detail: '下一步', status: 'upcoming' },
  { label: '展示反思', detail: '待解锁', status: 'upcoming' },
] as const;

export const growthRecords = [
  {
    date: '09月26日',
    source: 'AI 导师记录',
    title: '把复杂任务拆成了三个可以验证的小步骤',
    summary: '小宇先画出了输入、处理、输出的流程，再逐个检查传感器与反馈逻辑。遇到异常时没有立刻更换方案，而是先定位原因。',
    tags: ['问题分解', '调试意识'],
    tone: 'primary',
  },
  {
    date: '09月24日',
    source: '孩子自述',
    title: '“第一次的失败让我知道要先做小测试”',
    summary: '他在反思里记录了两个失败版本，并说明下一次会先验证单个模块，再把它们组合起来。',
    tags: ['反思迭代', '真实表达'],
    tone: 'completed',
  },
  {
    date: '09月21日',
    source: '家长反馈',
    title: '主动讲解了作品为什么这样设计',
    summary: '晚饭时，小宇用自己的话解释了机器人的“感知”和“回应”，没有照着材料复述。',
    tags: ['概念迁移', '表达能力'],
    tone: 'attention',
  },
] as const;

export const projectWorks = [
  {
    title: '桌面 AI 陪伴机器人 · 交互原型 v2',
    stage: '实践制作',
    type: '交互原型',
    date: '今天 19:36',
    description: '新增距离感应后的灯光反馈，并保留了第一次测试失败的记录。',
    accent: 'blue',
  },
  {
    title: '输入—处理—输出流程图',
    stage: '理论学习',
    type: '学习记录',
    date: '09月23日',
    description: '用自己的例子解释三个环节，已通过理论检查。',
    accent: 'teal',
  },
  {
    title: '第一次传感器测试',
    stage: '实践制作',
    type: '测试记录',
    date: '09月24日',
    description: '记录误触发问题、猜测原因与下一步验证方法。',
    accent: 'orange',
  },
] as const;

export type ParentMessage = {
  id: string;
  category: '学习动态' | '建议关注' | '员工回复' | '已解决';
  title: string;
  summary: string;
  time: string;
  unread: boolean;
  status: '无需处理' | '建议关注' | '处理中' | '已解决';
  project: string;
  aiHelp: string[];
  detail: string;
  reply?: string;
};

export const parentMessages: ParentMessage[] = [
  {
    id: 'msg-1042',
    category: '建议关注',
    title: '小宇在传感器调试环节遇到持续卡点',
    summary: 'AI 已调整解释方式，并建议今晚用一个开放问题了解他的思路。',
    time: '今天 20:16',
    unread: true,
    status: '建议关注',
    project: '桌面 AI 陪伴机器人',
    detail: '最近两次学习中，小宇都在“距离数据不稳定”处停留较久。他仍在主动尝试，目前不需要直接给出答案。',
    aiHelp: ['把调试目标缩小为“先观察五次数据”', '用对比例子解释稳定值与异常值', '保留失败版本，避免重复试错'],
  },
  {
    id: 'msg-1039',
    category: '学习动态',
    title: '理论检查已完成，实践阶段已解锁',
    summary: '小宇能够在新情境中识别输入、处理和输出。',
    time: '昨天 18:40',
    unread: true,
    status: '无需处理',
    project: '桌面 AI 陪伴机器人',
    detail: '本次结论来自小宇自己的解释和一组新情境判断，并非仅根据观看材料或学习时长生成。',
    aiHelp: ['提供思考方向 1 次', '没有提供完整答案'],
  },
  {
    id: 'msg-1031',
    category: '员工回复',
    title: '班主任已回复你关于学习节奏的反馈',
    summary: '本周会维持当前任务量，并观察两次学习后的状态。',
    time: '09月24日',
    unread: false,
    status: '处理中',
    project: '桌面 AI 陪伴机器人',
    detail: '你的反馈已转为班主任工单，班主任会结合过程证据观察节奏，不会直接修改孩子的掌握状态。',
    aiHelp: ['已在下一轮教学上下文中降低单次任务量'],
    reply: '收到。小宇近期动力不错，但连续任务过长时容易着急。本周先维持每次 25 分钟，周五我再和你同步。',
  },
  {
    id: 'msg-1022',
    category: '已解决',
    title: '作品预览无法打开的问题已解决',
    summary: '文件已重新完成安全扫描，历史版本没有丢失。',
    time: '09月20日',
    unread: false,
    status: '已解决',
    project: '桌面 AI 陪伴机器人',
    detail: '系统重新处理了作品预览文件，孩子的原始文件与版本记录均保持不变。',
    aiHelp: ['系统处理，无需 AI 教学介入'],
    reply: '问题已处理完成。如果仍无法查看，请在当前消息下继续反馈。',
  },
];
