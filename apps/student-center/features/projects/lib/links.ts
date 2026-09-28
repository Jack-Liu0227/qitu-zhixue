import type { ProjectDeepLink, ProjectViewMode } from '@qitu/contracts';
import { PROJECT_ROUTE_BASE } from '../constants';

export interface ProjectLinkOptions {
  taskId?: string | null;
  mode?: ProjectViewMode | null;
}

const PROJECT_VIEW_MODES: readonly ProjectViewMode[] = [
  'overview',
  'learn',
  'practice',
  'showcase',
];

function isProjectViewMode(value: string): value is ProjectViewMode {
  return PROJECT_VIEW_MODES.includes(value as ProjectViewMode);
}

/**
 * 统一项目深链：所有入口都落到同一个详情容器。
 *
 * `task_id` 和 `mode` 只决定默认聚焦内容，不改变项目资源边界；
 * 服务端仍必须根据当前用户和项目状态重新校验可见性与可执行动作。
 */
export function projectDetailHref(
  projectId: string,
  options: ProjectLinkOptions = {},
): string {
  const query = new URLSearchParams();
  if (options.taskId) query.set('task_id', options.taskId);
  if (options.mode) query.set('mode', options.mode);
  const suffix = query.toString();
  return `${PROJECT_ROUTE_BASE}/${encodeURIComponent(projectId)}${suffix ? `?${suffix}` : ''}`;
}

/** 从 Next searchParams 解析规范深链参数，非法 mode 按未指定处理。 */
export function parseProjectDeepLink(
  projectId: string,
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): ProjectDeepLink {
  const taskValue = searchParams.task_id;
  const modeValue = searchParams.mode;
  const taskId = Array.isArray(taskValue) ? taskValue[0] : taskValue;
  const mode = Array.isArray(modeValue) ? modeValue[0] : modeValue;
  return {
    projectId,
    taskId: taskId?.trim() || null,
    mode: mode && isProjectViewMode(mode) ? mode : null,
  };
}

export function projectTheoryHref(projectId: string, taskId?: string): string {
  return projectDetailHref(projectId, { taskId, mode: 'learn' });
}

export function projectPracticeHref(projectId: string, taskId?: string): string {
  return projectDetailHref(projectId, { taskId, mode: 'practice' });
}

export function projectReflectionHref(projectId: string): string {
  return projectDetailHref(projectId, { mode: 'showcase' });
}
