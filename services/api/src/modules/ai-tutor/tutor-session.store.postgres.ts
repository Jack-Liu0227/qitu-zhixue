import { and, asc, eq } from 'drizzle-orm';
import {
  tutorSessions,
  tutorTurns,
  withTransaction,
  type Database,
} from '@qitu/database';
import type {
  PedagogicMove,
  ProjectStage,
  TutorHintLevel,
  TutorOutputModality,
  TutorReplyBlock,
  TutorSessionSource,
  TutorTurnModality,
} from '@qitu/contracts';
import {
  TutorSessionConflictError,
  TutorSessionStore,
  type AppendTurnsInput,
  type CreateTutorSessionInput,
  type TutorSessionSnapshot,
  type TutorTurnRecord,
} from './tutor-session.store';

/**
 * `tutor_turns.content` 的 JSON 信封。
 *
 * `tutor_turns` 只有 `pedagogic_move` / `hint_level` 两个服务端专用列，而
 * 9.4 要求每轮记录 `stage_before` / `stage_after` / `expected_evidence` /
 * `prompt_version` / `evidence_ref`。由于本任务不得改动 `packages/database`，
 * 这些「最小必要元数据」编码进 `content` 列，**不落任何未成年人原始对话
 * 之外的额外敏感字段**（对话本身只在 `blocks` 里，是合同要求的最小投影）。
 *
 * 读回时对缺失 / 旧格式保持宽容，未知值一律回退 `null`，绝不猜测。
 */
interface TurnContentEnvelope {
  v: 1;
  stageBefore: ProjectStage | null;
  stageAfter: ProjectStage | null;
  expectedEvidence: string | null;
  promptVersion: string | null;
  evidenceRef: string | null;
  modality: TutorTurnModality;
  outputModality?: TutorOutputModality;
}

type TutorSessionRow = typeof tutorSessions.$inferSelect;
type TutorTurnRow = typeof tutorTurns.$inferSelect;
type TutorTurnInsert = typeof tutorTurns.$inferInsert;

/**
 * live（PostgreSQL）实现。使用已迁移的 `tutor_sessions` / `tutor_turns`。
 *
 * 写入策略：
 * - `appendTurns` 在一个事务里以 `last_seq = expected` 的条件 `UPDATE` 认领序号，
 *   再用 `(session_id, seq)` 唯一索引兜底去重；并发回合只有一个成功；
 * - 会话与回合的 `student_id` 都写归属学生，读回时由服务层做对象级授权；
 * - 不写 `tutor_growth_signals`（那是 Tutor SDK 的职责，本 store 不越过边界）。
 */
export class PostgresTutorSessionStore extends TutorSessionStore {
  readonly durable = true;

  constructor(private readonly db: Database) {
    super();
  }

  async findByProject(projectId: string): Promise<TutorSessionSnapshot | null> {
    const [session] = await this.db
      .select()
      .from(tutorSessions)
      .where(eq(tutorSessions.projectId, projectId))
      .orderBy(asc(tutorSessions.createdAt))
      .limit(1);
    if (session === undefined) return null;
    return this.assemble(session);
  }

  async findById(sessionId: string): Promise<TutorSessionSnapshot | null> {
    const [session] = await this.db
      .select()
      .from(tutorSessions)
      .where(eq(tutorSessions.id, sessionId))
      .limit(1);
    if (session === undefined) return null;
    return this.assemble(session);
  }

  async create(input: CreateTutorSessionInput): Promise<void> {
    await this.db
      .insert(tutorSessions)
      .values({
        id: input.sessionId,
        studentId: input.ownerId,
        partnerId: input.partnerId,
        projectId: input.projectId,
        explorationId: input.explorationId ?? null,
        source: input.source,
        lastSeq: 0,
        createdAt: new Date(input.createdAt),
        updatedAt: new Date(input.createdAt),
      })
      // 同一会话 id 的并发创建只保留一行；序号从 0 开始，回合由 appendTurns 推进。
      .onConflictDoNothing({ target: tutorSessions.id });
  }

  async appendTurns(input: AppendTurnsInput): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const claimed = await tx
        .update(tutorSessions)
        .set({ lastSeq: input.newLastSeq, updatedAt: new Date() })
        .where(
          and(
            eq(tutorSessions.id, input.sessionId),
            eq(tutorSessions.lastSeq, input.expectedLastSeq),
          ),
        )
        .returning({ id: tutorSessions.id });
      if (claimed.length === 0) {
        throw new TutorSessionConflictError(
          `会话 ${input.sessionId} 的序号已变化（期望 ${input.expectedLastSeq}）`,
        );
      }

      const [session] = await tx
        .select({ studentId: tutorSessions.studentId })
        .from(tutorSessions)
        .where(eq(tutorSessions.id, input.sessionId))
        .limit(1);
      if (session === undefined) {
        throw new TutorSessionConflictError(`会话不存在：${input.sessionId}`);
      }

      for (const turn of input.turns) {
        await tx
          .insert(tutorTurns)
          .values(toRow(turn, input.sessionId, session.studentId))
          // 唯一索引 `(session_id, seq)` 兜底：已存在的序号不重复写入。
          .onConflictDoNothing({ target: [tutorTurns.sessionId, tutorTurns.seq] });
      }
    });
  }

  private async assemble(session: TutorSessionRow): Promise<TutorSessionSnapshot> {
    const rows = await this.db
      .select()
      .from(tutorTurns)
      .where(eq(tutorTurns.sessionId, session.id))
      .orderBy(asc(tutorTurns.seq));
    return {
      sessionId: session.id,
      ownerId: session.studentId,
      projectId: session.projectId,
      explorationId: session.explorationId ?? null,
      source: session.source as TutorSessionSource,
      createdAt: session.createdAt.toISOString(),
      lastSeq: session.lastSeq,
      turns: rows.map(fromRow),
    };
  }
}

function toRow(
  turn: TutorTurnRecord,
  sessionId: string,
  studentId: string,
): TutorTurnInsert {
  const envelope: TurnContentEnvelope = {
    v: 1,
    stageBefore: turn.stageBefore,
    stageAfter: turn.stageAfter,
    expectedEvidence: turn.expectedEvidence,
    promptVersion: turn.promptVersion,
    evidenceRef: turn.evidenceRef,
    modality: turn.modality,
    ...(turn.outputModality !== undefined ? { outputModality: turn.outputModality } : {}),
  };
  return {
    id: turn.turnId,
    sessionId,
    studentId,
    role: turn.role,
    content: JSON.stringify(envelope),
    blocks: turn.blocks,
    seq: turn.seq,
    hintLevel: turn.hintLevel,
    pedagogicMove: turn.pedagogicMove,
    createdAt: new Date(turn.createdAt),
  };
}

function fromRow(row: TutorTurnRow): TutorTurnRecord {
  const envelope = decodeContent(row.content);
  return {
    turnId: row.id,
    role: row.role as TutorTurnRecord['role'],
    blocks: (row.blocks ?? []) as TutorReplyBlock[],
    hintLevel: (row.hintLevel ?? null) as TutorHintLevel | null,
    stageBefore: envelope.stageBefore,
    stageAfter: envelope.stageAfter,
    seq: row.seq,
    createdAt: row.createdAt.toISOString(),
    modality: envelope.modality,
    ...(envelope.outputModality !== undefined
      ? { outputModality: envelope.outputModality }
      : {}),
    pedagogicMove: (row.pedagogicMove ?? null) as PedagogicMove | null,
    expectedEvidence: envelope.expectedEvidence,
    promptVersion: envelope.promptVersion,
    evidenceRef: envelope.evidenceRef,
  };
}

function decodeContent(content: string | null): TurnContentEnvelope {
  const fallback: TurnContentEnvelope = {
    v: 1,
    stageBefore: null,
    stageAfter: null,
    expectedEvidence: null,
    promptVersion: null,
    evidenceRef: null,
    modality: 'text',
  };
  if (content === null || content.length === 0) return fallback;
  try {
    const parsed = JSON.parse(content) as Partial<TurnContentEnvelope>;
    return {
      ...fallback,
      ...parsed,
      v: 1,
    };
  } catch {
    // 旧数据 / 非 JSON：只保留契约能表达的块，服务端字段回退 null。
    return fallback;
  }
}
