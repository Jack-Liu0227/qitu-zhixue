import { and, eq, gte, inArray, or } from 'drizzle-orm';
import {
  projectEvidence as projectEvidenceTable,
  tutorSessions as tutorSessionsTable,
  tutorTurns as tutorTurnsTable,
  withTransaction,
  type Database,
} from '@qitu/database';
import {
  ProjectEvidenceSource,
  ProjectEvidenceStore,
  type ProjectEvidenceFact,
  type ProjectEvidenceRecord,
} from './project-evidence.store';

type ProjectEvidenceRow = typeof projectEvidenceTable.$inferSelect;

/**
 * `project_evidence` 的 live 实现。写入靠
 * `(project_id, column_kind, source_kind, source_id)` 唯一索引 + `ON CONFLICT DO
 * NOTHING` 保证幂等；读取只返回脱敏字段。
 */
export class PostgresProjectEvidenceStore extends ProjectEvidenceStore {
  constructor(private readonly db: Database) {
    super();
  }

  async upsertFacts(facts: readonly ProjectEvidenceFact[]): Promise<number> {
    if (facts.length === 0) return 0;
    return withTransaction(this.db, async (tx) => {
      let inserted = 0;
      for (const fact of facts) {
        const rows = await tx
          .insert(projectEvidenceTable)
          .values({
            id: `pev-${fact.projectId}-${fact.columnKind}-${fact.sourceKind}-${fact.sourceId}`,
            schoolId: fact.schoolId,
            projectId: fact.projectId,
            studentUserId: fact.studentUserId,
            artifactId: fact.artifactId,
            columnKind: fact.columnKind,
            sourceKind: fact.sourceKind,
            sourceId: fact.sourceId,
            label: fact.label,
            detail: fact.detail,
            occurredAt: fact.occurredAt,
          })
          .onConflictDoNothing({
            target: [
              projectEvidenceTable.projectId,
              projectEvidenceTable.columnKind,
              projectEvidenceTable.sourceKind,
              projectEvidenceTable.sourceId,
            ],
          })
          .returning({ id: projectEvidenceTable.id });
        inserted += rows.length;
      }
      return inserted;
    });
  }

  async listByProject(projectId: string): Promise<ProjectEvidenceRecord[]> {
    const rows = await this.db
      .select()
      .from(projectEvidenceTable)
      .where(eq(projectEvidenceTable.projectId, projectId))
      .orderBy(projectEvidenceTable.occurredAt);
    return rows.map(mapEvidence);
  }
}

/**
 * 从 `tutor_turns` 派生 `ai_helped` 证据的**服务端**来源（只读其它模块的表）。
 *
 * 判定与设计 §5.4.3 一致：`hint_level >= 3`，或 pedagogic move 为
 * `scaffold` / `explain`。不读取、不落库任何原始对话内容，只保留 turn id 与
 * 一条中性标签。
 *
 * ⚠️ `independent`（TaskSubmission）与 `difficulty`（升级 / 错误分类）所需的
 * 事实表在本迁移批次尚不存在，故此处不臆造；由相应模块实现
 * `ProjectEvidenceSource` 后接入。缺表作为交接缺口记录。
 */
export class TutorTurnProjectEvidenceSource extends ProjectEvidenceSource {
  constructor(private readonly db: Database) {
    super();
  }

  async collect(projectId: string): Promise<ProjectEvidenceFact[]> {
    const rows = await this.db
      .select({
        turnId: tutorTurnsTable.id,
        studentId: tutorTurnsTable.studentId,
        createdAt: tutorTurnsTable.createdAt,
      })
      .from(tutorTurnsTable)
      .innerJoin(tutorSessionsTable, eq(tutorTurnsTable.sessionId, tutorSessionsTable.id))
      .where(
        and(
          eq(tutorSessionsTable.projectId, projectId),
          or(
            gte(tutorTurnsTable.hintLevel, 3),
            inArray(tutorTurnsTable.pedagogicMove, ['scaffold', 'explain']),
          ),
        ),
      );
    return rows.map((row) => ({
      projectId,
      studentUserId: row.studentId,
      schoolId: null,
      artifactId: null,
      columnKind: 'ai_helped' as const,
      sourceKind: 'tutor_turn' as const,
      sourceId: row.turnId,
      label: 'AI 搭档提供了引导（未直接给答案）',
      detail: null,
      occurredAt: row.createdAt,
    }));
  }
}

function mapEvidence(row: ProjectEvidenceRow): ProjectEvidenceRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    studentUserId: row.studentUserId,
    schoolId: row.schoolId,
    artifactId: row.artifactId,
    columnKind: row.columnKind as ProjectEvidenceRecord['columnKind'],
    sourceKind: row.sourceKind as ProjectEvidenceRecord['sourceKind'],
    sourceId: row.sourceId,
    label: row.label,
    detail: row.detail,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  };
}
