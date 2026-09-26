import { ApiError } from '@qitu/api-client';
import { ProjectsDataError } from '../data/data-source';

/** 五态（+ ready）判别联合；每屏都能落到其中之一。 */
export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'offline'; data: T }
  | { status: 'empty' }
  | { status: 'error'; error: ProjectsError }
  | { status: 'denied'; error: ProjectsError };

/** 由 URL/演示入口注入的场景，用于在 mock 阶段触达五态。 */
export type ScreenScenario = 'loading' | 'empty' | 'error' | 'offline' | 'denied';

export interface ProjectsError {
  message: string;
  status?: number;
  code?: string;
}

export const DEMO_ERROR: ProjectsError = {
  message: '项目数据加载失败，请稍后重试。',
  status: 500,
};

export const DEMO_DENIED: ProjectsError = {
  message: '你不是该项目的成员，无法查看。',
  status: 403,
  code: 'FORBIDDEN',
};

export function toProjectsError(error: unknown): ProjectsError {
  if (error instanceof ProjectsDataError) {
    return { message: error.message, status: error.status, code: error.code };
  }
  if (error instanceof ApiError) {
    return { message: error.message, status: error.status, code: error.code };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: '发生未知错误。' };
}

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
