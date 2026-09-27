import { Global, Inject, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createDb, withTransaction, type Database } from '@qitu/database';

export const DATABASE_TOKEN = Symbol('DATABASE');
export const DATABASE_TRANSACTION_TOKEN = Symbol('DATABASE_TRANSACTION');
export const DATA_MODE_TOKEN = Symbol('QITU_DATA_MODE');

/**
 * 数据模式（环境变量 `QITU_DATA_MODE`）。
 *
 * - `live`：**正式默认**。必须有 `DATABASE_URL`，只允许 Postgres 引擎；
 *   缺失或 client 无法创建时启动失败，绝不静默退回内存。
 * - `demo`：显式演示。仅非 production 允许缺省 `DATABASE_URL` → 内存 Directory 引擎。
 * - `test`：显式测试/CI。同 `demo`，供测试显式注入或无 DB，**不得**作为普通 dev 默认。
 */
export type DataMode = 'live' | 'demo' | 'test';

const DATA_MODES: readonly DataMode[] = ['live', 'demo', 'test'];

/** 未设置 `QITU_DATA_MODE` 时的默认模式：`live`。 */
export const DEFAULT_DATA_MODE: DataMode = 'live';

/**
 * 数据模式配置错误。
 *
 * 在 Nest 依赖注入阶段抛出，使应用**启动失败**（fail-fast），
 * 而不是带着降级状态继续服务。
 */
export class DataModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataModeError';
  }
}

/**
 * 纯函数：解析并校验 `QITU_DATA_MODE`。
 *
 * 不读取 `process.env`，便于单测在任意环境直接调用。
 * - 未设置 / 空串 → `live`（默认，不允许内存引擎）
 * - 非 `live | demo | test` → 抛 `DataModeError`
 * - production + `demo | test` → 抛 `DataModeError`（内存引擎不得进 production）
 */
export function resolveDataMode(
  rawMode: string | undefined,
  nodeEnv: string | undefined,
): DataMode {
  const normalized = (rawMode ?? '').trim().toLowerCase();
  if (normalized === '') {
    return DEFAULT_DATA_MODE;
  }
  if (!(DATA_MODES as readonly string[]).includes(normalized)) {
    throw new DataModeError(
      `非法 QITU_DATA_MODE="${rawMode}"；允许值 live | demo | test。` +
        ` Invalid QITU_DATA_MODE="${rawMode}"; expected live | demo | test.`,
    );
  }
  const mode = normalized as DataMode;
  const isProduction = (nodeEnv ?? '').trim().toLowerCase() === 'production';
  if (isProduction && mode !== 'live') {
    throw new DataModeError(
      `production 环境禁止 QITU_DATA_MODE=${mode}：内存 Directory 引擎仅允许在非 production 的 demo/test 下使用。` +
        ` Refusing QITU_DATA_MODE=${mode} in production: the in-memory Directory engine is only allowed for demo/test outside production.`,
    );
  }
  return mode;
}

/**
 * 纯函数：把「模式 + DATABASE_URL」解析成 `DATABASE_TOKEN` 的绑定值。
 *
 * - `live`：必须提供 `DATABASE_URL`，否则抛 `DataModeError`（fail-fast，绝不退回内存）。
 * - `demo` / `test`：允许缺省 `DATABASE_URL` → 返回 `null`（DirectoryService 走内存引擎）；
 *   提供时照常构造 Postgres client。
 *
 * 不捕获 `createDb()` 的异常：live 下 client 无法配置属于致命错误，必须 fail-fast。
 */
export function resolveDatabaseBinding(
  mode: DataMode,
  databaseUrl: string | undefined,
): Database | null {
  const url = (databaseUrl ?? '').trim();
  if (mode === 'live' && url === '') {
    throw new DataModeError(
      'live 数据模式要求设置 DATABASE_URL；缺失则拒绝启动，绝不静默退回内存引擎。' +
        ' live data mode requires DATABASE_URL; refusing to boot rather than silently falling back to the in-memory engine.',
    );
  }
  if (url === '') {
    return null;
  }
  return createDb(url);
}

/**
 * DatabaseModule：PostgreSQL 持久化层接线。
 *
 * 模式由 `QITU_DATA_MODE` 决定（默认 `live`）：
 * - `live`：必须配置 `DATABASE_URL`；缺失或 client 无法创建都 fail-fast。
 * - `demo` / `test`（非 production）：允许无 `DATABASE_URL`，此时 `DATABASE_TOKEN` 为 `null`，
 *   `DirectoryService` 走内存引擎。
 *
 * 只有显式 demo/test 才会出现「无持久化但服务继续」；live 不再打印
 * “服务正常但 persistence disabled” 并继续。
 *
 * 环境变量在 provider 工厂（依赖注入阶段）读取，不在模块 import 时读取，便于单测。
 */
@Global()
@Module({
  providers: [
    {
      provide: DATA_MODE_TOKEN,
      useFactory: (): DataMode => resolveDataMode(process.env.QITU_DATA_MODE, process.env.NODE_ENV),
    },
    {
      provide: DATABASE_TOKEN,
      useFactory: (mode: DataMode): Database | null =>
        resolveDatabaseBinding(mode, process.env.DATABASE_URL),
      inject: [DATA_MODE_TOKEN],
    },
    {
      provide: DATABASE_TRANSACTION_TOKEN,
      useValue: withTransaction,
    },
  ],
  exports: [DATA_MODE_TOKEN, DATABASE_TOKEN, DATABASE_TRANSACTION_TOKEN],
})
export class DatabaseModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(DATA_MODE_TOKEN) private readonly mode: DataMode,
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.db) {
      // 只有显式 demo/test（非 production）才能走到这里：live 缺 DATABASE_URL 已在
      // resolveDatabaseBinding 中 fail-fast，production + demo/test 已在 resolveDataMode 中拒绝。
      console.warn(
        `[DatabaseModule] QITU_DATA_MODE=${this.mode} 且未配置 DATABASE_URL：启用内存 Directory 引擎（仅限非 production 的本地/测试）。` +
          ` QITU_DATA_MODE=${this.mode} without DATABASE_URL — in-memory Directory engine is active (non-production only).`,
      );
      return;
    }
    console.log(`[DatabaseModule] Postgres client configured (QITU_DATA_MODE=${this.mode})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.db) {
      return;
    }
    // Release the underlying pg pool so watch-mode restarts do not leak connections.
    const pool = (this.db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
    if (typeof pool?.end === 'function') {
      await pool.end();
    }
  }
}
