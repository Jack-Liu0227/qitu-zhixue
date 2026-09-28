import type { ProjectStage } from '@qitu/contracts';
import type { StudentGrowthEntryType, StudentGrowthSummary } from '../types';

/**
 * Raw mock growth records, shaped like the server `growth_record` model
 * (growth-spec.md §3.2). These deliberately include adult-only fields
 * (`summaryParent`, `summaryMentor`, `riskSignal`) and adult-only source types
 * so the mock exercises the projection: `projectStudentEntry` must drop them.
 *
 * This is the ONLY mock store in the module and it is never imported by a
 * component — only by the data source.
 */

export type InternalGrowthSourceType =
  | StudentGrowthEntryType
  | 'guardian_feedback'
  | 'mentor_note'
  | 'tutor_record'
  | 'escalation_event';

export type InternalRiskSignal = 'none' | 'stall' | 'emotion' | 'escalated' | 'no_progress';

export interface InternalGrowthRecord {
  id: string;
  type: InternalGrowthSourceType;
  occurredAt: string;
  title: string;
  summaryStudent: string;
  summaryParent: string | null;
  summaryMentor: string | null;
  riskSignal: InternalRiskSignal;
  projectId: string | null;
  projectTitle: string | null;
  stage: ProjectStage | null;
  artifactRef: string | null;
  objectiveTitles: string[];
  /**
   * 服务端证据引用（`sourceKind:opaqueId`）。原始对话 / 语音 / 内部标签不在
   * 白名单内，因此不会被当作证据引用带入学生视图；无证据即「待观察」。
   */
  evidenceIds: string[];
}

export const MOCK_GROWTH_SUMMARY: StudentGrowthSummary = {
  streakDays: 4,
  projectsCompleted: 1,
  objectivesMastered: 3,
  artifactsPublished: 1,
};

export const MOCK_GROWTH_PROJECTS: { id: string; title: string }[] = [
  { id: 'proj_robot', title: '桌面 AI 陪伴机器人' },
  { id: 'proj_game', title: '我的第一个平台跳跃小游戏' },
];

export const MOCK_GROWTH_RECORDS: InternalGrowthRecord[] = [
  {
    id: 'gr_2001',
    type: 'objective_mastered',
    occurredAt: '2026-04-02T09:10:00Z',
    title: '我学会了「变量」',
    summaryStudent: '你弄懂了变量怎么记住信息，这是编程里很重要的一块基石。',
    summaryParent: '已掌握变量相关知识点。',
    summaryMentor: '掌握变量，需巩固作用域。',
    riskSignal: 'none',
    projectId: 'proj_robot',
    projectTitle: '桌面 AI 陪伴机器人',
    stage: 'theory_learning',
    artifactRef: null,
    objectiveTitles: ['变量'],
    evidenceIds: ['theory_check:theory-variables'],
  },
  {
    id: 'gr_2002',
    type: 'project_stage_completed',
    occurredAt: '2026-04-08T14:32:00Z',
    title: '完成了「角色设计」阶段',
    summaryStudent: '你完成了角色设计，为你的作品打好了基础。',
    summaryParent: '已完成角色设计阶段。',
    summaryMentor: '角色设计完成，配色需指导。',
    riskSignal: 'none',
    projectId: 'proj_robot',
    projectTitle: '桌面 AI 陪伴机器人',
    stage: 'practice_building',
    artifactRef: null,
    objectiveTitles: [],
    evidenceIds: ['artifact:design-robot-role'],
  },
  {
    id: 'gr_2003',
    type: 'reflection_created',
    occurredAt: '2026-04-11T19:05:00Z',
    title: '写下了今天的反思',
    summaryStudent: '你写到「我发现先把大问题拆成小问题，就没那么难了」。',
    summaryParent: null,
    summaryMentor: '学生反思了问题拆解方法。',
    riskSignal: 'none',
    projectId: 'proj_robot',
    projectTitle: '桌面 AI 陪伴机器人',
    stage: 'reflection',
    artifactRef: null,
    objectiveTitles: [],
    evidenceIds: ['reflection:reflection-huge-problem'],
  },
  {
    id: 'gr_2004',
    type: 'objective_mastered',
    occurredAt: '2026-04-15T10:00:00Z',
    title: '我学会了「条件判断」',
    summaryStudent: '你已经会让程序在不同情况下做不同的选择，思路很清楚。',
    summaryParent: '已掌握条件判断。',
    summaryMentor: '条件判断掌握良好。',
    riskSignal: 'none',
    projectId: 'proj_robot',
    projectTitle: '桌面 AI 陪伴机器人',
    stage: 'theory_check',
    artifactRef: null,
    objectiveTitles: ['条件判断'],
    evidenceIds: ['student_answer:answer-condition'],
  },
  {
    // Internal-only: a stall signal. summaryStudent stays strength-based and
    // the raw label must never reach the child (projection-gate.ts §5).
    id: 'gr_2005',
    type: 'objective_mastered',
    occurredAt: '2026-04-18T16:40:00Z',
    title: '我学会了「循环」',
    summaryStudent: '你坚持尝试了很久，终于让循环按你的想法跑起来了。',
    summaryParent: '循环知识点已掌握。',
    summaryMentor: '连续 4 轮卡顿后掌握循环；已关注。',
    riskSignal: 'stall',
    projectId: 'proj_robot',
    projectTitle: '桌面 AI 陪伴机器人',
    stage: 'practice_building',
    artifactRef: null,
    objectiveTitles: ['循环'],
    evidenceIds: ['theory_check:theory-loop'],
  },
  {
    id: 'gr_2006',
    type: 'artifact_published',
    occurredAt: '2026-04-22T11:20:00Z',
    title: '发布了作品《会打招呼的小机器人》',
    summaryStudent: '你的作品发布啦，机器人会挥手跟人打招呼。',
    summaryParent: '作品已发布。',
    summaryMentor: '作品发布，交互可再打磨。',
    riskSignal: 'none',
    projectId: 'proj_robot',
    projectTitle: '桌面 AI 陪伴机器人',
    stage: 'published',
    artifactRef: 'art_robot_v1',
    objectiveTitles: ['变量', '条件判断', '循环'],
    evidenceIds: ['artifact:art_robot_v1'],
  },
  {
    id: 'gr_2007',
    type: 'project_stage_completed',
    occurredAt: '2026-04-26T09:00:00Z',
    title: '完成了「作品发布」阶段',
    summaryStudent: '你走完了发布这一步，把自己做的东西分享了出去。',
    summaryParent: '已完成发布阶段。',
    summaryMentor: '发布阶段完成。',
    riskSignal: 'none',
    projectId: 'proj_robot',
    projectTitle: '桌面 AI 陪伴机器人',
    stage: 'completed',
    artifactRef: null,
    objectiveTitles: [],
    evidenceIds: ['artifact:art_robot_v1'],
  },
  {
    // 暂未被证据支撑的结论：观察状态必须是「待观察」，绝不能画成 0 分。
    id: 'gr_2008',
    type: 'objective_mastered',
    occurredAt: '2026-04-28T10:30:00Z',
    title: '「函数」还在观察中',
    summaryStudent: '你开始尝试把重复的步骤收进函数，老师还在收集更多证据。',
    summaryParent: '孩子正在接触函数，有待更多观察。',
    summaryMentor: '函数概念初识，证据不足，待观察。',
    riskSignal: 'none',
    projectId: 'proj_robot',
    projectTitle: '桌面 AI 陪伴机器人',
    stage: 'theory_learning',
    artifactRef: null,
    objectiveTitles: ['函数'],
    evidenceIds: [],
  },
  // ---- Adult-only source types: must be filtered out of the student view. ----
  {
    id: 'gr_3001',
    type: 'guardian_feedback',
    occurredAt: '2026-04-20T08:00:00Z',
    title: '家长反馈',
    summaryStudent: '',
    summaryParent: '最近在家更愿意主动尝试了。',
    summaryMentor: '家长希望增加练习量。',
    riskSignal: 'none',
    projectId: 'proj_robot',
    projectTitle: '桌面 AI 陪伴机器人',
    stage: null,
    artifactRef: null,
    objectiveTitles: [],
    evidenceIds: [],
  },
  {
    id: 'gr_3002',
    type: 'mentor_note',
    occurredAt: '2026-04-21T08:00:00Z',
    title: '班主任备注',
    summaryStudent: '',
    summaryParent: '班主任已关注。',
    summaryMentor: '本周需重点跟进循环。',
    riskSignal: 'emotion',
    projectId: 'proj_robot',
    projectTitle: '桌面 AI 陪伴机器人',
    stage: null,
    artifactRef: null,
    objectiveTitles: [],
    evidenceIds: [],
  },
  {
    id: 'gr_3003',
    type: 'tutor_record',
    occurredAt: '2026-04-19T08:00:00Z',
    title: 'AI搭档记录',
    summaryStudent: '',
    summaryParent: null,
    summaryMentor: 'AI搭档给出 3 次提示。',
    riskSignal: 'no_progress',
    projectId: 'proj_robot',
    projectTitle: '桌面 AI 陪伴机器人',
    stage: null,
    artifactRef: null,
    objectiveTitles: [],
    evidenceIds: [],
  },
  {
    id: 'gr_3004',
    type: 'escalation_event',
    occurredAt: '2026-04-21T09:00:00Z',
    title: '升级事件',
    summaryStudent: '',
    summaryParent: '已请老师协助。',
    summaryMentor: '已升级至班主任。',
    riskSignal: 'escalated',
    projectId: 'proj_robot',
    projectTitle: '桌面 AI 陪伴机器人',
    stage: null,
    artifactRef: null,
    objectiveTitles: [],
    evidenceIds: [],
  },
];
