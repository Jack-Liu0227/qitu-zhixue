import { projectDetailHref } from '../lib/links';
import type { TemplateStage } from '@qitu/contracts';
import type {
  MentorNoteView,
  NextStep,
  ProjectDetail,
  ProjectStageView,
  TaskView,
  TheoryMaterial,
  TheoryQuestion,
} from '../types';

/**
 * 模块唯一 mock 数据仓。
 *
 * 阶段名只在这里以模板数据形式出现（验收 8：组件代码无阶段名常量）；
 * 服务端状态机值来自 `ProjectStage`。真实接入时整目录由 Wave 4 替换，
 * 组件与 hooks 无需改动。
 */

export const MOCK_TEMPLATE_STAGES: Record<string, TemplateStage[]> = {
  'tpl-4w': [
    { id: 't4-explore', label: '探索与发现' },
    { id: 't4-intent', label: '意图确认' },
    { id: 't4-theory', label: '理论学习' },
    { id: 't4-practice', label: '实践制作' },
  ],
  'tpl-8w': [
    { id: 't8-explore', label: '探索与发现' },
    { id: 't8-intent', label: '意图确认' },
    { id: 't8-theory', label: '理论学习' },
    { id: 't8-practice', label: '实践制作' },
    { id: 't8-reflect', label: '成果反思' },
  ],
};

export const MOCK_PROJECTS: ProjectDetail[] = [
  {
    id: 'p-1001',
    title: '会说话的植物观察箱',
    subtitle: '用传感器记录教室绿植的一天',
    tags: ['科学', '硬件'],
    status: 'practice_building',
    currentStageIndex: 4,
    stageTotal: 4,
    progressPercent: 62,
    templateVersionId: 'tpl-4w',
    theoryMastered: true,
  },
  {
    id: 'p-1002',
    title: '校园垃圾分类小助手',
    subtitle: '做一个会提醒的智能垃圾桶',
    tags: ['环保', '编程'],
    status: 'theory_check',
    currentStageIndex: 3,
    stageTotal: 4,
    progressPercent: 40,
    templateVersionId: 'tpl-4w',
    theoryMastered: false,
  },
  {
    id: 'p-1003',
    title: '我的第一首电子音乐',
    subtitle: '用代码写一段旋律',
    tags: ['音乐', '创意'],
    status: 'intent_confirmed',
    currentStageIndex: 2,
    stageTotal: 5,
    progressPercent: 15,
    templateVersionId: 'tpl-8w',
    theoryMastered: false,
  },
  {
    id: 'p-1004',
    title: '给流浪猫的喂食提醒',
    subtitle: '还没想清楚要怎么做',
    tags: ['公益'],
    status: 'exploration',
    currentStageIndex: 1,
    stageTotal: 5,
    progressPercent: 5,
    templateVersionId: 'tpl-8w',
    theoryMastered: false,
  },
  {
    id: 'p-1005',
    title: '会变色的心情灯',
    subtitle: '用颜色表达今天的情绪',
    tags: ['情绪', '电子'],
    status: 'completed',
    currentStageIndex: 4,
    stageTotal: 4,
    progressPercent: 100,
    templateVersionId: 'tpl-4w',
    theoryMastered: true,
    completedAt: '2026-08-30',
  },
];

const stage = (
  id: string,
  index: number,
  name: string,
  status: ProjectStageView['status'],
  description: string,
  state: ProjectStageView['stage'],
): ProjectStageView => ({ id, index, name, status, description, stage: state });

export const MOCK_STAGE_VIEWS: Record<string, ProjectStageView[]> = {
  'p-1001': [
    stage('t4-explore', 1, '探索与发现', 'done', '找到想解决的问题', 'intent_confirmed'),
    stage('t4-intent', 2, '意图确认', 'done', '说清楚为什么要做', 'intent_confirmed'),
    stage('t4-theory', 3, '理论学习', 'done', '先掌握关键原理', 'theory_check'),
    stage('t4-practice', 4, '实践制作', 'active', '动手做出第一版', 'practice_building'),
  ],
  'p-1002': [
    stage('t4-explore', 1, '探索与发现', 'done', '找到想解决的问题', 'intent_confirmed'),
    stage('t4-intent', 2, '意图确认', 'done', '说清楚为什么要做', 'intent_confirmed'),
    stage('t4-theory', 3, '理论学习', 'active', '先掌握关键原理', 'theory_check'),
    stage('t4-practice', 4, '实践制作', 'pending', '通过校验后解锁', 'practice_ready'),
  ],
  'p-1003': [
    stage('t8-explore', 1, '探索与发现', 'done', '找到想解决的问题', 'exploration'),
    stage('t8-intent', 2, '意图确认', 'active', '说清楚为什么要做', 'intent_confirmed'),
    stage('t8-theory', 3, '理论学习', 'pending', '先掌握关键原理', 'theory_learning'),
    stage('t8-practice', 4, '实践制作', 'pending', '通过校验后解锁', 'practice_ready'),
    stage('t8-reflect', 5, '成果反思', 'pending', '回看自己的成长', 'reflection'),
  ],
  'p-1004': [
    stage('t8-explore', 1, '探索与发现', 'active', '慢慢想清楚方向', 'exploration'),
    stage('t8-intent', 2, '意图确认', 'pending', '说清楚为什么要做', 'intent_confirmed'),
    stage('t8-theory', 3, '理论学习', 'pending', '先掌握关键原理', 'theory_learning'),
    stage('t8-practice', 4, '实践制作', 'pending', '通过校验后解锁', 'practice_ready'),
    stage('t8-reflect', 5, '成果反思', 'pending', '回看自己的成长', 'reflection'),
  ],
  'p-1005': [
    stage('t4-explore', 1, '探索与发现', 'done', '找到想解决的问题', 'intent_confirmed'),
    stage('t4-intent', 2, '意图确认', 'done', '说清楚为什么要做', 'intent_confirmed'),
    stage('t4-theory', 3, '理论学习', 'done', '先掌握关键原理', 'theory_check'),
    stage('t4-practice', 4, '实践制作', 'done', '已经完成并发布', 'completed'),
  ],
};

export const MOCK_TASKS: Record<string, TaskView[]> = {
  'p-1001': [
    {
      id: 'task-1001-1',
      stageId: 't4-practice',
      title: '接好温湿度传感器',
      description: '把传感器连到主控板并读出数据。',
      status: 'done',
      isTodayFocus: false,
      order: 1,
    },
    {
      id: 'task-1001-2',
      stageId: 't4-practice',
      title: '让数据变成一句话',
      description: '当湿度过低时，让观察箱说出提醒。',
      status: 'doing',
      isTodayFocus: true,
      order: 2,
    },
  ],
  'p-1002': [
    {
      id: 'task-1002-1',
      stageId: 't4-theory',
      title: '认识「分类」的判断条件',
      description: '读懂什么是可回收物。',
      status: 'doing',
      isTodayFocus: true,
      order: 1,
    },
    {
      id: 'task-1002-2',
      stageId: 't4-practice',
      title: '做出第一个提醒装置',
      description: '理论校验通过后解锁。',
      status: 'locked',
      isTodayFocus: false,
      order: 2,
    },
  ],
  'p-1003': [
    {
      id: 'task-1003-1',
      stageId: 't8-intent',
      title: '写下我想做的旋律',
      description: '用一句话描述你的想法。',
      status: 'todo',
      isTodayFocus: true,
      order: 1,
    },
  ],
  'p-1004': [],
  'p-1005': [
    {
      id: 'task-1005-1',
      stageId: 't4-practice',
      title: '完成并发布',
      description: '作品已进入展厅。',
      status: 'done',
      isTodayFocus: false,
      order: 1,
    },
  ],
};

export const MOCK_NEXT_STEPS: Record<string, NextStep> = {
  'p-1001': {
    title: '继续实践制作',
    description: '完成「让数据变成一句话」，做出可演示的第一版。',
    targetStage: 'practice_building',
    deepLink: projectDetailHref('p-1001', { mode: 'practice', taskId: 'task-1001-2' }),
  },
  'p-1002': {
    title: '先完成理论学习校验',
    description: '通过理论校验后，实践制作才会解锁。',
    targetStage: 'theory_check',
    deepLink: projectDetailHref('p-1002', { mode: 'learn', taskId: 'task-1002-1' }),
  },
  'p-1003': {
    title: '确认你的项目意图',
    description: '把「我想做」说清楚，才能进入理论学习。',
    targetStage: 'intent_confirmed',
    deepLink: projectDetailHref('p-1003', { mode: 'overview' }),
  },
};

export const MOCK_THEORY_MATERIAL: Record<string, TheoryMaterial> = {
  'p-1002': {
    title: '垃圾分类的判断条件',
    sections: [
      { heading: '什么是判断条件', body: '判断条件决定程序走哪一条路。' },
      { heading: '例子', body: '如果物体可回收，就放入蓝色桶。' },
    ],
  },
};

export const MOCK_THEORY_QUESTIONS: Record<string, TheoryQuestion[]> = {
  'p-1002': [
    {
      id: 'q-1002-1',
      prompt: '程序里「判断条件」的作用是什么？',
      options: ['决定程序走哪一条路', '让程序变慢', '删除所有数据'],
    },
    {
      id: 'q-1002-2',
      prompt: '下面哪个是判断条件？',
      options: ['如果湿度过低就提醒', '打印一句话', '打开开关'],
    },
  ],
};

/** 判分答案仅存在于 mock 数据层；真实判分在服务端。 */
export const MOCK_THEORY_ANSWER_KEY: Record<string, number> = {
  'q-1002-1': 0,
  'q-1002-2': 0,
};

export const MOCK_MENTOR_NOTES: Record<string, MentorNoteView> = {
  'p-1001': {
    author: '班主任',
    message: '这周多留意传感器读数，有困难先用提问找线索。',
    updatedAt: '2026-09-20',
  },
};
