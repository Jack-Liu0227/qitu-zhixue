export type Student = {
  id: string;
  name: string;
  grade: string;
  age: number;
  avatar: string;
  interests: string[];
  tags: string[];
  status: '在线' | '离线';
  projectStage: string;
  activeDays: number;
  focusScore: number;
  weeklyTasks: number;
  solved: number;
  radar: { label: string; value: number }[];
  milestones: { label: string; time: string }[];
};

export const students: Student[] = [
  {
    id: 's-001',
    name: '林小宇',
    grade: '五年级',
    age: 11,
    avatar: 'L',
    interests: ['天文观测', '火箭模型', '科幻写作'],
    tags: ['高潜能', '需情绪关注'],
    status: '在线',
    projectStage: '制作与测试',
    activeDays: 42,
    focusScore: 86,
    weeklyTasks: 14,
    solved: 12,
    radar: [
      { label: '科学探究', value: 92 },
      { label: '逻辑推理', value: 78 },
      { label: '艺术表达', value: 66 },
      { label: '协作沟通', value: 73 },
      { label: '抗挫力', value: 54 },
    ],
    milestones: [
      { label: '完成“火星车”方案评审', time: '3 月 2 日' },
      { label: '自主完成 2 次自由探索', time: '3 月 8 日' },
      { label: '获得家长端 5 星反馈', time: '3 月 15 日' },
    ],
  },
  {
    id: 's-002',
    name: '陈子墨',
    grade: '四年级',
    age: 10,
    avatar: 'C',
    interests: ['昆虫观察', '自然笔记'],
    tags: ['稳定成长'],
    status: '在线',
    projectStage: '灵感探索',
    activeDays: 31,
    focusScore: 74,
    weeklyTasks: 10,
    solved: 9,
    radar: [
      { label: '科学探究', value: 70 },
      { label: '逻辑推理', value: 62 },
      { label: '艺术表达', value: 81 },
      { label: '协作沟通', value: 65 },
      { label: '抗挫力', value: 60 },
    ],
    milestones: [{ label: '开启“昆虫旅馆”项目', time: '3 月 10 日' }],
  },
  {
    id: 's-003',
    name: '赵可欣',
    grade: '六年级',
    age: 12,
    avatar: 'Z',
    interests: ['编程', '动画制作'],
    tags: ['实践能力突出'],
    status: '离线',
    projectStage: '成果展示',
    activeDays: 56,
    focusScore: 91,
    weeklyTasks: 18,
    solved: 18,
    radar: [
      { label: '科学探究', value: 75 },
      { label: '逻辑推理', value: 94 },
      { label: '艺术表达', value: 70 },
      { label: '协作沟通', value: 82 },
      { label: '抗挫力', value: 78 },
    ],
    milestones: [
      { label: '作品入选校级展示', time: '3 月 12 日' },
      { label: '完成 Scratch 作品集', time: '3 月 18 日' },
    ],
  },
  {
    id: 's-004',
    name: '王一诺',
    grade: '五年级',
    age: 11,
    avatar: 'W',
    interests: ['机器人', '机械结构'],
    tags: ['需要任务拆分支持'],
    status: '离线',
    projectStage: '深度研究',
    activeDays: 24,
    focusScore: 58,
    weeklyTasks: 8,
    solved: 5,
    radar: [
      { label: '科学探究', value: 60 },
      { label: '逻辑推理', value: 55 },
      { label: '艺术表达', value: 45 },
      { label: '协作沟通', value: 50 },
      { label: '抗挫力', value: 42 },
    ],
    milestones: [{ label: '完成机器人结构初稿', time: '3 月 9 日' }],
  },
];

export type Issue = {
  id: string;
  studentName: string;
  level: 'L1' | 'L2' | 'L3';
  category: 'Agent 逻辑卡死' | '学生情绪预警' | '家长端诉求';
  summary: string;
  time: string;
  status: '待介入' | '处理中' | '已解决';
  assignee: string;
  channel: 'AI 导师' | '家长端' | '学习事件';
  diagnostic: string;
  suggestion: string;
  prompt: string;
};

export const issues: Issue[] = [
  {
    id: 'i-001',
    studentName: '林小宇',
    level: 'L1',
    category: 'Agent 逻辑卡死',
    summary: '“火箭燃料配比”问题上，AI 连续三次给出相同提示，学生放弃追问。',
    time: '10:32',
    status: '待介入',
    assignee: '陈老师',
    channel: 'AI 导师',
    diagnostic: '语义相似度阈值偏高，判定为“重复提问”后触发了相同的启发式话术，未识别学生真实的燃料配比困惑。',
    suggestion: '建议切换为「类比引导 + 反例推演」策略，引入一段燃料配比对照实验片段，再引导总结。',
    prompt: '林小宇，你刚才问的火箭燃料配比，我们换个角度想一想：如果氧气和燃料的比例反过来，会发生什么？',
  },
  {
    id: 'i-002',
    studentName: '陈子墨',
    level: 'L2',
    category: '学生情绪预警',
    summary: '在“昆虫旅馆”任务中情绪低落，输入中出现“我不行”“都做错了”。',
    time: '09:15',
    status: '处理中',
    assignee: '陈老师',
    channel: 'AI 导师',
    diagnostic: '连续 3 次任务失败后，学生自我效能感下降，属于“能力焦虑型”卡点，需降低任务颗粒度。',
    suggestion: '将任务拆解为“观察-记录-选材”三步，先完成一个 5 分钟可验证的小目标，重建信心。',
    prompt: '子墨，我们先不做“完整模型”，只做一件事：把今天观察到的 3 种昆虫记下来，你可以吗？',
  },
  {
    id: 'i-003',
    studentName: '赵可欣',
    level: 'L3',
    category: '家长端诉求',
    summary: '家长反馈想查看孩子本周项目的详细进度，不满足于当前脱敏摘要。',
    time: '08:48',
    status: '待介入',
    assignee: '陈老师',
    channel: '家长端',
    diagnostic: '家长对“脱敏摘要”存在理解偏差，误以为平台未记录详细过程，需要补充阶段性说明。',
    suggestion: '在不越权的前提下，向家长发送「本周关键节点 + 下一步计划」的图文说明，并开放家长确认入口。',
    prompt: '可欣家长您好，本周可欣已完成“作品集”的脚本设计，下周将进入配音阶段。您可以随时查看成长节点。',
  },
];

export const settingsSections = [
  { id: 'strategy', label: '启发式导师策略与防刷题', active: true },
  { id: 'intervention', label: '人机协同干预触发条件', active: false },
  { id: 'privacy', label: '三端权限与家长端脱敏规则', active: false },
  { id: 'voice', label: '语音与文本交互偏好', active: false },
  { id: 'experiment', label: '实验性与灰度配置', active: false },
];
