import { eq } from 'drizzle-orm';
import { growthRecords, projects, type Database } from '@qitu/database';
import type { ProjectStage, StudentGrowthEntryType } from '@qitu/contracts';
import {
  GrowthRecordStore,
  type GrowthAppendResult,
} from './growth.persistence';
import {
  cloneGrowthStoredRecord,
  isStudentFacingGrowthType,
  normaliseGrowthSource,
  normaliseGrowthVisibility,
  normaliseIdempotencyKey,
  type GrowthStoredRecord,
} from './growth.record';
import { normaliseEvidenceIds } from './growth.evidence';

type GrowthRecordRow = typeof growthRecords.$inferSelect;
type GrowthRecordInsert = typeof growthRecords.$inferInsert;

/**
 * 成长档案的 live 持久化实现（`growth_records`，迁移 0008）。
 *
 * - **只追加**：只有 `insert ... onConflictDoNothing(idempotency_key)`，没有 update /
 *   delete；历史不可改写。
 * - **幂等**：唯一索引 `growth_records_idempotency_unique_idx` 由数据库保证；
 *   同键重试 `.returning()` 为空，回读既有行并返回 `replayed=true`。
 * - **作用域**：`listByStudent` 用参数化的 `student_user_id = $1`；`listAll` 仅用于
 *   启动水合，返回内容只进入服务端内存快照。
 * - **证据白名单再校验**：读回时对 `evidence_refs` 再次跑 `normaliseEvidenceIds`，
 *   即使库中出现历史脏数据也不会把未知来源投影出去。
 * - **`encouragement` 不在规范表**：该字段是进程内即时鼓励语，规范表未建列，
 *   读回时为 `null`（见 `growth-persistence.md` 的已知缺口 / cutover 说明）。
 */
export class PostgresGrowthRecordStore extends GrowthRecordStore {
  readonly persistent = true;

  constructor(private readonly db: Database) {
    super();
  }

  async append(record: GrowthStoredRecord): Promise<GrowthAppendResult> {
    const inserted = await this.db
      .insert(growthRecords)
      .values(toGrowthRecordInsert(record))
      .onConflictDoNothing({ target: growthRecords.idempotencyKey })
      .returning({ id: growthRecords.id });

    if (inserted.length > 0) {
      return { record: cloneGrowthStoredRecord(record), replayed: false };
    }

    const existing = await this.findByIdempotencyKey(record.idempotencyKey);
    if (existing === null) {
      throw new Error(`成长记录写入后无法回读：${record.idempotencyKey}`);
    }
    return { record: existing, replayed: true };
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<GrowthStoredRecord | null> {
    const normalized = normaliseIdempotencyKey(idempotencyKey);
    if (normalized === null) return null;
    const rows = await this.db
      .select({ record: growthRecords, projectTitle: projects.title })
      .from(growthRecords)
      .leftJoin(projects, eq(growthRecords.projectId, projects.id))
      .where(eq(growthRecords.idempotencyKey, normalized))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toGrowthStoredRecord(row.record, row.projectTitle);
  }

  async listByStudent(studentId: string): Promise<GrowthStoredRecord[]> {
    const rows = await this.db
      .select({ record: growthRecords, projectTitle: projects.title })
      .from(growthRecords)
      .leftJoin(projects, eq(growthRecords.projectId, projects.id))
      .where(eq(growthRecords.studentUserId, studentId));
    return toStudentFacingRecords(rows);
  }

  /** 仅启动水合使用；不得直接进入请求路径的投影。 */
  async listAll(): Promise<GrowthStoredRecord[]> {
    const rows = await this.db
      .select({ record: growthRecords, projectTitle: projects.title })
      .from(growthRecords)
      .leftJoin(projects, eq(growthRecords.projectId, projects.id));
    return toStudentFacingRecords(rows);
  }
}

interface GrowthJoinedRow {
  record: GrowthRecordRow;
  projectTitle: string | null;
}

function toStudentFacingRecords(rows: readonly GrowthJoinedRow[]): GrowthStoredRecord[] {
  return rows
    .filter((row) => isStudentFacingGrowthType(row.record.type))
    .map((row) => toGrowthStoredRecord(row.record, row.projectTitle));
}

/**
 * 行 → 领域记录（纯函数，便于无数据库单测）。
 *
 * `type` 必须是开放集合的合法成员；调用方（`toStudentFacingRecords`）已先行过滤。
 * 这里仍做一次断言，保证即使传入其它类型也不会错误地当成学生可见类型。
 */
export function toGrowthStoredRecord(
  row: GrowthRecordRow,
  projectTitle: string | null,
): GrowthStoredRecord {
  return {
    id: row.id,
    schoolId: row.schoolId ?? null,
    studentId: row.studentUserId,
    projectId: row.projectId ?? null,
    projectTitle: projectTitle ?? null,
    type: row.type as StudentGrowthEntryType,
    occurredAt: row.occurredAt.toISOString(),
    title: row.title,
    summaryStudent: row.summaryStudent,
    summaryParent: row.summaryParent,
    stage: (row.stage ?? null) as ProjectStage | null,
    artifactRef: row.artifactRef ?? null,
    objectiveTitles: [...(row.objectiveTitles ?? [])],
    evidenceIds: normaliseEvidenceIds(row.evidenceRefs),
    encouragement: null,
    source: normaliseGrowthSource(row.source),
    visibility: normaliseGrowthVisibility(row.visibility),
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 领域记录 → 插入行（纯函数，便于无数据库单测）。 */
export function toGrowthRecordInsert(record: GrowthStoredRecord): GrowthRecordInsert {
  return {
    id: record.id,
    schoolId: record.schoolId,
    studentUserId: record.studentId,
    projectId: record.projectId,
    type: record.type,
    occurredAt: new Date(record.occurredAt),
    title: record.title,
    summaryStudent: record.summaryStudent,
    summaryParent: record.summaryParent,
    stage: record.stage,
    artifactRef: record.artifactRef,
    objectiveTitles: record.objectiveTitles,
    evidenceRefs: record.evidenceIds,
    source: record.source,
    visibility: record.visibility,
    idempotencyKey: record.idempotencyKey,
    createdAt: new Date(record.createdAt),
  };
}
