import type { ProjectStage, ProjectTab } from './types';

/** 列表三个标签及其展示文案。 */
export const PROJECT_TABS: readonly { id: ProjectTab; label: string }[] = [
  { id: 'active', label: '进行中' },
  { id: 'draft', label: '草稿' },
  { id: 'done', label: '已完成' },
];

/**
 * ⚠️ OPEN CONFIRM GATE — Q2「标签 ↔ ProjectStatus 映射」。
 *
 * 产品尚未拍板（建议：草稿 = exploration/intent_confirmed；已完成 = completed；
 * 其余 = 进行中）。为避免阶段字面量散落，映射**只在此常量声明一次**；
 * 数据层按此过滤，UI 与门判定不读取映射结果做权限判断。
 * 待 Q2 确认后，仅改这一个常量即可。
 */
export const PROJECT_TAB_STAGE_MAP: Record<ProjectTab, readonly ProjectStage[]> = {
  active: [
    'theory_learning',
    'theory_check',
    'practice_ready',
    'practice_building',
    'artifact_review',
    'reflection',
    'published',
  ],
  draft: ['exploration', 'intent_confirmed'],
  done: ['completed'],
};

/** 创建项目唯一入口：灵感空间。直接创建被禁止（AGENTS.md / 确认门 Q3）。 */
export const INSPIRATION_HREF = '/student/inspiration';

/** 我的项目路由前缀（工作台路由由 workbench 模块独占）。 */
export const PROJECT_ROUTE_BASE = '/student/projects';
