import {
  cloneGrowthStoredRecord,
  type GrowthStoredRecord,
} from './growth.record';

/** Nest DI 令牌：`GrowthService` 只依赖此端口，不依赖具体 Postgres 实现。 */
export const GROWTH_RECORD_STORE = Symbol('GROWTH_RECORD_STORE');

/**
 * 成长档案持久化边界（迁移 0008 `growth_records`）。
 *
 * 服务层只依赖本抽象；`demo` / `test` 用内存实现，`live` 用 PostgreSQL 实现
 * （见 `growth.persistence.postgres.ts`）。这样「只追加 + 幂等 + 证据白名单 +
 * 投影」留在服务层，而存储引擎可替换、可测试。
 *
 * 硬约束：
 *  - **只追加**：接口有意不提供 update / delete；历史不可改写。
 *  - **幂等**：`idempotencyKey` 唯一，同键重试返回已存在记录（`replayed=true`），
 *    不再落第二条。
 *  - **对象级作用域**：`listByStudent(studentId)` 必须带学生参数，禁止无参全表读
 *    进入普通读路径（`listAll` 仅用于启动水合，见下）。
 */
export interface GrowthAppendResult {
  record: GrowthStoredRecord;
  /** true 表示命中已存在的幂等键，本次未新写。 */
  replayed: boolean;
}

export abstract class GrowthRecordStore {
  /** 是否连接了真正的持久化引擎。内存 fixture 实现为 `false`。 */
  abstract readonly persistent: boolean;

  /**
   * 仅 demo / test：同步灌入确定性演示 fixture。Postgres 实现继承此 no-op，
   * 因此正式环境永远不会写入演示数据。
   */
  seed(_records: readonly GrowthStoredRecord[]): void {
    // no-op：只有非持久化（内存）实现需要。
  }

  /** 只追加一条记录；同 `idempotencyKey` 已存在时返回既有记录并标记 `replayed`。 */
  abstract append(record: GrowthStoredRecord): Promise<GrowthAppendResult>;

  /** 按幂等键回读（重放确认 / 适配器测试）。 */
  abstract findByIdempotencyKey(idempotencyKey: string): Promise<GrowthStoredRecord | null>;

  /** 读取**单个**学生的记录。缺少学生参数无法调用，避免无作用域读。 */
  abstract listByStudent(studentId: string): Promise<GrowthStoredRecord[]>;

  /**
   * 启动水合：一次性载入只读快照，使既有同步读投影在重启后仍能读到库中真相。
   *
   * 这是唯一允许的「全量读」入口，只应在 `onModuleInit` 调用，且返回内容只进入
   * 服务端内存，不直接对外投影。多实例下其他实例的写入要等各自水合，收敛方案
   * 见 `growth-persistence.md` 的 dual-write / cutover 说明。
   */
  abstract listAll(): Promise<GrowthStoredRecord[]>;
}

/**
 * 内存实现：仅用于 `demo` / `test`。
 *
 * 它**不是** live 持久化；live 走 `PostgresGrowthRecordStore`，未配置数据库时应用
 * 启动即失败（fail fast），或在 `growth.module.ts` 工厂里显式抛错。
 */
export class InMemoryGrowthRecordStore extends GrowthRecordStore {
  readonly persistent = false;

  private readonly byKey = new Map<string, GrowthStoredRecord>();
  private readonly byId = new Map<string, GrowthStoredRecord>();

  override seed(records: readonly GrowthStoredRecord[]): void {
    for (const record of records) {
      if (this.byKey.has(record.idempotencyKey)) continue;
      const stored = cloneGrowthStoredRecord(record);
      this.byKey.set(stored.idempotencyKey, stored);
      this.byId.set(stored.id, stored);
    }
  }

  async append(record: GrowthStoredRecord): Promise<GrowthAppendResult> {
    const existing = this.byKey.get(record.idempotencyKey);
    if (existing !== undefined) {
      return { record: cloneGrowthStoredRecord(existing), replayed: true };
    }
    const stored = cloneGrowthStoredRecord(record);
    this.byKey.set(stored.idempotencyKey, stored);
    this.byId.set(stored.id, stored);
    return { record: cloneGrowthStoredRecord(stored), replayed: false };
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<GrowthStoredRecord | null> {
    const record = this.byKey.get(idempotencyKey);
    return record === undefined ? null : cloneGrowthStoredRecord(record);
  }

  async listByStudent(studentId: string): Promise<GrowthStoredRecord[]> {
    return [...this.byId.values()]
      .filter((record) => record.studentId === studentId)
      .map(cloneGrowthStoredRecord);
  }

  async listAll(): Promise<GrowthStoredRecord[]> {
    return [...this.byId.values()].map(cloneGrowthStoredRecord);
  }
}
