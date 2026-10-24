import type { ProjectStage, ProjectTab } from './types';

/** 正式项目列表。未确认内容在灵感空间恢复。 */
export const PROJECT_TABS: readonly { id: ProjectTab; label: string }[] = [
  { id: 'active', label: '进行中' },
  { id: 'done', label: '已完成' },
];

/** 本地数据源与服务端正式项目分类保持一致，不用于授权。 */
export const PROJECT_TAB_STAGE_MAP: Record<ProjectTab, readonly ProjectStage[]> = {
  active: [
    'intent_confirmed',
    'theory_learning',
    'theory_check',
    'practice_ready',
    'practice_building',
    'artifact_review',
    'reflection',
  ],
  draft: ['exploration'],
  done: ['published', 'completed'],
};

/** 创建项目唯一入口：灵感空间。直接创建被禁止（AGENTS.md / 确认门 Q3）。 */
export const INSPIRATION_HREF = '/student/inspiration';

/** 我的项目路由前缀（工作台路由由 workbench 模块独占）。 */
export const PROJECT_ROUTE_BASE = '/student/projects';
