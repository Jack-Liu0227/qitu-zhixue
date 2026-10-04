// `Role` 与登录契约同源定义在 `./auth`，此处仅做 re-export。
export * from './auth.js';

export * from './project.js';
export * from './exploration.js';
export * from './tutor.js';
export * from './realtime.js';
export * from './growth.js';
export * from './reminder.js';
export * from './platform.js';
export * from './parent.js';
export * from './admin.js';
export * from './agent-runtime.js';
export * from './directory.js';
export * from './teacher.js';
export * from './settings.js';
export * from './preferences.js';
export * from './models.js';
export * from './errors.js';
export * from './learning-plan.js';
export * from './mastery.js';

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
