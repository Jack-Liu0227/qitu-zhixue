// `Role` 与登录契约同源定义在 `./auth`，此处仅做 re-export。
export * from './auth';

export * from './project';
export * from './exploration';
export * from './tutor';
export * from './realtime';
export * from './growth';
export * from './reminder';
export * from './platform';
export * from './parent';
export * from './admin';
export * from './agent-runtime';
export * from './directory';
export * from './teacher';
export * from './settings';
export * from './preferences';
export * from './models';
export * from './errors';
export * from './learning-plan';
export * from './mastery';

export interface HealthResponse {
  service: string;
  status: 'ok';
  version: string;
}

/** 单个依赖的探活结果。`not_configured` 不是故障。 */
export type DependencyStatus = 'ok' | 'error' | 'not_configured';

/** 整体就绪状态。复用管理员端 `AdminRuntimeHealth` 的词汇。 */
export type ReadinessStatus = 'ready' | 'degraded' | 'not_ready';

export interface DependencyProbe {
  status: DependencyStatus;
  /** 给人看的原因；**不得**包含连接串、主机名或异常原文。 */
  detail?: string;
}

/**
 * `GET /api/v1/health/ready` 的响应。
 *
 * 与 `HealthResponse` 的区别：前者是**存活**探针（不碰依赖），这里是
 * **就绪**探针（真的 ping Postgres / Redis）。`not_ready` 时 HTTP 状态为 503。
 */
export interface ReadinessResponse {
  service: string;
  status: ReadinessStatus;
  version: string;
  checkedAt: string;
  dataMode: 'live' | 'demo' | 'test';
  dependencies: {
    database: DependencyProbe;
    redis: DependencyProbe;
  };
}
