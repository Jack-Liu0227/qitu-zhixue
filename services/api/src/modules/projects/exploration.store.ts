import type { ExplorationSource, ExplorationStatus, ProjectStage } from '@qitu/contracts';

/**
 * T6 探索 / 意图确认的持久化边界。
 *
 * 服务层只依赖这个抽象；`demo` / `test` 用内存实现，`live` 用 PostgreSQL 实现
 * （见 `exploration.store.postgres.ts`）。这样「未确认不得创建正式项目」的
 * 判定留在纯状态机里，而持久化引擎可替换、可测试。
 */

export interface IntentDraftRecord {
  id: string;
  explorationId: string;
  goalUser: string | null;
  coreInterests: string[];
  preferredForm: string | null;
  targetBeneficiary: string | null;
  confirmedAt: Date | null;
  updatedAt: Date;
}

export interface ExplorationRecord {
  id: string;
  studentId: string;
  source: ExplorationSource;
  templateVersionId: string | null;
  status: ExplorationStatus;
  intentDraft: IntentDraftRecord;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

export interface ProjectRecord {
  id: string;
  studentId: string;
  templateVersionId: string | null;
  sourceExplorationId: string;
  status: ProjectStage;
  currentStageIndex: number;
  stageTotal: number;
  progressPercent: number;
  title: string;
  subtitle: string | null;
  tags: string[];
  createdAt: Date;
  completedAt: Date | null;
}

export interface CreateExplorationInput {
  id: string;
  studentId: string;
  source: ExplorationSource;
  templateVersionId: string | null;
  intentDraftId: string;
  now: Date;
}

export interface IntentDraftPatch {
  goalUser?: string | null;
  coreInterests?: string[];
  preferredForm?: string | null;
  targetBeneficiary?: string | null;
}

export interface PersistConfirmationInput {
  explorationId: string;
  confirmedAt: Date;
  /** 确认时的最终草稿字段（服务端由状态机产出）。 */
  confirmedDraft: {
    goalUser: string | null;
    coreInterests: string[];
    preferredForm: string | null;
    targetBeneficiary: string | null;
  };
  /** 待创建的项目实例；`createdAt` / `completedAt` 由存储层补齐。 */
  project: Omit<ProjectRecord, 'createdAt' | 'completedAt' | 'sourceExplorationId'>;
}

/**
 * 同一探索已存在项目实例时抛出。
 *
 * 内存实现在写入前自检，PostgreSQL 实现捕获唯一索引冲突（23505）后抛出；
 * 服务层捕获它并转为幂等重放，而不是暴露 500。
 */
export class ExplorationStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExplorationStoreConflictError';
  }
}

export abstract class ExplorationStore {
  abstract createExploration(input: CreateExplorationInput): Promise<ExplorationRecord>;
  abstract findExploration(id: string): Promise<ExplorationRecord | null>;
  /**
   * 更新草稿并按需迁移状态。
   *
   * `status` 由服务端状态机决定后传入；存储层不自行推导，避免多一份判定逻辑。
   */
  abstract updateIntentDraft(
    id: string,
    patch: IntentDraftPatch,
    status: ExplorationStatus,
    now: Date,
  ): Promise<ExplorationRecord>;
  /**
   * 写确认凭据 + 状态迁移 + 创建项目实例。
   *
   * 三者必须原子完成；且同一 `explorationId` 只能落一条项目实例
   * （数据库用 `source_exploration_id` 唯一索引兜底）。
   */
  abstract persistConfirmation(input: PersistConfirmationInput): Promise<ProjectRecord>;
  abstract findProjectByExploration(explorationId: string): Promise<ProjectRecord | null>;
  abstract closeExploration(id: string, now: Date): Promise<ExplorationRecord>;
}

function emptyDraft(id: string, explorationId: string, now: Date): IntentDraftRecord {
  return {
    id,
    explorationId,
    goalUser: null,
    coreInterests: [],
    preferredForm: null,
    targetBeneficiary: null,
    confirmedAt: null,
    updatedAt: now,
  };
}

function cloneExploration(record: ExplorationRecord): ExplorationRecord {
  return {
    ...record,
    intentDraft: { ...record.intentDraft, coreInterests: [...record.intentDraft.coreInterests] },
  };
}

function cloneProject(record: ProjectRecord): ProjectRecord {
  return { ...record, tags: [...record.tags] };
}

/**
 * 内存实现：仅用于 `demo` / `test`。
 *
 * 与 `FeedbackService` 的内存存储同思路——它**不是** live 持久化；
 * live 走 `PostgresExplorationStore`，未配置数据库时应用启动即失败（fail fast）。
 */
export class InMemoryExplorationStore extends ExplorationStore {
  private readonly explorations = new Map<string, ExplorationRecord>();
  private readonly projects = new Map<string, ProjectRecord>();

  async createExploration(input: CreateExplorationInput): Promise<ExplorationRecord> {
    const record: ExplorationRecord = {
      id: input.id,
      studentId: input.studentId,
      source: input.source,
      templateVersionId: input.templateVersionId,
      status: 'exploring',
      intentDraft: emptyDraft(input.intentDraftId, input.id, input.now),
      createdAt: input.now,
      updatedAt: input.now,
      closedAt: null,
    };
    this.explorations.set(record.id, record);
    return cloneExploration(record);
  }

  async findExploration(id: string): Promise<ExplorationRecord | null> {
    const record = this.explorations.get(id);
    return record === undefined ? null : cloneExploration(record);
  }

  async updateIntentDraft(
    id: string,
    patch: IntentDraftPatch,
    status: ExplorationStatus,
    now: Date,
  ): Promise<ExplorationRecord> {
    const record = this.explorations.get(id);
    if (record === undefined) throw new Error(`exploration not found: ${id}`);
    const draft = record.intentDraft;
    record.status = status;
    record.updatedAt = now;
    record.intentDraft = {
      ...draft,
      goalUser: patch.goalUser !== undefined ? patch.goalUser : draft.goalUser,
      coreInterests:
        patch.coreInterests !== undefined ? [...patch.coreInterests] : [...draft.coreInterests],
      preferredForm: patch.preferredForm !== undefined ? patch.preferredForm : draft.preferredForm,
      targetBeneficiary:
        patch.targetBeneficiary !== undefined
          ? patch.targetBeneficiary
          : draft.targetBeneficiary,
      updatedAt: now,
    };
    return cloneExploration(record);
  }

  async persistConfirmation(input: PersistConfirmationInput): Promise<ProjectRecord> {
    const record = this.explorations.get(input.explorationId);
    if (record === undefined) throw new Error(`exploration not found: ${input.explorationId}`);
    if (this.findProjectByExplorationSync(input.explorationId) !== null) {
      // 与应用层幂等重放互补的最后一道防线：同探索只允许一个项目。
      throw new ExplorationStoreConflictError(
        `project already exists for exploration: ${input.explorationId}`,
      );
    }
    record.status = 'confirmed';
    record.updatedAt = input.confirmedAt;
    record.intentDraft = {
      ...record.intentDraft,
      ...input.confirmedDraft,
      coreInterests: [...input.confirmedDraft.coreInterests],
      confirmedAt: input.confirmedAt,
      updatedAt: input.confirmedAt,
    };
    const project: ProjectRecord = {
      ...input.project,
      sourceExplorationId: input.explorationId,
      createdAt: input.confirmedAt,
      completedAt: null,
    };
    this.projects.set(project.id, project);
    return cloneProject(project);
  }

  async findProjectByExploration(explorationId: string): Promise<ProjectRecord | null> {
    return this.findProjectByExplorationSync(explorationId);
  }

  async closeExploration(id: string, now: Date): Promise<ExplorationRecord> {
    const record = this.explorations.get(id);
    if (record === undefined) throw new Error(`exploration not found: ${id}`);
    record.status = 'closed';
    record.updatedAt = now;
    record.closedAt = now;
    return cloneExploration(record);
  }

  /** 测试辅助：清空内存状态。 */
  reset(): void {
    this.explorations.clear();
    this.projects.clear();
  }

  private findProjectByExplorationSync(explorationId: string): ProjectRecord | null {
    for (const project of this.projects.values()) {
      if (project.sourceExplorationId === explorationId) return cloneProject(project);
    }
    return null;
  }
}
