import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CloseExplorationRequest,
  ConfirmIntentRequest,
  ConfirmIntentResponse,
  CreateExplorationRequest,
  ExplorationSource,
  ExplorationStatus,
  ExplorationView,
  IntentDraft,
  ProjectSummary,
  UpdateIntentDraftRequest,
} from '@qitu/contracts';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { AuditWriter } from '../../common/audit/audit.service';
import type { Database } from '@qitu/database';
import { projectTemplateVersions, projectTemplates } from '@qitu/database';
import { and, eq, isNull } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database';
import {
  canCreateFormalProject,
  closeExploration as closeExplorationState,
  computeStageProgress,
  confirmIntent as confirmIntentState,
  FORMAL_PROJECT_START_STAGE,
  IntentConfirmationError,
  isIntentDraftConfirmable,
  markAwaitingConfirmation,
  type IntentDraftFields,
} from './intent-confirmation.state-machine';
import {
  ExplorationStore,
  ExplorationStoreConflictError,
  type ExplorationRecord,
  type IntentDraftPatch,
  type ProjectRecord,
} from './exploration.store';

/** 候选意图最多保留的核心兴趣数（避免把长期档案整段抄进探索）。 */
export const MAX_CORE_INTERESTS = 8;
/** 单个兴趣标签长度上限。 */
export const MAX_INTEREST_LENGTH = 24;
/** 目标用户 / 偏好形式 / 受益对象等短文本上限。 */
export const MAX_INTENT_TEXT_LENGTH = 120;
/** 确认备注长度上限。 */
const MAX_NOTE_LENGTH = 200;

/**
 * T6 — 探索 / 意图确认服务。
 *
 * 职责边界（与 `AGENTS.md` 的硬约束一一对应）：
 *
 * 1. **未确认不得创建正式项目**：唯一判定点是
 *    `canCreateFormalProject(status, draft)`。探索期只写 `exploration_sessions`
 *    与 `intent_confirmations`，**绝不**插入 `projects`；只有 `confirmIntent`
 *    通过状态机 + 幂等键后才创建项目实例。
 * 2. **确认凭据由服务端独占**：`confirmedAt` 是唯一确认凭据，服务端在
 *    `confirmIntent` 时写入。请求体里没有 `status` / `confirmedAt` / 项目字段。
 * 3. **对象级授权**：`requireOwned` 只放行探索本人；他人探索统一 404
 *    （`EXPLORATION_NOT_FOUND`），不泄露存在性。
 * 4. **幂等**：`createExploration` 与 `confirmIntent` 都走 `IdempotencyStore`，
 *    同键同载荷重放、同键异载荷 409；数据库唯一索引兜底「同探索一个项目」。
 * 5. **审计**：确认创建项目写 `AuditWriter`（fail-closed，无库即 503）。
 *
 * 存储通过 `ExplorationStore` 抽象解耦：demo/test 用内存实现，live 用
 * `PostgresExplorationStore`（见 `projects.module.ts` 的工厂）。
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly store: ExplorationStore,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
    @Optional() @Inject(DATABASE_TOKEN) private readonly db: Database | null = null,
  ) {}

  /* ------------------------------ 读 ------------------------------ */

  async getExploration(studentId: string, explorationId: string): Promise<ExplorationView> {
    const record = await this.requireOwned(studentId, explorationId);
    return this.toView(record);
  }

  /* ------------------------------ 写 ------------------------------ */

  /** 新建探索会话（草稿）。推荐方向必须携带冻结的模板版本。 */
  async createExploration(
    studentId: string,
    input: CreateExplorationRequest,
    idempotencyKey: string,
  ): Promise<ExplorationView> {
    const { source, templateVersionId } = assertCreateInput(input);
    // scope 必须绑定学生，否则两名学生用同一把 key 会互相重放对方的探索。
    const scope = `student.exploration.create:${studentId}`;
    const requestHash = hashIdempotentInput(scope, {}, { source, templateVersionId });

    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, requestHash, async () => {
        const now = new Date();
        await this.assertPublishedTemplateVersion(templateVersionId);
        const record = await this.store.createExploration({
          id: `exp-${randomUUID()}`,
          studentId,
          source,
          templateVersionId,
          intentDraftId: `draft-${randomUUID()}`,
          now,
        });
        this.logger.log(
          `创建探索 id=${record.id} source=${record.source} 学生=${studentId}`,
        );
        return { status: 201, body: await this.toView(record) };
      });
      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /**
   * 更新候选意图草稿。
   *
   * 这是 AI / 学生共同澄清的入口；`status` 由服务端依据草稿是否形成来迁移：
   * 首次变得可确认时 `exploring → awaiting_confirmation`；反之回退到
   * `exploring`，避免把一个空方向摆在学生面前诱导误确认。
   */
  async updateIntentDraft(
    studentId: string,
    explorationId: string,
    input: UpdateIntentDraftRequest,
  ): Promise<ExplorationView> {
    const record = await this.requireOwned(studentId, explorationId);
    if (record.status === 'confirmed' || record.status === 'closed') {
      throw transitionInvalid(`探索状态为 ${record.status}，不能修改候选意图`);
    }

    const patch = normalizePatch(input);
    const merged = mergeDraft(record, patch);
    const status = reconcileDraftStatus(record.status, merged);
    const updated = await this.store.updateIntentDraft(explorationId, patch, status, new Date());

    await this.audit.write({
      actorId: studentId,
      actorRole: 'student',
      action: 'exploration.intent_draft.update',
      targetType: 'exploration',
      targetId: explorationId,
      detail: { status, source: record.source },
    });

    return this.toView(updated);
  }

  /**
   * 确认意图 → 创建**唯一**项目实例。
   *
   * 幂等语义：
   * - 同 key 重放：返回首次响应（`IdempotencyStore` 不重复执行 handler）；
   * - 同探索已有项目（不同 key 的重试 / 双开页）：识别为 `replayed=true`，
   *   不再插入第二条；
   * - 并发写入：唯一索引冲突被转成 `replayed=true`，与顺序重试一致。
   */
  async confirmIntent(
    studentId: string,
    explorationId: string,
    idempotencyKey: string,
    input: ConfirmIntentRequest = {},
  ): Promise<ConfirmIntentResponse> {
    const record = await this.requireOwned(studentId, explorationId);
    if (record.status === 'closed') {
      throw transitionInvalid('已关闭的探索不能确认意图');
    }

    const note = assertOptionalNote(input.note);
    const scope = `student.exploration.confirm-intent:${studentId}:${explorationId}`;
    const requestHash = hashIdempotentInput(scope, { explorationId }, { note });

    try {
      const result = await this.idempotency.execute(scope, idempotencyKey, requestHash, async () => {
        // 幂等键重放之外的第二次确认：同一探索已有项目 → 直接复用。
        const existingProject = await this.store.findProjectByExploration(explorationId);
        if (existingProject !== null) {
          const current = await this.requireOwned(studentId, explorationId);
          return { status: 200, body: await this.confirmResponse(current, existingProject, true) };
        }

        const fresh = await this.requireOwned(studentId, explorationId);
        const now = new Date();
        const confirmed = applyConfirm(fresh.status, fresh.intentDraft, now.toISOString());
        if (!canCreateFormalProject(confirmed.status, confirmed.draft)) {
          // 理论不可达：状态机已保证 confirmed 时 confirmedAt 非空。
          throw transitionInvalid('候选意图未确认，拒绝创建正式项目');
        }

        const stage = FORMAL_PROJECT_START_STAGE;
        const progress = computeStageProgress(stage);
        let project: ProjectRecord;
        try {
          project = await this.store.persistConfirmation({
            explorationId,
            confirmedAt: now,
            confirmedDraft: {
              goalUser: confirmed.draft.goalUser,
              coreInterests: [...confirmed.draft.coreInterests],
              preferredForm: confirmed.draft.preferredForm,
              targetBeneficiary: confirmed.draft.targetBeneficiary,
            },
            project: {
              id: `proj-${randomUUID()}`,
              studentId,
              templateVersionId: fresh.templateVersionId,
              status: stage,
              currentStageIndex: progress.currentStageIndex,
              stageTotal: progress.stageTotal,
              progressPercent: progress.progressPercent,
              title: deriveProjectTitle(confirmed.draft),
              subtitle: confirmed.draft.preferredForm,
              tags: [...confirmed.draft.coreInterests],
            },
          });
        } catch (error) {
          if (error instanceof ExplorationStoreConflictError) {
            const raced = await this.store.findProjectByExploration(explorationId);
            if (raced !== null) {
              const current = await this.requireOwned(studentId, explorationId);
              return { status: 200, body: await this.confirmResponse(current, raced, true) };
            }
          }
          throw error;
        }

        const updated = (await this.store.findExploration(explorationId)) ?? fresh;
        await this.audit.write({
          actorId: studentId,
          actorRole: 'student',
          action: 'exploration.confirm_intent',
          targetType: 'project',
          targetId: project.id,
          idempotencyKey: `${scope}:${idempotencyKey}`,
          detail: {
            explorationId,
            source: updated.source,
            templateVersionId: updated.templateVersionId,
            stage,
          },
        });
        this.logger.log(
          `确认意图并创建项目 exploration=${explorationId} project=${project.id} source=${updated.source}`,
        );
        return { status: 201, body: await this.confirmResponse(updated, project, false) };
      });

      const body = result.body;
      // `execute` 命中持久化记录时，把「未创建新项目」这一事实补进响应。
      return result.replayed ? { ...body, replayed: true } : body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  /** 关闭探索；已确认的探索不允许关闭（保护「有项目但探索关闭」的悬挂状态）。 */
  async closeExploration(
    studentId: string,
    explorationId: string,
    _input: CloseExplorationRequest = {},
  ): Promise<ExplorationView> {
    const record = await this.requireOwned(studentId, explorationId);
    applyClose(record.status);
    const updated = await this.store.closeExploration(explorationId, new Date());

    await this.audit.write({
      actorId: studentId,
      actorRole: 'student',
      action: 'exploration.close',
      targetType: 'exploration',
      targetId: explorationId,
      detail: { source: record.source },
    });

    return this.toView(updated);
  }

  /* ------------------------------ 内部 ------------------------------ */

  private async assertPublishedTemplateVersion(templateVersionId: string | null): Promise<void> {
    if (templateVersionId === null || this.db === null) return;
    const rows = await this.db
      .select({ versionId: projectTemplateVersions.id })
      .from(projectTemplateVersions)
      .innerJoin(projectTemplates, eq(projectTemplateVersions.templateId, projectTemplates.id))
      .where(and(
        eq(projectTemplateVersions.id, templateVersionId),
        eq(projectTemplateVersions.status, 'published'),
        eq(projectTemplates.status, 'published'),
        isNull(projectTemplates.schoolId),
      ))
      .limit(1);
    if (rows.length === 0) {
      throw new BadRequestException({
        code: 'TEMPLATE_VERSION_UNAVAILABLE',
        message: '推荐模板版本不存在、未发布或当前账号不可见',
      });
    }
  }

  private async requireOwned(
    studentId: string,
    explorationId: string,
  ): Promise<ExplorationRecord> {
    const record = await this.store.findExploration(explorationId);
    if (record === null || record.studentId !== studentId) {
      // 不区分「不存在 / 不属于我」，避免用差异探测他人探索。
      throw new NotFoundException({
        code: 'EXPLORATION_NOT_FOUND',
        message: '探索会话不存在',
      });
    }
    return record;
  }

  private async toView(record: ExplorationRecord): Promise<ExplorationView> {
    const project = await this.store.findProjectByExploration(record.id);
    const draft: IntentDraft = {
      id: record.intentDraft.id,
      explorationId: record.intentDraft.explorationId,
      goalUser: record.intentDraft.goalUser,
      coreInterests: [...record.intentDraft.coreInterests],
      preferredForm: record.intentDraft.preferredForm,
      targetBeneficiary: record.intentDraft.targetBeneficiary,
      confirmedAt: record.intentDraft.confirmedAt?.toISOString() ?? null,
      updatedAt: record.intentDraft.updatedAt.toISOString(),
    };
    return {
      id: record.id,
      source: record.source,
      templateVersionId: record.templateVersionId,
      status: record.status,
      intentDraft: draft,
      projectId: project?.id ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private async confirmResponse(
    record: ExplorationRecord,
    project: ProjectRecord,
    replayed: boolean,
  ): Promise<ConfirmIntentResponse> {
    const summary: ProjectSummary = {
      id: project.id,
      title: project.title,
      stage: project.status,
      progress: project.progressPercent,
    };
    return { exploration: await this.toView(record), project: summary, replayed };
  }
}

/* ==================== 纯函数校验 ==================== */

function assertCreateInput(input: CreateExplorationRequest): {
  source: ExplorationSource;
  templateVersionId: string | null;
} {
  const source = input.source;
  if (source !== 'recommended' && source !== 'free') {
    throw new BadRequestException({
      code: 'EXPLORATION_TRANSITION_INVALID',
      message: 'source 必须是 recommended 或 free',
    });
  }

  const raw = input.templateVersionId;
  const templateVersionId =
    typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;

  if (source === 'recommended' && templateVersionId === null) {
    throw new BadRequestException({
      code: 'EXPLORATION_TRANSITION_INVALID',
      message: '推荐探索必须携带模板版本（templateVersionId）',
    });
  }
  if (source === 'free' && templateVersionId !== null) {
    throw new BadRequestException({
      code: 'EXPLORATION_TRANSITION_INVALID',
      message: '自由探索不能携带模板版本',
    });
  }
  return { source, templateVersionId };
}

function normalizePatch(input: UpdateIntentDraftRequest): IntentDraftPatch {
  const patch: IntentDraftPatch = {};
  if ('goalUser' in input) patch.goalUser = assertOptionalText(input.goalUser, 'goalUser');
  if ('preferredForm' in input) {
    patch.preferredForm = assertOptionalText(input.preferredForm, 'preferredForm');
  }
  if ('targetBeneficiary' in input) {
    patch.targetBeneficiary = assertOptionalText(input.targetBeneficiary, 'targetBeneficiary');
  }
  if ('coreInterests' in input) {
    patch.coreInterests = normalizeCoreInterests(input.coreInterests);
  }
  return patch;
}

function normalizeCoreInterests(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new BadRequestException({
      code: 'EXPLORATION_TRANSITION_INVALID',
      message: 'coreInterests 必须为字符串数组',
    });
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new BadRequestException({
        code: 'EXPLORATION_TRANSITION_INVALID',
        message: 'coreInterests 必须为字符串数组',
      });
    }
    const tag = item.trim();
    if (tag.length === 0) continue;
    if (tag.length > MAX_INTEREST_LENGTH) {
      throw new BadRequestException({
        code: 'EXPLORATION_TRANSITION_INVALID',
        message: `单个兴趣标签不能超过 ${MAX_INTEREST_LENGTH} 字`,
      });
    }
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  if (out.length > MAX_CORE_INTERESTS) {
    throw new BadRequestException({
      code: 'EXPLORATION_TRANSITION_INVALID',
      message: `核心兴趣最多 ${MAX_CORE_INTERESTS} 个`,
    });
  }
  return out;
}

function assertOptionalText(raw: unknown, label: string): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') {
    throw new BadRequestException({
      code: 'EXPLORATION_TRANSITION_INVALID',
      message: `${label} 必须为字符串`,
    });
  }
  const value = raw.trim();
  if (value.length === 0) return null;
  if (value.length > MAX_INTENT_TEXT_LENGTH) {
    throw new BadRequestException({
      code: 'EXPLORATION_TRANSITION_INVALID',
      message: `${label} 不能超过 ${MAX_INTENT_TEXT_LENGTH} 字`,
    });
  }
  return value;
}

function assertOptionalNote(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string') {
    throw new BadRequestException({
      code: 'EXPLORATION_TRANSITION_INVALID',
      message: 'note 必须为字符串',
    });
  }
  const note = raw.trim();
  if (note.length > MAX_NOTE_LENGTH) {
    throw new BadRequestException({
      code: 'EXPLORATION_TRANSITION_INVALID',
      message: `note 不能超过 ${MAX_NOTE_LENGTH} 字`,
    });
  }
  return note;
}

function mergeDraft(record: ExplorationRecord, patch: IntentDraftPatch): IntentDraftFields {
  return {
    goalUser: patch.goalUser !== undefined ? patch.goalUser : record.intentDraft.goalUser,
    coreInterests:
      patch.coreInterests !== undefined ? patch.coreInterests : record.intentDraft.coreInterests,
    preferredForm:
      patch.preferredForm !== undefined ? patch.preferredForm : record.intentDraft.preferredForm,
    targetBeneficiary:
      patch.targetBeneficiary !== undefined
        ? patch.targetBeneficiary
        : record.intentDraft.targetBeneficiary,
  };
}

function reconcileDraftStatus(
  status: ExplorationStatus,
  merged: IntentDraftFields,
): ExplorationStatus {
  if (isIntentDraftConfirmable(merged)) {
    return status === 'exploring' ? applyMark(status, merged) : status;
  }
  // 草稿被改回不可确认：退回 exploring，不留下可点击的「确认」入口。
  return status === 'awaiting_confirmation' ? 'exploring' : status;
}

/**
 * 从确认后的草稿推导项目标题。
 *
 * 这里**不虚构模板标题**：推荐方向的模板标题读取属于模板模块，本切片只
 * 记录冻结的 `templateVersionId`。标题完全来自学生确认过的目标 / 兴趣。
 */
function deriveProjectTitle(draft: IntentDraftFields): string {
  if (draft.goalUser !== null && draft.goalUser.trim().length > 0) {
    return draft.goalUser;
  }
  const first = draft.coreInterests.find((tag) => tag.trim().length > 0);
  return first !== undefined ? `${first} 主题项目` : '未命名探索项目';
}

function transitionInvalid(message: string): never {
  throw new ConflictException({
    code: 'EXPLORATION_TRANSITION_INVALID',
    message,
  });
}

/* ==================== 状态机错误 → HTTP ==================== */

/** 把纯状态机的领域错误映射为稳定的 HTTP 409 错误码，其余原样抛出。 */
function rethrowAsHttp(error: unknown): never {
  if (error instanceof IntentConfirmationError) {
    throw new ConflictException({ code: error.code, message: error.message });
  }
  throw error;
}

function applyMark(
  status: ExplorationStatus,
  draft: IntentDraftFields,
): 'awaiting_confirmation' {
  try {
    return markAwaitingConfirmation(status, draft);
  } catch (error) {
    rethrowAsHttp(error);
  }
}

function applyConfirm(
  status: ExplorationStatus,
  draft: IntentDraftFields,
  confirmedAt: string,
): { status: 'confirmed'; draft: ReturnType<typeof confirmIntentState>['draft'] } {
  try {
    return confirmIntentState(status, draft, confirmedAt);
  } catch (error) {
    rethrowAsHttp(error);
  }
}

function applyClose(status: ExplorationStatus): 'closed' {
  try {
    return closeExplorationState(status);
  } catch (error) {
    rethrowAsHttp(error);
  }
}
