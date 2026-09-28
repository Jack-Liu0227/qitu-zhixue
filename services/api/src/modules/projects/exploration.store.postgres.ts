import { and, eq } from 'drizzle-orm';
import {
  explorationSessions,
  intentConfirmations,
  projects as projectsTable,
  withTransaction,
  type Database,
} from '@qitu/database';
import type { ExplorationStatus, ProjectStage } from '@qitu/contracts';
import {
  ExplorationStore,
  ExplorationStoreConflictError,
  type CreateExplorationInput,
  type ExplorationRecord,
  type IntentDraftPatch,
  type PersistConfirmationInput,
  type ProjectRecord,
} from './exploration.store';

const PG_UNIQUE_VIOLATION = '23505';

type ExplorationRow = typeof explorationSessions.$inferSelect;
type IntentRow = typeof intentConfirmations.$inferSelect;
type ProjectRow = typeof projectsTable.$inferSelect;

/**
 * live 持久化实现。使用 `packages/database` 中已迁移的
 * `exploration_sessions` / `intent_confirmations` / `projects` 三张表。
 *
 * 所有写操作走事务；`persistConfirmation` 依赖 `projects.source_exploration_id`
 * 上的唯一索引兜底「同一探索只能创建一个项目实例」，即使同一幂等键的并发
 * 请求同时越过应用层预检，也只会落一条。
 */
export class PostgresExplorationStore extends ExplorationStore {
  constructor(private readonly db: Database) {
    super();
  }

  async createExploration(input: CreateExplorationInput): Promise<ExplorationRecord> {
    return withTransaction(this.db, async (tx) => {
      const insertedExploration = await tx
        .insert(explorationSessions)
        .values({
          id: input.id,
          studentUserId: input.studentId,
          source: input.source,
          templateVersionId: input.templateVersionId,
          status: 'exploring',
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      const insertedDraft = await tx
        .insert(intentConfirmations)
        .values({
          id: input.intentDraftId,
          explorationId: input.id,
          coreInterests: [],
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      const exploration = insertedExploration[0];
      const draft = insertedDraft[0];
      if (exploration === undefined || draft === undefined) {
        throw new Error('插入探索会话未返回数据行');
      }
      return assemble(exploration, draft);
    });
  }

  async findExploration(id: string): Promise<ExplorationRecord | null> {
    const [exploration] = await this.db
      .select()
      .from(explorationSessions)
      .where(eq(explorationSessions.id, id))
      .limit(1);
    if (exploration === undefined) return null;
    const [draft] = await this.db
      .select()
      .from(intentConfirmations)
      .where(eq(intentConfirmations.explorationId, id))
      .limit(1);
    if (draft === undefined) {
      throw new Error(`探索 ${id} 缺少意图草稿行（数据不一致）`);
    }
    return assemble(exploration, draft);
  }

  async updateIntentDraft(
    id: string,
    patch: IntentDraftPatch,
    status: ExplorationStatus,
    now: Date,
  ): Promise<ExplorationRecord> {
    return withTransaction(this.db, async (tx) => {
      const set: Partial<typeof intentConfirmations.$inferInsert> = { updatedAt: now };
      if (patch.goalUser !== undefined) set.goalUser = patch.goalUser;
      if (patch.coreInterests !== undefined) set.coreInterests = [...patch.coreInterests];
      if (patch.preferredForm !== undefined) set.preferredForm = patch.preferredForm;
      if (patch.targetBeneficiary !== undefined) set.targetBeneficiary = patch.targetBeneficiary;
      await tx
        .update(intentConfirmations)
        .set(set)
        .where(eq(intentConfirmations.explorationId, id));

      const [exploration] = await tx
        .update(explorationSessions)
        .set({ status, updatedAt: now })
        .where(eq(explorationSessions.id, id))
        .returning();
      if (exploration === undefined) throw new Error(`exploration not found: ${id}`);
      const [draft] = await tx
        .select()
        .from(intentConfirmations)
        .where(eq(intentConfirmations.explorationId, id))
        .limit(1);
      if (draft === undefined) throw new Error(`探索 ${id} 缺少意图草稿行（数据不一致）`);
      return assemble(exploration, draft);
    });
  }

  async persistConfirmation(input: PersistConfirmationInput): Promise<ProjectRecord> {
    try {
      return await withTransaction(this.db, async (tx) => {
        await tx
          .update(intentConfirmations)
          .set({
            goalUser: input.confirmedDraft.goalUser,
            coreInterests: [...input.confirmedDraft.coreInterests],
            preferredForm: input.confirmedDraft.preferredForm,
            targetBeneficiary: input.confirmedDraft.targetBeneficiary,
            confirmedAt: input.confirmedAt,
            updatedAt: input.confirmedAt,
          })
          .where(eq(intentConfirmations.explorationId, input.explorationId));

        await tx
          .update(explorationSessions)
          .set({ status: 'confirmed', updatedAt: input.confirmedAt })
          .where(eq(explorationSessions.id, input.explorationId));

        const insertedProject = await tx
          .insert(projectsTable)
          .values({
            id: input.project.id,
            studentUserId: input.project.studentId,
            templateVersionId: input.project.templateVersionId,
            sourceExplorationId: input.explorationId,
            status: input.project.status,
            currentStageIndex: input.project.currentStageIndex,
            stageTotal: input.project.stageTotal,
            progressPercent: input.project.progressPercent,
            title: input.project.title,
            subtitle: input.project.subtitle,
            tags: [...input.project.tags],
            createdAt: input.confirmedAt,
          })
          .returning();
        const project = insertedProject[0];
        if (project === undefined) throw new Error('插入项目实例未返回数据行');
        return mapProject(project);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ExplorationStoreConflictError(
          `project already exists for exploration: ${input.explorationId}`,
        );
      }
      throw error;
    }
  }

  async findProjectByExploration(explorationId: string): Promise<ProjectRecord | null> {
    const [project] = await this.db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.sourceExplorationId, explorationId))
      .limit(1);
    return project === undefined ? null : mapProject(project);
  }

  async closeExploration(id: string, now: Date): Promise<ExplorationRecord> {
    return withTransaction(this.db, async (tx) => {
      const [exploration] = await tx
        .update(explorationSessions)
        .set({ status: 'closed', updatedAt: now, closedAt: now })
        .where(and(eq(explorationSessions.id, id)))
        .returning();
      if (exploration === undefined) throw new Error(`exploration not found: ${id}`);
      const [draft] = await tx
        .select()
        .from(intentConfirmations)
        .where(eq(intentConfirmations.explorationId, id))
        .limit(1);
      if (draft === undefined) throw new Error(`探索 ${id} 缺少意图草稿行（数据不一致）`);
      return assemble(exploration, draft);
    });
  }
}

function assemble(exploration: ExplorationRow, draft: IntentRow): ExplorationRecord {
  return {
    id: exploration.id,
    studentId: exploration.studentUserId,
    source: exploration.source as ExplorationRecord['source'],
    templateVersionId: exploration.templateVersionId,
    status: exploration.status as ExplorationStatus,
    intentDraft: {
      id: draft.id,
      explorationId: draft.explorationId,
      goalUser: draft.goalUser,
      coreInterests: draft.coreInterests ?? [],
      preferredForm: draft.preferredForm,
      targetBeneficiary: draft.targetBeneficiary,
      confirmedAt: draft.confirmedAt,
      updatedAt: draft.updatedAt,
    },
    createdAt: exploration.createdAt,
    updatedAt: exploration.updatedAt,
    closedAt: exploration.closedAt,
  };
}

function mapProject(project: ProjectRow): ProjectRecord {
  return {
    id: project.id,
    studentId: project.studentUserId,
    templateVersionId: project.templateVersionId,
    sourceExplorationId: project.sourceExplorationId ?? '',
    status: project.status as ProjectStage,
    currentStageIndex: project.currentStageIndex,
    stageTotal: project.stageTotal,
    progressPercent: project.progressPercent,
    title: project.title,
    subtitle: project.subtitle,
    tags: project.tags ?? [],
    createdAt: project.createdAt,
    completedAt: project.completedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === PG_UNIQUE_VIOLATION;
}
