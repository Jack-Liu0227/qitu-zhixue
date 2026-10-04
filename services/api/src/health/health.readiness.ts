import type { Database } from '@qitu/database';
import { sql } from 'drizzle-orm';
import type { DataMode } from '../database';
import type { RedisAdapter } from '@qitu/infra';

/**
 * 就绪探针（readiness）的纯逻辑。
 *
 * 与 `/health`（存活探针）的分工：
 *  - `/api/v1/health`  —— **存活**：只证明进程还能接请求，不碰任何外部依赖，
 *    必须永远快且永远 200（否则会被反复重启）。它现在是、也应当保持「静态」。
 *  - `/api/v1/health/ready` —— **就绪**：真的去 ping Postgres / Redis，
 *    依赖不可用时返回 503，让编排层把流量摘走而不是继续打进来。
 *
 * 此前两者混为一谈：只探存活却把结果当成「一切正常」（归档为 Issue #23）。
 */

export type DependencyStatus = 'ok' | 'error' | 'not_configured';
export type ReadinessStatus = 'ready' | 'degraded' | 'not_ready';

export interface DependencyProbe {
  status: DependencyStatus;
  /** 给人看的原因；**不得**包含连接串、主机名或异常原文。 */
  detail?: string;
}

export interface ReadinessInput {
  dataMode: DataMode;
  database: DependencyProbe;
  redis: DependencyProbe;
}

export interface ReadinessDecision {
  status: ReadinessStatus;
  httpStatus: 200 | 503;
}

/**
 * 纯函数：由依赖探针结果决定就绪状态与 HTTP 状态码。
 *
 * 分级理由：
 *  - Postgres 是唯一 system-of-record，`live` 模式下它挂了 → `not_ready`(503)，
 *    因为此时几乎每个接口都会失败，接流量没有意义。
 *  - Redis 是**可选**依赖（缓存 / 分布式锁）。它不可用时平台仍能提供
 *    非 Redis 能力，所以是 `degraded`(200) 而不是 503 —— 这与此前
 *    「Redis 连接失败不阻断启动」的既有决策一致，只是把状态说清楚。
 *  - `demo` / `test` 模式本来就不使用 Postgres / Redis，`not_configured`
 *    不算故障，否则本地与 CI 永远处于 `not_ready`。
 */
export function decideReadiness(input: ReadinessInput): ReadinessDecision {
  const databaseRequired = input.dataMode === 'live';

  if (input.database.status === 'error' && databaseRequired) {
    return { status: 'not_ready', httpStatus: 503 };
  }
  if (input.database.status === 'error') {
    return { status: 'degraded', httpStatus: 200 };
  }

  const redisDegraded =
    input.redis.status === 'error' ||
    (input.redis.status === 'not_configured' && input.dataMode === 'live');

  return redisDegraded
    ? { status: 'degraded', httpStatus: 200 }
    : { status: 'ready', httpStatus: 200 };
}

/** 探活超时：绝不让探针自己挂住，把健康检查变成新故障点。 */
export const PROBE_TIMEOUT_MS = 2000;

/** 给 promise 套一个超时。超时按失败处理（探针只关心「能不能用」）。 */
export async function withTimeout<T>(promise: Promise<T>, ms: number = PROBE_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`探活超时（${ms}ms）`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Postgres 探活。
 *
 * 只跑 `select 1`：不读业务表，因此不需要任何权限假设，也不会因为
 * 某个表被锁而误报。真实失败原因只进日志（由调用方记录）。
 */
export async function probeDatabase(db: Database | null): Promise<DependencyProbe> {
  if (db === null) {
    return { status: 'not_configured', detail: '当前数据模式不使用 Postgres（demo/test）' };
  }
  await withTimeout(db.execute(sql`select 1`));
  return { status: 'ok' };
}

/**
 * Redis 探活。
 *
 * `kind` 先决定语义，再决定要不要真的发命令：
 *  - `noop`（demo/test 未配置）→ 未配置；
 *  - `unavailable`（live 未配置）→ 报错，但只降级不摘流量；
 *  - `redis` → `PING` 真实往返。
 */
export async function probeRedis(adapter: RedisAdapter): Promise<DependencyProbe> {
  if (adapter.kind === 'noop') {
    return { status: 'not_configured', detail: 'REDIS_URL 未配置（demo/test 使用显式 no-op）' };
  }
  if (adapter.kind === 'unavailable') {
    return { status: 'error', detail: 'REDIS_URL 未配置：live 模式下 Redis 能力会 fail-fast' };
  }
  const pong = await withTimeout(adapter.ping());
  return pong === 'PONG' ? { status: 'ok' } : { status: 'ok', detail: `PING 返回 ${pong}` };
}
