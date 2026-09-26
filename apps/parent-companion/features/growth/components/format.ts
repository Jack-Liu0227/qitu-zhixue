import type { ProjectStage } from '@qitu/contracts';

/** Display-only date formatting for growth entries. Pure, no data access. */
export function formatGrowthDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/**
 * 家长端阶段展示文案（纯展示，绝不用于权限或阶段门判定）。
 *
 * 项目状态机以 `ProjectStage` 为唯一真相；这里只把英文枚举翻译成
 * 家长能读懂的中文，不参与任何 gate 决策。
 */
const PARENT_STAGE_LABELS: Record<ProjectStage, string> = {
  exploration: '探索方向',
  intent_confirmed: '意图确认',
  theory_learning: '理论学习',
  theory_check: '理论闯关',
  practice_ready: '实践准备',
  practice_building: '实践制作',
  artifact_review: '作品审核',
  reflection: '反思沉淀',
  published: '作品发布',
  completed: '项目完成',
};

export function parentStageLabel(stage: ProjectStage): string {
  return PARENT_STAGE_LABELS[stage] ?? stage;
}

/**
 * 家长端作品链接。
 *
 * 家长端作品查看器尚未交付（后续里程碑），这里先链接到家长端作品详情路由，
 * 与学生端 `/student/works/:id` 保持对称；该路由上线后由对应页面接管渲染。
 */
export function parentArtifactHref(artifactRef: string): string {
  return `/parent/works/${artifactRef}`;
}
