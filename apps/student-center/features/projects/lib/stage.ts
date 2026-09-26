import { PROJECT_ROUTE_BASE } from '../constants';
import type { ProjectDetail, ProjectStage } from '../types';

/**
 * 所有阶段门判定只读服务端状态机 `ProjectStage`。
 * 绝不读 `progressPercent` / `currentStageIndex`（设计文档 §3.1、spec §6.4）。
 */
const THEORY_STAGES: readonly ProjectStage[] = ['theory_learning', 'theory_check'];
const PRACTICE_STAGES: readonly ProjectStage[] = [
  'practice_ready',
  'practice_building',
  'artifact_review',
];
const REFLECTION_STAGES: readonly ProjectStage[] = ['reflection', 'published', 'completed'];

/** 判断某阶段是否属于实践阶段；门判定与展示锁共用此谓词。 */
export function isPracticeStage(stage: ProjectStage): boolean {
  return PRACTICE_STAGES.includes(stage);
}

export function stageEntryHref(projectId: string, stage: ProjectStage): string | null {
  if (THEORY_STAGES.includes(stage)) return `${PROJECT_ROUTE_BASE}/${projectId}/theory`;
  if (isPracticeStage(stage)) return `${PROJECT_ROUTE_BASE}/${projectId}/practice`;
  if (REFLECTION_STAGES.includes(stage)) return `${PROJECT_ROUTE_BASE}/${projectId}/reflection`;
  return null;
}

/**
 * 实践门判定：必须同时满足服务端 `theoryMastered === true` 且状态机已到达实践后阶段。
 * 任何客户端标志都不能覆盖该结果（不可绕过）。
 */
export function canEnterPractice(
  project: Pick<ProjectDetail, 'status' | 'theoryMastered'>,
): boolean {
  if (!project.theoryMastered) return false;
  return isPracticeStage(project.status) || REFLECTION_STAGES.includes(project.status);
}

/** 锁定态文案由调用方渲染；此函数只回答「是否锁定」。 */
export function isPracticeLocked(
  project: Pick<ProjectDetail, 'status' | 'theoryMastered'>,
): boolean {
  return !canEnterPractice(project);
}

/** 由 ProjectStageView.status 派生 StageBadge 色调（纯展示）。 */
export function stageBadgeTone(
  status: 'done' | 'active' | 'pending',
): 'done' | 'current' | 'locked' {
  if (status === 'done') return 'done';
  if (status === 'active') return 'current';
  return 'locked';
}

/** 由任务 status 派生展示色调。 */
export function taskBadgeTone(
  status: 'todo' | 'doing' | 'done' | 'locked',
): 'done' | 'current' | 'locked' | 'attention' {
  if (status === 'done') return 'done';
  if (status === 'doing') return 'current';
  if (status === 'locked') return 'locked';
  return 'attention';
}
