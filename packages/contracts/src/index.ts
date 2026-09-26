// `Role` 与登录契约同源定义在 `./auth`，此处仅做 re-export。
export * from './auth';

import type { ProjectStage } from './project';
export * from './project';
export * from './tutor';
export * from './realtime';
export * from './growth';
export * from './settings';
export * from './errors';

export interface HealthResponse {
  service: string;
  status: 'ok';
  version: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  stage: ProjectStage;
  progress: number;
}
