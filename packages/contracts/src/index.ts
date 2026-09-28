// `Role` 与登录契约同源定义在 `./auth`，此处仅做 re-export。
export * from './auth';

export * from './project';
export * from './exploration';
export * from './tutor';
export * from './realtime';
export * from './growth';
export * from './platform';
export * from './parent';
export * from './admin';
export * from './directory';
export * from './teacher';
export * from './settings';
export * from './models';
export * from './errors';

export interface HealthResponse {
  service: string;
  status: 'ok';
  version: string;
}
