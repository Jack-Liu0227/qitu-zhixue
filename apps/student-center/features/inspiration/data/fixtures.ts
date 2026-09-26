import type { InspirationTemplate } from '../types';

/**
 * 模块唯一 mock 数据仓（静态 fixture）。
 *
 * 第一条「雷霆战机」是门面示例，阶段明细写足；其余复用仓库里已有的演示
 * 项目标题，保持 K-12 起步项目的可信度。真实接入时整目录由 Wave 4 替换。
 */
export const INSPIRATION_TEMPLATES: InspirationTemplate[] = [
  {
    id: 'thunder-fighter',
    title: '雷霆战机',
    summary: '从零做一款网页版飞行射击小游戏：操纵战机躲避敌机、发射子弹并计分。',
    subject: '编程',
    tags: ['游戏', '逻辑', '创意'],
    difficulty: '进阶',
    durationWeeks: 4,
    stages: [
      { id: 'thunder-explore', label: '探索与发现 · 想清楚我要做一款什么样的飞行射击游戏' },
      { id: 'thunder-theory', label: '理论学习 · 游戏循环 / 坐标系 / 帧率' },
      { id: 'thunder-practice', label: '实践制作 · 战机移动与子弹发射、碰撞检测与敌机生成' },
      { id: 'thunder-reflect', label: '成果反思 · 难度曲线与手感调优' },
    ],
    outcome: '可玩的网页版雷霆战机原型',
    coverEmoji: '🚀',
  },
  {
    id: 'talking-plant-box',
    title: '会说话的植物观察箱',
    summary: '用传感器记录教室绿植的一天，在缺水或缺光时让观察箱「说」出提醒。',
    subject: '科学',
    tags: ['科学', '硬件'],
    difficulty: '入门',
    durationWeeks: 4,
    stages: [
      { id: 'plant-explore', label: '探索与发现 · 观察教室绿植一天的变化' },
      { id: 'plant-theory', label: '理论学习 · 传感器如何感知湿度与光照' },
      { id: 'plant-practice', label: '实践制作 · 连接传感器并让观察箱「说」出提醒' },
      { id: 'plant-reflect', label: '成果反思 · 让记录更准、提醒更贴心' },
    ],
    outcome: '会提醒浇水的植物观察箱',
    coverEmoji: '🪴',
  },
  {
    id: 'weather-data-helper',
    title: '天气数据小助手',
    summary: '读一周的天气数据，做成一个能查温度、阴晴和穿衣建议的小助手。',
    subject: '编程',
    tags: ['数据', '编程'],
    difficulty: '入门',
    durationWeeks: 4,
    stages: [
      { id: 'weather-explore', label: '探索与发现 · 想清楚要帮谁查天气' },
      { id: 'weather-theory', label: '理论学习 · 数据从哪里来、如何读取与展示' },
      { id: 'weather-practice', label: '实践制作 · 做出能展示一周天气的小页面' },
      { id: 'weather-reflect', label: '成果反思 · 让数据更直观、更好读' },
    ],
    outcome: '能展示一周天气的小助手',
    coverEmoji: '🌤️',
  },
  {
    id: 'poetry-flying-flower',
    title: '诗词飞花令',
    summary: '做一个能出题、能判对错的诗词飞花令小游戏，和同学轮流接诗句。',
    subject: '语文',
    tags: ['语文', '编程', '对战'],
    difficulty: '进阶',
    durationWeeks: 8,
    stages: [
      { id: 'poetry-explore', label: '探索与发现 · 收集喜欢的诗词与关键字' },
      { id: 'poetry-intent', label: '意图确认 · 确定玩法：关键字接龙还是诗句抢答' },
      { id: 'poetry-theory', label: '理论学习 · 条件判断与列表循环' },
      { id: 'poetry-practice', label: '实践制作 · 做出能出题、能判对错的飞花令' },
      { id: 'poetry-reflect', label: '成果反思 · 题库扩充与对战体验' },
    ],
    outcome: '能和同学对战的诗词飞花令小游戏',
    coverEmoji: '📜',
  },
  {
    id: 'simple-calculator',
    title: '简易计算器',
    summary: '做一个能算加减乘除、带清除键的小计算器，理解运算顺序。',
    subject: '数学',
    tags: ['数学', '编程'],
    difficulty: '入门',
    durationWeeks: 4,
    stages: [
      { id: 'calc-explore', label: '探索与发现 · 想清楚计算器需要哪些按键' },
      { id: 'calc-theory', label: '理论学习 · 运算符与运算顺序' },
      { id: 'calc-practice', label: '实践制作 · 做出加减乘除与清除键' },
      { id: 'calc-reflect', label: '成果反思 · 处理除零等特殊情况' },
    ],
    outcome: '能算加减乘除的小计算器',
    coverEmoji: '🧮',
  },
  {
    id: 'ambient-light-lamp',
    title: '环境光线小夜灯',
    summary: '用光敏传感器做一盏会随环境光线自动亮起的小夜灯。',
    subject: '科学',
    tags: ['科学', '电子'],
    difficulty: '入门',
    durationWeeks: 4,
    stages: [
      { id: 'lamp-explore', label: '探索与发现 · 观察光线强弱的变化' },
      { id: 'lamp-theory', label: '理论学习 · 光敏传感器与判断条件' },
      { id: 'lamp-practice', label: '实践制作 · 让灯在变暗时自动亮起' },
      { id: 'lamp-reflect', label: '成果反思 · 调一调亮度阈值更贴心' },
    ],
    outcome: '会随光线自动亮起的小夜灯',
    coverEmoji: '💡',
  },
];
