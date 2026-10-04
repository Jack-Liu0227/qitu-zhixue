import type {
  PedagogicMove,
  ProjectStage,
  TutorHintLevel,
  TutorOutputModality,
  TutorReplyBlock,
  TutorSessionSource,
  TutorTurn,
  TutorTurnModality,
} from '@qitu/contracts';

/**
 * AI 搭档会话 / 回合的**服务端权威**持久化边界。
 *
 * 服务层只依赖本抽象：
 * - `demo` / `test`（无数据库）→ {@link InMemoryTutorSessionStore}，行为与
 *   旧的内存 `Map` 完全一致；
 * - `live`（有 `DATABASE_URL`）→ `PostgresTutorSessionStore`，写 `tutor_sessions`
 *   / `tutor_turns` 两张公开表。
 *
 * **一切服务端字段都在这条边界上被固化**：`pedagogic_move`、`hint_level`、
 * `stage_before`、`stage_after`、`expected_evidence`、`prompt_version`、
 * `evidence_ref`。客户端只能读回投影，永远不能写入这些字段。
 *
 * `tutor_turns` 表只有 `pedagogic_move` / `hint_level` 两个专用列，其余服务端
 * 字段属于「最小必要元数据」，统一编码进 `content` 列的 JSON 信封（见
 * `tutor-session.store.postgres.ts`），不新增迁移、不改动 `packages/database`。
 */

/**
 * 一条服务端权威回合。
 *
 * 它是共享契约 {@link TutorTurn} 的超集：契约字段用于响应投影，附加字段
 * （`pedagogicMove` / `expectedEvidence` / `promptVersion` / `evidenceRef`）
 * 只用于持久化与审计，回应前会被剥离（见 `TutorService.toSessionResponse`）。
 */
export interface TutorTurnRecord extends TutorTurn {
  /** 服务端判定的教学动作；学生回合由入口决定，助手回合由链路回填。 */
  pedagogicMove: PedagogicMove | null;
  /** 本轮期望学生给出的证据（来自当前任务，服务端注入）。 */
  expectedEvidence: string | null;
  /** 产生本轮回复的提示词版本。 */
  promptVersion: string | null;
  /** 本轮对应的证据引用，便于掌握度与审计回溯。 */
  evidenceRef: string | null;
}

/** 一次会话的完整快照（会话元数据 + 全部回合）。 */
export interface TutorSessionSnapshot {
  sessionId: string;
  /** 归属学生 user id；对象级授权的唯一真相。 */
  ownerId: string;
  projectId: string | null;
  explorationId?: string | null;
  source: TutorSessionSource;
  createdAt: string;
  /** 服务端分配的最后序号；重连游标与去重的基准。 */
  lastSeq: number;
  turns: TutorTurnRecord[];
}

export interface CreateTutorSessionInput {
  sessionId: string;
  ownerId: string;
  /** `tutor_sessions.partner_id` 外键目标；由 SDK 的搭档档案提供。 */
  partnerId: string;
  projectId: string | null;
  explorationId?: string | null;
  source: TutorSessionSource;
  createdAt: string;
}

export interface AppendTurnsInput {
  sessionId: string;
  /** 乐观并发：只有会话仍停在 `expectedLastSeq` 时才提交。 */
  expectedLastSeq: number;
  newLastSeq: number;
  turns: readonly TutorTurnRecord[];
}

/**
 * 会话序号在提交时已变化（并发回合）。
 *
 * 服务层可在重新读取会话后重试；内存实现写入前自检，PostgreSQL 实现用
 * 条件 `UPDATE ... WHERE last_seq = expected` 兜底。
 */
export class TutorSessionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TutorSessionConflictError';
  }
}

export abstract class TutorSessionStore {
  /**
   * 是否为真实持久化实现。
   *
   * 服务层据此决定是否启用**跨进程**幂等（`IdempotencyStore`）与持久化审计：
   * demo/test 的内存实现返回 `false`，绝不假装持久化。
   */
  abstract readonly durable: boolean;

  /** 取（唯一）绑定到某个项目的会话。一个学生的一个项目只有一个持续会话。 */
  abstract findByProject(projectId: string): Promise<TutorSessionSnapshot | null>;

  abstract findById(sessionId: string): Promise<TutorSessionSnapshot | null>;

  abstract create(input: CreateTutorSessionInput): Promise<void>;

  /** 追加一个回合并原子推进 `last_seq`。 */
  abstract appendTurns(input: AppendTurnsInput): Promise<void>;
}

function cloneTurn(turn: TutorTurnRecord): TutorTurnRecord {
  return {
    ...turn,
    blocks: turn.blocks.map((block) => ({ ...block })),
  };
}

function cloneSnapshot(snapshot: TutorSessionSnapshot): TutorSessionSnapshot {
  return {
    ...snapshot,
    turns: snapshot.turns.map(cloneTurn),
  };
}

/**
 * 内存实现：仅用于 `demo` / `test`（无数据库）。
 *
 * 与旧实现的区别只有一处：回合通过同一个 `TutorSessionStore` 接口出入，
 * 因此服务层的「读回—续写」逻辑与 live 完全共用，测试可以据此模拟重启。
 */
export class InMemoryTutorSessionStore extends TutorSessionStore {
  readonly durable: boolean = false;
  private readonly sessions = new Map<string, TutorSessionSnapshot>();

  async findByProject(projectId: string): Promise<TutorSessionSnapshot | null> {
    for (const snapshot of this.sessions.values()) {
      if (snapshot.projectId === projectId) return cloneSnapshot(snapshot);
    }
    return null;
  }

  async findById(sessionId: string): Promise<TutorSessionSnapshot | null> {
    const snapshot = this.sessions.get(sessionId);
    return snapshot === undefined ? null : cloneSnapshot(snapshot);
  }

  async create(input: CreateTutorSessionInput): Promise<void> {
    if (this.sessions.has(input.sessionId)) return;
    this.sessions.set(input.sessionId, {
      sessionId: input.sessionId,
      ownerId: input.ownerId,
      projectId: input.projectId,
      source: input.source,
      createdAt: input.createdAt,
      lastSeq: 0,
      turns: [],
    });
  }

  async appendTurns(input: AppendTurnsInput): Promise<void> {
    const snapshot = this.sessions.get(input.sessionId);
    if (snapshot === undefined) {
      throw new TutorSessionConflictError(`会话不存在：${input.sessionId}`);
    }
    if (snapshot.lastSeq !== input.expectedLastSeq) {
      throw new TutorSessionConflictError(
        `会话 ${input.sessionId} 的序号已变化（期望 ${input.expectedLastSeq}，实际 ${snapshot.lastSeq}）`,
      );
    }
    for (const turn of input.turns) {
      // 与 Postgres 唯一索引 `(session_id, seq)` 语义一致：重复序号不重复写入。
      if (snapshot.turns.some((existing) => existing.seq === turn.seq)) continue;
      snapshot.turns.push(cloneTurn(turn));
    }
    snapshot.lastSeq = input.newLastSeq;
  }
}
