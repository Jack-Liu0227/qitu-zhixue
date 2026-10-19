import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AdminBindingPreview,
  AdminBindingRetireInput,
  CurrentUser,
  PblTemplateTeamBinding,
  ProjectBindingSnapshot,
  DeepTeamBinding,
  RolePhaseMap,
  ImaKnowledgeIntegration,
} from '@qitu/contracts';
import { IMA_READ_TOOLS } from '../ai-tutor/ima-mcp.client';
import {
  ADMIN_TEMPLATE_BINDING_IDEMPOTENCY_SCOPES,
  PBL_BINDING_STATUS_TRANSITIONS,
} from '@qitu/contracts';
import { AuditWriter, type AuditTransaction } from '../../common/audit/audit.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { assertCanGovernTemplate } from './templates.policy';
import { TemplateStore } from './templates.store';
import { TemplateViewerDirectory } from './template-evidence.store';
import { templateNotFound, versionNotFound } from './templates.view';
import { TemplateBindingStore, TemplateBindingStoreConflictError } from './templates-binding.store';
import {
  assertBindingStatusTransition,
  computeBindingHash,
  computeBindingValidation,
  computePblSpecHash,
  newBindingId,
  type BindingRecord,
  type SnapshotRecord,
} from './templates-binding.types';
import type {
  ProjectTemplateVersionRecord,
  TemplateStatus,
} from './templates.types';

export interface BindingMutationResult {
  binding: PblTemplateTeamBinding;
  replayed: boolean;
}

/** 课程模板 slug → 当前可用版本 的解析结果（学生端读 seam）。 */
export interface CurriculumTemplateResolution {
  templateVersionId: string;
  version: string;
  status: TemplateStatus;
  title: string;
  content: Record<string, unknown>;
}

const TEAM_VERSION_MISSING_MESSAGE = '团队版本不存在';

/**
 * 模板版本 ↔ 团队版本绑定服务（F2 / F3）。
 *
 * 硬约束：
 * 1. **绑定是不可变引用**：绑定指向 `admin_team_versions` 快照，绝不指向可变
 *    `admin_teams` 行；项目创建时把生效绑定冻结成快照。
 * 2. **状态机**：`draft → validated → active → retired`（terminal），服务端唯一
 *    写入方；非法迁移 409 `BINDING_TRANSITION_INVALID`。
 * 3. **并发双激活兜底**：`activateBinding` 事务先退役旧 active 再置新 active；
 *    局部唯一索引拒绝并发双激活 → `BINDING_CONFLICT`(409)。
 * 4. **幂等 + 审计**：create / validate / activate / retire 都要求
 *    `Idempotency-Key`，并写 `AuditWriter`（不含团队指令正文）。
 * 5. **冻结 / 回填**：`freezeProjectBinding` 在项目创建事务里写快照；正式项目
 *    调用方必须拒绝无绑定的 omitted 结果并回滚。`resolveSnapshotForProject` 在 miss 时回填（`backfilled=true`）。
 */
@Injectable()
export class TemplateBindingService {
  private readonly logger = new Logger(TemplateBindingService.name);

  constructor(
    private readonly templates: TemplateStore,
    private readonly directory: TemplateViewerDirectory,
    private readonly bindings: TemplateBindingStore,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
  ) {}

  /* ============================ 生命周期写 ============================ */

  async createBinding(
    actor: CurrentUser,
    templateId: string,
    versionId: string,
    input: { teamVersionId: string },
    idempotencyKey: string,
  ): Promise<BindingMutationResult> {
    await this.requireBindableVersion(actor, templateId, versionId);
    const teamVersion = await this.bindings.findTeamVersion(input.teamVersionId);
    if (teamVersion === null) {
      throw new BadRequestException({
        code: 'BINDING_INVALID',
        message: TEAM_VERSION_MISSING_MESSAGE,
      });
    }
    const pblSpecHash = computePblSpecHash(teamVersion);
    const bindingHash = computeBindingHash(versionId, input.teamVersionId, pblSpecHash);

    const scope = `${ADMIN_TEMPLATE_BINDING_IDEMPOTENCY_SCOPES.create}:${actor.id}:${versionId}`;
    const requestHash = hashIdempotentInput(
      scope,
      { templateId, versionId },
      { teamVersionId: input.teamVersionId },
    );

    const result = await this.executeIdempotent(scope, idempotencyKey, requestHash, async () => {
      const now = new Date();
      const record = await this.bindings.createBinding({
        id: newBindingId(),
        templateVersionId: versionId,
        teamVersionId: input.teamVersionId,
        bindingHash,
        createdBy: actor.id,
        now,
      });
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'template.binding.create',
        targetType: 'project_template_version',
        targetId: versionId,
        idempotencyKey: `${scope}:${idempotencyKey}`,
        detail: {
          bindingId: record.id,
          bindingHash: record.bindingHash,
          teamVersionId: record.teamVersionId,
          status: record.status,
        },
      });
      this.logger.log(`创建绑定 binding=${record.id} version=${versionId}`);
      return { status: 201, body: { binding: toBindingView(record), replayed: false } };
    });

    return result.replayed ? { ...result.body, replayed: true } : result.body;
  }

  async validateBinding(
    actor: CurrentUser,
    templateId: string,
    versionId: string,
    bindingId: string,
    idempotencyKey: string,
  ): Promise<BindingMutationResult> {
    await this.requireBindableVersion(actor, templateId, versionId);
    await this.requireBindingForVersion(bindingId, versionId);

    const scope = `${ADMIN_TEMPLATE_BINDING_IDEMPOTENCY_SCOPES.validate}:${actor.id}:${bindingId}`;
    const requestHash = hashIdempotentInput(scope, { templateId, versionId, bindingId }, {});

    const result = await this.executeIdempotent(scope, idempotencyKey, requestHash, async () => {
      const current = await this.requireBindingForVersion(bindingId, versionId);
      // 已是 validated：视为幂等成功（不同 key 重复校验也返回当前状态）。
      if (current.status === 'validated') {
        return { status: 200, body: { binding: toBindingView(current), replayed: true } };
      }
      assertBindingStatusTransition(current.status, 'validated', PBL_BINDING_STATUS_TRANSITIONS);

      const teamVersion = await this.bindings.findTeamVersion(current.teamVersionId);
      if (teamVersion === null) {
        throw new BadRequestException({
          code: 'BINDING_INVALID',
          message: TEAM_VERSION_MISSING_MESSAGE,
        });
      }
      const validation = computeBindingValidation(teamVersion);
      const now = new Date();
      const stamped = await this.bindings.updateValidation(bindingId, validation, now);

      if (!validation.valid) {
        // 未通过：写回校验结果（留痕），状态保持 draft，不迁移到 validated。
        await this.audit.write({
          actorId: actor.id,
          actorRole: actor.role,
          action: 'template.binding.validate',
          targetType: 'project_template_version',
          targetId: versionId,
          idempotencyKey: `${scope}:${idempotencyKey}`,
          detail: {
            bindingId,
            bindingHash: stamped.bindingHash,
            status: stamped.status,
            valid: false,
            errors: validation.errors,
          },
        });
        throw new BadRequestException({
          code: 'BINDING_INVALID',
          message: '绑定校验未通过',
          validation,
        });
      }

      const validated = await this.bindings.setStatus(bindingId, 'validated', now);
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'template.binding.validate',
        targetType: 'project_template_version',
        targetId: versionId,
        idempotencyKey: `${scope}:${idempotencyKey}`,
        detail: {
          bindingId,
          bindingHash: validated.bindingHash,
          status: validated.status,
          valid: true,
          previousStatus: current.status,
        },
      });
      return { status: 200, body: { binding: toBindingView(validated), replayed: false } };
    });

    return result.replayed ? { ...result.body, replayed: true } : result.body;
  }

  async activateBinding(
    actor: CurrentUser,
    templateId: string,
    versionId: string,
    bindingId: string,
    idempotencyKey: string,
  ): Promise<BindingMutationResult> {
    await this.requireBindableVersion(actor, templateId, versionId);
    await this.requireBindingForVersion(bindingId, versionId);

    const scope = `${ADMIN_TEMPLATE_BINDING_IDEMPOTENCY_SCOPES.activate}:${actor.id}:${bindingId}`;
    const requestHash = hashIdempotentInput(scope, { templateId, versionId, bindingId }, {});

    const result = await this.executeIdempotent(scope, idempotencyKey, requestHash, async () => {
      const current = await this.requireBindingForVersion(bindingId, versionId);
      if (current.status === 'active') {
        return { status: 200, body: { binding: toBindingView(current), replayed: true } };
      }
      assertBindingStatusTransition(current.status, 'active', PBL_BINDING_STATUS_TRANSITIONS);

      const now = new Date();
      const activated = await this.bindings.activateBinding(versionId, bindingId, now);
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'template.binding.activate',
        targetType: 'project_template_version',
        targetId: versionId,
        idempotencyKey: `${scope}:${idempotencyKey}`,
        detail: {
          bindingId,
          bindingHash: activated.bindingHash,
          status: activated.status,
          previousStatus: current.status,
        },
      });
      this.logger.log(`激活绑定 binding=${bindingId} version=${versionId}`);
      return { status: 200, body: { binding: toBindingView(activated), replayed: false } };
    });

    return result.replayed ? { ...result.body, replayed: true } : result.body;
  }

  async retireBinding(
    actor: CurrentUser,
    templateId: string,
    versionId: string,
    bindingId: string,
    input: AdminBindingRetireInput,
    idempotencyKey: string,
  ): Promise<BindingMutationResult> {
    await this.requireBindableVersion(actor, templateId, versionId);
    await this.requireBindingForVersion(bindingId, versionId);

    const reason = normalizeReason(input.reason);
    const scope = `${ADMIN_TEMPLATE_BINDING_IDEMPOTENCY_SCOPES.retire}:${actor.id}:${bindingId}`;
    const requestHash = hashIdempotentInput(
      scope,
      { templateId, versionId, bindingId },
      { reason },
    );

    const result = await this.executeIdempotent(scope, idempotencyKey, requestHash, async () => {
      const current = await this.requireBindingForVersion(bindingId, versionId);
      if (current.status === 'retired') {
        return { status: 200, body: { binding: toBindingView(current), replayed: true } };
      }
      assertBindingStatusTransition(current.status, 'retired', PBL_BINDING_STATUS_TRANSITIONS);

      const now = new Date();
      const retired = await this.bindings.retireBinding(bindingId, now);
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'template.binding.retire',
        targetType: 'project_template_version',
        targetId: versionId,
        idempotencyKey: `${scope}:${idempotencyKey}`,
        reason,
        detail: {
          bindingId,
          bindingHash: retired.bindingHash,
          status: retired.status,
          previousStatus: current.status,
        },
      });
      return { status: 200, body: { binding: toBindingView(retired), replayed: false } };
    });

    return result.replayed ? { ...result.body, replayed: true } : result.body;
  }

  /* ============================ B5 预览 ============================ */

  async previewBindings(
    actor: CurrentUser,
    templateId: string,
    versionId: string,
  ): Promise<AdminBindingPreview> {
    await this.requirePreviewVersion(actor, templateId, versionId);
    const [activeBinding, affectedProjects] = await Promise.all([
      this.bindings.findActiveBinding(versionId),
      this.bindings.listAffectedProjects(versionId),
    ]);
    return {
      templateVersionId: versionId,
      affectedProjects: affectedProjects.map((project) => ({
        projectId: project.projectId,
        studentUserId: project.studentUserId,
        title: project.title,
        planId: project.planId,
      })),
      activeBinding: activeBinding === null ? null : toBindingView(activeBinding),
    };
  }

  /* ============================ 运行时读 seam ============================ */

  /**
   * 当前生效绑定（F2.4 的单一读 seam）。无 active 绑定返回 null，绝不报错。
   */
  async resolveActiveBinding(
    templateVersionId: string,
    tx?: AuditTransaction,
  ): Promise<PblTemplateTeamBinding | null> {
    const record = await this.bindings.findActiveBinding(templateVersionId, tx);
    return record === null ? null : toBindingView(record);
  }

  /** 语义别名（团队解析 / 项目冻结共用同一读 seam）。 */
  async findActiveBindingForTemplate(
    templateVersionId: string,
    tx?: AuditTransaction,
  ): Promise<PblTemplateTeamBinding | null> {
    return this.resolveActiveBinding(templateVersionId, tx);
  }

  /**
   * 由课程模板 slug 解析「当前可用」的模板版本（学生端读 seam）。
   *
   * 作用域按学生可见性（平台 ∪ 本校）经 `listTemplates({ visibleToSchoolId })`
   * 查找，而不是精确 `findTemplateBySlug(schoolId, slug)`——平台模板
   * （`schoolId === null`）对学生可见，后者会漏掉它们。
   *
   * 优先级：
   * 1. 已发布版本上的 active 绑定；
   * 2. 试点（piloting）版本上的 active 绑定（bootstrap 产出的状态）；
   * 3. 最新已发布版本（无绑定）。
   *
   * 试点版本没有 active 绑定不可用（无法解析团队，判分链路会断）；模板/版本
   * 均不可用时返回 null，由调用方决定错误码——本方法是只读 seam，不自己报错。
   */
  async resolveCurriculumTemplateVersion(
    actor: CurrentUser,
    slug: string,
  ): Promise<CurriculumTemplateResolution | null> {
    const schoolId = await this.directory.findSchoolId(actor.id);
    const templates = await this.templates.listTemplates({ visibleToSchoolId: schoolId });
    const template = templates.find(
      (record) =>
        record.slug === slug &&
        (record.status === 'published' || record.status === 'piloting'),
    );
    if (template === undefined) return null;

    const versions = (await this.templates.listVersions(template.id)).filter(
      (version) => version.status === 'published' || version.status === 'piloting',
    );
    if (versions.length === 0) return null;

    const ranked: { version: ProjectTemplateVersionRecord; rank: number }[] = [];
    for (const version of versions) {
      const active = await this.bindings.findActiveBinding(version.id);
      const hasActive = active !== null;
      let rank: number;
      if (version.status === 'published' && hasActive) rank = 0;
      else if (version.status === 'piloting' && hasActive) rank = 1;
      else if (version.status === 'published') rank = 2;
      else continue; // piloting 无 active 绑定：不可解析团队，排除。
      ranked.push({ version, rank });
    }
    if (ranked.length === 0) return null;

    ranked.sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      const leftTime = left.version.publishedAt?.getTime() ?? left.version.createdAt.getTime();
      const rightTime = right.version.publishedAt?.getTime() ?? right.version.createdAt.getTime();
      return rightTime - leftTime;
    });
    const resolved = ranked[0]?.version;
    if (resolved === undefined) return null;
    return {
      templateVersionId: resolved.id,
      version: resolved.version,
      status: resolved.status,
      title: template.title,
      content: resolved.content,
    };
  }

  /**
   * F3 项目创建冻结：在创建事务里把生效绑定落成快照（`backfilled=false`）。
   * 无 active 绑定返回 `'omitted'`；正式项目确认调用方必须抛错并回滚事务。
   */
  async freezeProjectBinding(input: {
    projectId: string;
    templateVersionId: string | null;
    boundAt: Date;
    tx?: AuditTransaction;
  }): Promise<'frozen' | 'omitted'> {
    if (input.templateVersionId === null) return 'omitted';
    const binding = await this.bindings.findActiveBinding(input.templateVersionId, input.tx);
    if (binding === null) return 'omitted';
    await this.bindings.insertSnapshot(
      {
        projectId: input.projectId,
        templateVersionId: input.templateVersionId,
        bindingId: binding.id,
        teamVersionId: binding.teamVersionId,
        bindingHash: binding.bindingHash,
        boundAt: input.boundAt,
        backfilled: false,
      },
      input.tx,
    );
    return 'frozen';
  }

  /**
   * Read only the binding frozen during confirmation; reads cannot grant new semantics.
   * Legacy backfills require an explicit governed reconfirmation before runtime use.
   */
  async findFrozenSnapshotForProject(
    projectId: string,
    templateVersionId: string | null,
  ): Promise<ProjectBindingSnapshot | null> {
    if (templateVersionId === null) return null;
    const snapshot = await this.bindings.findSnapshot(projectId);
    if (snapshot === null || snapshot.backfilled || snapshot.projectId !== projectId
      || snapshot.templateVersionId !== templateVersionId) return null;
    const binding = await this.bindings.findBinding(snapshot.bindingId);
    if (binding === null || binding.templateVersionId !== templateVersionId
      || binding.teamVersionId !== snapshot.teamVersionId
      || binding.bindingHash !== snapshot.bindingHash) return null;
    return toSnapshotView(snapshot);
  }

  /**
   * F3 存量项目回填：读快照，miss 时按当前 active 绑定惰性回填
   * （`backfilled=true`，`ON CONFLICT DO NOTHING`）。无绑定返回 null，绝不报错。
   */
  async resolveSnapshotForProject(
    projectId: string,
    templateVersionId: string | null,
    actor?: CurrentUser,
  ): Promise<ProjectBindingSnapshot | null> {
    const existing = await this.bindings.findSnapshot(projectId);
    if (existing !== null) return toSnapshotView(existing);
    if (templateVersionId === null) return null;

    const active = await this.bindings.findActiveBinding(templateVersionId);
    if (active === null) return null;

    await this.bindings.insertSnapshot({
      projectId,
      templateVersionId,
      bindingId: active.id,
      teamVersionId: active.teamVersionId,
      bindingHash: active.bindingHash,
      boundAt: new Date(),
      backfilled: true,
    });
    // 回填审计是读路径的派生写：绝不因审计失败把读接口打挂。
    try {
      await this.audit.write({
        actorId: actor?.id ?? null,
        actorRole: actor?.role ?? null,
        action: 'project.binding.backfill',
        targetType: 'project',
        targetId: projectId,
        detail: { projectId, bindingId: active.id },
      });
    } catch (error) {
      this.logger.warn(
        `绑定快照回填审计写入失败 project=${projectId} err=${(error as Error)?.message ?? error}`,
      );
    }

    const row = await this.bindings.findSnapshot(projectId);
    return row === null ? null : toSnapshotView(row);
  }

  /**
   * 课时编排与团队深度绑定（Theme-Session-Team-IMA）：
   * 读取项目冻结的快照并解析出具备 IMA MCP 授权与阶段智能体映射的 DeepTeamBinding。
   */
  async resolveDeepTeamBinding(
    projectId: string,
    templateVersionId: string | null,
    actor?: CurrentUser,
  ): Promise<DeepTeamBinding | null> {
    const snapshot = await this.resolveSnapshotForProject(projectId, templateVersionId, actor);
    if (snapshot === null) return null;

    const teamVersion = await this.bindings.findTeamVersion(snapshot.teamVersionId);
    const members = (teamVersion?.members ?? []) as Array<{ assistantId?: string; id?: string; role?: string; phase?: string }>;

    const findMember = (phaseName: string, pattern: RegExp, fallback: string): string => {
      const match = members.find((m) => {
        const id = m.assistantId ?? m.id ?? '';
        return m.phase === phaseName || pattern.test(id) || pattern.test(m.role ?? '');
      });
      return match?.assistantId ?? match?.id ?? fallback;
    };

    const roleMap: RolePhaseMap = {
      exploration: findMember('exploration', /lead|intake|intro/i, 'qitu-intake-assistant'),
      concept_mastery: findMember('concept_mastery', /coach|concept|theory/i, 'optics-concept-coach'),
      guided_practice: findMember('guided_practice', /guide|code|experiment|practice/i, 'optics-experiment-guide'),
      deliverable_review: findMember('deliverable_review', /review|assess|defense/i, 'optics-review-assessor'),
    };

    const imaMcpGrant: ImaKnowledgeIntegration = {
      serverId: 'ima-knowledge',
      knowledgeBaseIds: ['high-school-physics-optics', 'high-school-physics-motion'],
      allowedTools: IMA_READ_TOOLS,
    };

    return {
      bindingId: snapshot.bindingId,
      templateVersionId: snapshot.templateVersionId,
      teamVersionId: snapshot.teamVersionId,
      roleMap,
      imaMcpGrant,
      bindingHash: snapshot.bindingHash,
    };
  }

  /* ============================ 内部 ============================ */

  private async requireBindableVersion(
    actor: CurrentUser,
    templateId: string,
    versionId: string,
  ): Promise<{ templateId: string; versionId: string }> {
    const template = await this.templates.findTemplate(templateId);
    if (template === null) throw templateNotFound();
    const actorSchoolId = await this.directory.findSchoolId(actor.id);
    assertCanGovernTemplate(actor, template, actorSchoolId);
    const version = await this.templates.findVersion(versionId);
    if (version === null || version.templateId !== templateId) throw versionNotFound();
    // 生命周期写（create/validate/activate/retire）允许 published 与 piloting：
    // 试点模板必须先有 active 绑定，tutor 才能经绑定解析团队；而 piloting → published
    // 仍需 5 项证据门（不在此放行）。draft/archived 仍拒。
    if (version.status !== 'published' && version.status !== 'piloting') {
      throw new NotFoundException({
        code: 'BINDING_TEMPLATE_VERSION_NOT_FOUND',
        message: '模板版本不存在或未发布',
      });
    }
    return { templateId, versionId };
  }

  private async requirePreviewVersion(
    actor: CurrentUser,
    templateId: string,
    versionId: string,
  ): Promise<{ templateId: string; versionId: string }> {
    const template = await this.templates.findTemplate(templateId);
    if (template === null) throw templateNotFound();
    const actorSchoolId = await this.directory.findSchoolId(actor.id);
    assertCanGovernTemplate(actor, template, actorSchoolId);
    const version = await this.templates.findVersion(versionId);
    if (version === null || version.templateId !== templateId) throw versionNotFound();
    // B5 预览允许 published 或 review（见 api-spec F2.3）。
    if (version.status !== 'published' && version.status !== 'review') {
      throw new NotFoundException({
        code: 'BINDING_TEMPLATE_VERSION_NOT_FOUND',
        message: '模板版本不存在或未发布',
      });
    }
    return { templateId, versionId };
  }

  private async requireBindingForVersion(
    bindingId: string,
    versionId: string,
  ): Promise<BindingRecord> {
    const binding = await this.bindings.findBinding(bindingId);
    if (binding === null || binding.templateVersionId !== versionId) {
      throw new NotFoundException({ code: 'BINDING_NOT_FOUND', message: '绑定不存在' });
    }
    return binding;
  }

  private async executeIdempotent<T>(
    scope: string,
    key: string,
    requestHash: string,
    handler: () => Promise<{ status?: number; body: T }>,
  ): Promise<{ status: number; body: T; replayed: boolean }> {
    try {
      return await this.idempotency.execute(scope, key, requestHash, handler);
    } catch (error) {
      if (error instanceof TemplateBindingStoreConflictError) {
        throw new ConflictException({
          code: 'BINDING_CONFLICT',
          message: error.message,
        });
      }
      throwHttpForIdempotencyError(error);
    }
  }
}

/* ============================ 纯函数 ============================ */

export function toBindingView(record: BindingRecord): PblTemplateTeamBinding {
  return {
    id: record.id,
    templateVersionId: record.templateVersionId,
    teamVersionId: record.teamVersionId,
    status: record.status,
    bindingHash: record.bindingHash,
    validation: {
      valid: record.validation.valid,
      errors: [...record.validation.errors],
      warnings: [...record.validation.warnings],
      checkedAt: record.validation.checkedAt,
    },
    activatedAt: record.activatedAt?.toISOString() ?? null,
    retiredAt: record.retiredAt?.toISOString() ?? null,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toSnapshotView(record: SnapshotRecord): ProjectBindingSnapshot {
  return {
    projectId: record.projectId,
    templateVersionId: record.templateVersionId,
    bindingId: record.bindingId,
    teamVersionId: record.teamVersionId,
    bindingHash: record.bindingHash,
    boundAt: record.boundAt.toISOString(),
    backfilled: record.backfilled,
  };
}

function normalizeReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length === 0 ? null : value.slice(0, 500);
}
