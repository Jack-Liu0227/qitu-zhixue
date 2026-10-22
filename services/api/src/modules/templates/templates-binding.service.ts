import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { TeachingBundleCatalog } from './teaching-bundle.catalog';
import { teachingValueDigest } from './teaching-bundle.canonical';
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
  hasLearningSessionCompletion,
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
    @Optional() private readonly bundleCatalog?: TeachingBundleCatalog,
  ) {}

  /* ============================ 生命周期写 ============================ */

  async createBinding(
    actor: CurrentUser,
    templateId: string,
    versionId: string,
    input: { teamVersionId: string },
    idempotencyKey: string,
  ): Promise<BindingMutationResult> {
    await this.requireConfigurationVersion(actor, templateId, versionId);
    const teamVersion = await this.bindings.findTeamVersion(input.teamVersionId);
    if (teamVersion === null) {
      throw new BadRequestException({
        code: 'BINDING_INVALID',
        message: TEAM_VERSION_MISSING_MESSAGE,
      });
    }
    const pblSpecHash = computePblSpecHash(teamVersion);
    const bindingHash = computeBindingHash(versionId, input.teamVersionId, pblSpecHash, null);

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
        bundleDigest: null,
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

  /** Read the server-owned bundle for an Admin binding editor. */
  async listGovernedBindings(actor: CurrentUser, templateId: string, versionId: string) {
    const { version } = await this.requireConfigurationVersion(actor, templateId, versionId, false);
    const records = await this.bindings.listBindings(versionId);
    return Promise.all(records.map(async (record) => {
      const team = await this.bindings.findTeamVersion(record.teamVersionId);
      const configurationReady = record.status === 'active' && record.validation.valid && team?.enabled === true
        && (!requiresTeachingBundle(version.content) || Boolean(team.pblSpec.teamVersionPublication
          && record.bundleDigest && record.bundlePayload && teachingValueDigest(record.bundlePayload) === record.bundleDigest));
      const profile = record.bundlePayload?.template.curriculum?.profiles.find(profile => profile.id === record.bundlePayload?.scheduleProfileId);
      const teachingReadiness = {
        lessonCompletionReady: !!profile?.sessions.length && profile.sessions.every(hasLearningSessionCompletion),
        lessonSkillsDeclared: !!profile?.sessions.length && profile.sessions.every(session => !!session.requiredSkillIds?.length),
        knowledgeRequired: profile?.sessions.some(session => session.teachingRequirements?.includes('project_knowledge')) ?? false,
        knowledgeScopeDeclared: !!record.bundlePayload?.knowledgeGrant?.knowledgeBaseIds.length,
      };
      return { binding: { ...toBindingView(record), bundleDraft: structuredClone(record.bundleDraft) }, configurationReady,
        teachingReadiness,
        team: team ? { id: team.teamId, name: team.name, runtimeSnapshotStatus: team.pblSpec.teamVersionPublication ? 'published' : 'legacy_unpinned' } : null };
    }));
  }

  async getTeachingBundle(
    actor: CurrentUser,
    templateId: string,
    versionId: string,
    bindingId: string,
  ): Promise<{ binding: PblTemplateTeamBinding; draft: import('@qitu/contracts').TeachingBundleDraft | null; bundleDigest: string | null }> {
    await this.requireConfigurationVersion(actor, templateId, versionId, false);
    const binding = await this.requireBindingForVersion(bindingId, versionId);
    return { binding: toBindingView(binding), draft: binding.bundleDraft, bundleDigest: binding.bundleDigest ?? null };
  }

  async prepareTeachingBundle(actor: CurrentUser, templateId: string, versionId: string, bindingId: string,
    scheduleProfileId: string | undefined, key: string, phaseAssignments?: Readonly<Record<string, string>>): Promise<BindingMutationResult> {
    await this.requireConfigurationVersion(actor, templateId, versionId);
    const binding = await this.requireBindingForVersion(bindingId, versionId);
    if (binding.status !== 'draft') throw new ConflictException({ code: 'BINDING_DRAFT_REQUIRED', message: '请先保存新的团队绑定草稿。' });
    if (binding.bundleDraft) {
      if (scheduleProfileId && binding.bundleDraft.scheduleProfileId !== scheduleProfileId) {
        throw new ConflictException({ code: 'BUNDLE_PROFILE_CHANGED', message: '已有教学配置使用其他课时排期，请在高级配置中审核修改。' });
      }
      return { binding: toBindingView(binding), replayed: true };
    }
    const version = await this.templates.findVersion(versionId);
    const team = await this.bindings.findTeamVersion(binding.teamVersionId);
    if (!this.bundleCatalog || !version || !team) throw new BadRequestException({ code: 'BUNDLE_CATALOG_UNAVAILABLE', message: '教学配置目录不可用。' });
    const draft = this.bundleCatalog.prepareDraft(version, team, scheduleProfileId, phaseAssignments);
    return this.saveTeachingBundleDraft(actor, templateId, versionId, bindingId, draft, key);
  }

  /** Persist canonical draft references; resolution/compilation is attached by the server owner. */
  async saveTeachingBundleDraft(
    actor: CurrentUser,
    templateId: string,
    versionId: string,
    bindingId: string,
    draft: import('@qitu/contracts').TeachingBundleDraft,
    idempotencyKey: string,
  ): Promise<BindingMutationResult> {
    await this.requireConfigurationVersion(actor, templateId, versionId);
    const binding = await this.requireBindingForVersion(bindingId, versionId);
    if (binding.status !== 'draft') {
      throw new ConflictException({
        code: 'BINDING_DRAFT_REQUIRED',
        message: '只有 draft 绑定可以修改 Teaching Bundle 草稿',
      });
    }
    if (draft.templateVersionId !== versionId || draft.teamVersionId !== binding.teamVersionId) {
      throw new BadRequestException({
        code: 'BUNDLE_DRAFT_SCOPE_MISMATCH',
        message: 'Teaching Bundle 草稿必须引用当前模板版本和绑定团队版本',
      });
    }
    const teamVersion = await this.bindings.findTeamVersion(binding.teamVersionId);
    if (teamVersion === null) {
      throw new BadRequestException({ code: 'BINDING_INVALID', message: TEAM_VERSION_MISSING_MESSAGE });
    }
    const draftBindingHash = computeBindingHash(
      versionId,
      binding.teamVersionId,
      computePblSpecHash(teamVersion),
      null,
    );
    const scope = `admin.template-bundle.patch:${actor.id}:${bindingId}`;
    const requestHash = hashIdempotentInput(scope, { templateId, versionId, bindingId }, draft);
    const result = await this.executeIdempotent(scope, idempotencyKey, requestHash, async () => {
      const updated = await this.bindings.updateTeachingBundle(bindingId, {
        draft, payload: null, digest: null, bindingHash: draftBindingHash, now: new Date(),
      });
      await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'template.binding.bundle.save',
        targetType: 'project_template_version', targetId: versionId, idempotencyKey: `${scope}:${idempotencyKey}`,
        detail: { bindingId, teamVersionId: updated.teamVersionId, status: updated.status } });
      return { status: 200, body: { binding: toBindingView(updated), replayed: false } };
    });
    return result.replayed ? { ...result.body, replayed: true } : result.body;
  }

  /** Server-owner hook used after compileTeachingBundle resolves live catalogs. */
  async attachCompiledTeachingBundle(
    bindingId: string,
    versionId: string,
    compiled: import('./teaching-bundle.types').CompiledTeachingBundle,
  ): Promise<BindingMutationResult> {
    const current = await this.requireBindingForVersion(bindingId, versionId);
    if (current.status !== 'draft' || compiled.payload.templateVersionId !== versionId
      || compiled.payload.teamVersion.teamVersionId !== current.teamVersionId
      || teachingValueDigest(compiled.payload) !== compiled.digest) {
      throw new ConflictException({ code: 'BUNDLE_SCOPE_OR_DIGEST_INVALID', message: '教学配置版本或摘要不匹配' });
    }
    const teamVersion = await this.bindings.findTeamVersion(current.teamVersionId);
    if (teamVersion === null) throw new BadRequestException({ code: 'BINDING_INVALID', message: TEAM_VERSION_MISSING_MESSAGE });
    const bindingHash = computeBindingHash(
      versionId,
      current.teamVersionId,
      computePblSpecHash(teamVersion),
      compiled.digest,
    );
    const updated = await this.bindings.updateTeachingBundle(bindingId, {
      draft: current.bundleDraft ?? {
        templateVersionId: versionId, teamVersionId: current.teamVersionId,
        scheduleProfileId: compiled.payload.scheduleProfileId, roleMap: [], skillPins: [],
        toolIds: [], mcpServerIds: [], knowledgeBaseIds: [], modelByPurpose: {},
        approvalPolicyVersion: compiled.payload.approvalPolicyVersion,
      },
      payload: compiled.payload,
      digest: compiled.digest,
      bindingHash,
      now: new Date(),
      expectedUpdatedAt: current.updatedAt,
    });
    return { binding: toBindingView(updated), replayed: false };
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
      let current = await this.requireBindingForVersion(bindingId, versionId);
      // 已是 validated：视为幂等成功（不同 key 重复校验也返回当前状态）。
      const versionForBundle = await this.templates.findVersion(versionId);
      const bundleRequired = requiresTeachingBundle(versionForBundle?.content);
      if (bundleRequired && current.status === 'draft' && current.bundleDraft && this.bundleCatalog && versionForBundle) {
        const team = await this.bindings.findTeamVersion(current.teamVersionId);
        if (!team) throw new BadRequestException({ code: 'BINDING_INVALID', message: TEAM_VERSION_MISSING_MESSAGE });
        const compiled = await this.bundleCatalog.compile(versionForBundle, team, current.bundleDraft);
        current = await this.bindings.updateTeachingBundle(bindingId, {
          draft: current.bundleDraft, payload: compiled.payload, digest: compiled.digest,
          bindingHash: computeBindingHash(versionId, team.id, computePblSpecHash(team), compiled.digest),
          expectedUpdatedAt: current.updatedAt, now: new Date(),
        });
      }
      if (bundleRequired && current.bundlePayload && teachingValueDigest(current.bundlePayload) !== current.bundleDigest) {
        throw new ConflictException({ code: 'BUNDLE_DIGEST_MISMATCH', message: '教学配置摘要校验失败' });
      }
      if (current.status === 'validated') {
        if (bundleRequired && (!current.bundleDigest || current.bundlePayload === null)) {
          throw new BadRequestException({
            code: 'BUNDLE_COMPILATION_UNAVAILABLE',
            message: 'Teaching Bundle 尚未完成服务端编译，不能进入 validated',
          });
        }
        return { status: 200, body: { binding: toBindingView(current), replayed: true } };
      }
      assertBindingStatusTransition(current.status, 'validated', PBL_BINDING_STATUS_TRANSITIONS);

      // A draft is intentionally only a set of canonical references. Until a
      // server-owned compiler has resolved the live catalogs and persisted both
      // payload and digest, validation must fail closed rather than treating a
      // team-only validation as a usable Teaching Bundle.
      if (bundleRequired && (!current.bundleDigest || current.bundlePayload === null)) {
        throw new BadRequestException({
          code: 'BUNDLE_COMPILATION_UNAVAILABLE',
          message: 'Teaching Bundle 尚未完成服务端编译，不能进入 validated',
        });
      }

      const teamVersion = await this.bindings.findTeamVersion(current.teamVersionId);
      if (teamVersion === null) {
        throw new BadRequestException({
          code: 'BINDING_INVALID',
          message: TEAM_VERSION_MISSING_MESSAGE,
        });
      }
      const validation = computeBindingValidation(teamVersion);
      const now = new Date();
      const stamped = await this.bindings.updateValidation(bindingId, validation, now, current.updatedAt);

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

      const validated = await this.bindings.setStatus(bindingId, 'validated', now, stamped.updatedAt);
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

      const version = await this.templates.findVersion(versionId);
      if (requiresTeachingBundle(version?.content)) {
        const team = await this.bindings.findTeamVersion(current.teamVersionId);
        if (!version || !team || !current.bundleDraft || !current.bundlePayload || !this.bundleCatalog) {
          throw new BadRequestException({ code: 'BUNDLE_COMPILATION_UNAVAILABLE', message: '教学配置尚未完成编译' });
        }
        const compiled = await this.bundleCatalog.compile(version, team, current.bundleDraft);
        if (compiled.digest !== current.bundleDigest || teachingValueDigest(current.bundlePayload) !== current.bundleDigest) {
          throw new ConflictException({ code: 'BUNDLE_CATALOG_CHANGED', message: '教学目录已变化，请创建新绑定并重新校验' });
        }
      }

      const now = new Date();
      const activated = await this.bindings.activateBinding(versionId, bindingId, now, current.updatedAt);
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
    const templateVersion = await this.templates.findVersion(input.templateVersionId);
    if (requiresTeachingBundle(templateVersion?.content) && (!binding.bundleDigest || !binding.bundlePayload
      || teachingValueDigest(binding.bundlePayload) !== binding.bundleDigest)) {
      throw new ConflictException({
        code: 'PROJECT_TEACHING_BUNDLE_UNAVAILABLE',
        message: '该 PBL 模板的 active binding 缺少已校验的 Teaching Bundle',
      });
    }
    await this.bindings.insertSnapshot(
      {
        projectId: input.projectId,
        templateVersionId: input.templateVersionId,
        bindingId: binding.id,
        teamVersionId: binding.teamVersionId,
        bindingHash: binding.bindingHash,
        bundleDigest: binding.bundleDigest ?? null,
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
    tx?: AuditTransaction,
  ): Promise<ProjectBindingSnapshot | null> {
    if (templateVersionId === null) return null;
    const snapshot = await this.bindings.findSnapshot(projectId, tx);
    if (snapshot === null || snapshot.backfilled || snapshot.projectId !== projectId
      || snapshot.templateVersionId !== templateVersionId) return null;
    const binding = await this.bindings.findBinding(snapshot.bindingId, tx);
    if (binding === null || binding.templateVersionId !== templateVersionId
      || binding.teamVersionId !== snapshot.teamVersionId
      || binding.bindingHash !== snapshot.bindingHash
      || (binding.bundleDigest ?? null) !== (snapshot.bundleDigest ?? null)) return null;
    const templateVersion = await this.templates.findVersion(templateVersionId);
    if (requiresTeachingBundle(templateVersion?.content) && (!snapshot.bundleDigest || !binding.bundlePayload
      || teachingValueDigest(binding.bundlePayload) !== snapshot.bundleDigest)) return null;
    return toSnapshotView(snapshot);
  }

  /** Preview authority only. This never freezes a project or grants project knowledge access. */
  async getExplorationBinding(studentId: string, templateVersionId: string) {
    const schoolId = await this.directory.findSchoolId(studentId);
    const version = await this.templates.findVersion(templateVersionId);
    const visible = await this.templates.listTemplates({ visibleToSchoolId: schoolId });
    const template = visible.find((entry) => entry.id === version?.templateId);
    if (!template || !version || !['published', 'piloting'].includes(template.status)
      || !['published', 'piloting'].includes(version.status)) {
      throw new NotFoundException('该课程模板当前不可用于探索');
    }
    const binding = await this.bindings.findActiveBinding(templateVersionId);
    const team = binding ? await this.bindings.findTeamVersion(binding.teamVersionId) : null;
    const payload = binding?.bundlePayload ?? null;
    const ready = binding?.validation.valid && team?.enabled && team.pblSpec.teamVersionPublication
      && (!requiresTeachingBundle(version.content) || (payload && binding.bundleDigest
        && teachingValueDigest(payload) === binding.bundleDigest));
    return { title: template.title, content: version.content,
      binding: ready ? binding : null, bundle: ready ? payload : null };
  }

  async getFrozenTeachingBundle(projectId: string, templateVersionId: string, tx?: AuditTransaction) {
    const snapshot = await this.findFrozenSnapshotForProject(projectId, templateVersionId, tx);
    const binding = snapshot ? await this.bindings.findBinding(snapshot.bindingId, tx) : null;
    if (!binding?.bundlePayload || teachingValueDigest(binding.bundlePayload) !== snapshot?.bundleDigest) {
      throw new ConflictException({ code: 'PROJECT_TEACHING_BUNDLE_UNAVAILABLE', message: '项目缺少可核验的冻结教学配置' });
    }
    return binding.bundlePayload;
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
      bundleDigest: active.bundleDigest ?? null,
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

  private async requireConfigurationVersion(actor: CurrentUser, templateId: string, versionId: string, write = true) {
    const template = await this.templates.findTemplate(templateId);
    if (!template) throw templateNotFound();
    assertCanGovernTemplate(actor, template, await this.directory.findSchoolId(actor.id));
    const version = await this.templates.findVersion(versionId);
    if (!version || version.templateId !== templateId) throw versionNotFound();
    if (write && (template.status === 'archived' || version.status === 'archived')) throw new ConflictException({ code: 'BINDING_ARCHIVED', message: '已归档版本不能修改团队配置' });
    return { templateId, versionId, version };
  }

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
    bundleDigest: record.bundleDigest ?? null,
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
    bundleDigest: record.bundleDigest ?? null,
    boundAt: record.boundAt.toISOString(),
    backfilled: record.backfilled,
  };
}

function requiresTeachingBundle(content: unknown): boolean {
  return content !== null && typeof content === 'object' && !Array.isArray(content)
    && 'pbl' in content;
}

function normalizeReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length === 0 ? null : value.slice(0, 500);
}
