import { PROJECT_ROUTE_BASE } from '../constants';

/** 路由拼接集中一处，组件不散落字符串。 */
export function projectDetailHref(projectId: string): string {
  return `${PROJECT_ROUTE_BASE}/${projectId}`;
}

export function projectTheoryHref(projectId: string): string {
  return `${PROJECT_ROUTE_BASE}/${projectId}/theory`;
}

export function projectPracticeHref(projectId: string): string {
  return `${PROJECT_ROUTE_BASE}/${projectId}/practice`;
}

export function projectReflectionHref(projectId: string): string {
  return `${PROJECT_ROUTE_BASE}/${projectId}/reflection`;
}
