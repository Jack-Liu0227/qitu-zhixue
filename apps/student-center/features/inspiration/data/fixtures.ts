import type { InspirationTemplate } from '../types';

/**
 * 灵感空间项目模板仓，严格与后端数据库及 Admin Console 模板库保持一致。
 * 核心包含两大真实 PBL 课题：雷霆战机小游戏 PBL 与 动手学动能定理 PBL。
 */
export const INSPIRATION_TEMPLATES: InspirationTemplate[] = [
  {
    id: 'thunder-fighter',
    title: '雷霆战机小游戏 PBL',
    summary: '从零做一款 Python/Pygame 飞行射击游戏：操控战机、发射子弹、AABB 碰撞检测与敌机刷新。',
    subject: '信息科技 / 编程',
    tags: ['游戏开发', 'Pygame', '碰撞检测', '事件循环'],
    difficulty: '进阶',
    durationWeeks: 4,
    stages: [
      { id: 'thunder-explore', label: '阶段一：意图确认与开题 · 明确游戏操控与关卡设想' },
      { id: 'thunder-theory', label: '阶段二：核心机制探究 · Pygame 事件循环与 AABB 碰撞检测数学原理 (TheoryMastered 门禁)' },
      { id: 'thunder-practice', label: '阶段三：工程实践编码 · 战机移动、子弹发射、碰撞检测与沙箱自检' },
      { id: 'thunder-reflect', label: '阶段四：作品答辩反思 · 概念掌握质询与成长档案归档' },
    ],
    outcome: '完整可玩的 Python 雷霆战机游戏原型与作品反思报告',
    coverEmoji: '🚀',
  },
  {
    id: 'kinetic-energy',
    title: '动手学动能定理 PBL',
    summary: '物理探究实验项目：通过小车受力与加速实验，数值模拟验证合外力做功与动能变化关系。',
    subject: '物理 / 数学',
    tags: ['物理实验', '动能定理', '功与能量', 'Python 仿真'],
    difficulty: '进阶',
    durationWeeks: 3,
    stages: [
      { id: 'kinetic-explore', label: '阶段一：现象观察与假设 · 观察小车受力与加速度变化，确认实验假设' },
      { id: 'kinetic-theory', label: '阶段二：公式推导验证 · 恒力做功 W 与动能变化 ΔEk 定量关系推导 (TheoryMastered 门禁)' },
      { id: 'kinetic-practice', label: '阶段三：数值仿真与绘图 · 使用 Python Matplotlib 绘制功-能曲线与拟合误差分析' },
      { id: 'kinetic-reflect', label: '阶段四：实验答辩反思 · 阻力误差修正答辩与永久档案生成' },
    ],
    outcome: '动能定理数值仿真验证报告与交互式动能演示面板',
    coverEmoji: '⚡',
  },
];
