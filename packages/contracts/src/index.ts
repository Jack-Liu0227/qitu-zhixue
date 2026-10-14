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
export * from './team-runtime.js';
export * from './provider-manifest.js';
export * from './voice.js';
export * from './directory.js';
export * from './teacher.js';
export * from './settings.js';
export * from './preferences.js';
export * from './models.js';
export * from './errors.js';
export * from './learning-plan.js';
export * from './pbl-learning.js';
export * from './mastery.js';
export * from './public-content.js';

/**
 * 数据来源模式（唯一真源）。
 *
 * - `live`：正式数据（Postgres）。
 * - `demo`：显式演示数据（内置样例、种子、fixture）。
 * - `test`：显式测试/CI 数据。
 *
 * 复用 `ReadinessResponse.dataMode` 的既有词汇；服务端 `DATABASE_TOKEN` 注入的
 * `DataMode` 也是这一个类型。任何**硬编码在页面里**的数据都必须按此标注，
 * 见 `apps/admin-console/lib/components/DataModeBadge.tsx`。
 */
export type DataMode = 'live' | 'demo' | 'test';

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
  dataMode: DataMode;
  dependencies: {
    database: DependencyProbe;
    redis: DependencyProbe;
  };
}
