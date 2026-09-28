import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { AuditWriter } from '../../common/audit/audit.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import {
  TemplateEvidenceSource,
  TemplateViewerDirectory,
} from './template-evidence.store';
import { evaluateTemplateVerification } from './template-verification.evaluator';
import {
  newVerificationRunId,
  type TemplateVerificationStore,
  type VerificationRunRecord,
} from './template-verification.store';
import {
  assertCanGovernTemplate,
  assertTemplateStatusTransition,
  resolveTemplateCreationScope,
} from './templates.policy';
import {
  TemplateStore,
  TemplateStoreConflictError,
  newTemplateId,
  newTemplateVersionId,
} from './templates.store';
import {
  latestPublishedVersionId,
  templateNotFound,
  toTemplateVersionView,
  toTemplateView,
  versionNotFound,
} from './templates.view';
import type {
  CreateTemplateInput,
  CreateTemplateVersionInput,
  ProjectTemplateRecord,
  ProjectTemplateVersionRecord,
  TemplateStage,
  TemplateView,
  TemplateVersionView,
  UpdateTemplateInput,
  VerificationEvidence,
  VerificationReport,
} from './templates.types';

export interface TemplateMutationResult {
  template: TemplateView;
  replayed: boolean;
}

export interface VersionMutationResult {
  template: TemplateView;
  version: TemplateVersionView;
  replayed: boolean;
}

export interface PublishVersionResult extends VersionMutationResult {
  report: VerificationReport;
}

export interface VerifyVersionResult {
  report: VerificationReport;
  replayed: boolean;
}

const MAX_SLUG_LENGTH = 64;
const MAX_TITLE_LENGTH = 120;
const MAX_SUMMARY_LENGTH = 400;
const MAX_STAGE_COUNT = 12;
const MAX_STAGE_LABEL_LENGTH = 40;
const MAX_LIST_ITEMS = 40;
const MAX_LIST_ITEM_LENGTH = 200;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 模板治理写服务（Admin / 授权教职工）。
 *
 * 硬约束：
 * 1. **对象级授权**：每个写操作先解析主体学校，再 `assertCanGovernTemplate`；
 *    admin 管平台 + 全校，teacher 只管本校，其余 403。
 * 2. **每次写操作都要求幂等键**：scope 绑定 `主体 + 目标对象`，同键同载荷重放，
 *    同键异载荷 409；唯一索引（slug / version）兜底并发。
 * 3. **发布不可变**：版本正文只在创建时写一次；`publish` 只做状态迁移，且
 *    **必须**先跑确定性验证评测并通过，客户端无法用请求体绕过。
 * 4. **审计**：create / update / version.create / verify / publish / archive /
 *    rollback 都写 `AuditWriter`（携带 actor、target、reason）。
 * 5. **回滚即新版本**：回滚复制历史版本正文为**新** draft 版本，绝不原地改写。
 */
@Injectable()
export class TemplateGovernanceService {
  private readonly logger = new Logger(TemplateGovernanceService.name);

  constructor(
    private readonly store: TemplateStore,
    private readonly evidence: TemplateEvidenceSource,
    private readonly verification: TemplateVerificationStore,
    private readonly directory: TemplateViewerDirectory,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditWriter,
  ) {}

  /* ============================ 列表与详情 ============================ */

  async listGovernedTemplates(actor: CurrentUser): Promise<TemplateView[]> {
    const actorSchoolId = await this.directory.findSchoolId(actor.id);
    const records =
      actor.role === 'admin'
        ? await this.store.listTemplates({})
        : await this.store.listTemplates({ visibleToSchoolId: actorSchoolId });
    return Promise.all(records.map((record) => this.project(record)));
  }

  /* ============================ 模板主体 ============================ */

  async createTemplate(
    actor: CurrentUser,
    input: CreateTemplateInput,
    idempotencyKey: string,
  ): Promise<TemplateMutationResult> {
    const actorSchoolId = await this.directory.findSchoolId(actor.id);
    const normalized = normalizeCreateInput(input);
    const schoolId = resolveTemplateCreationScope(actor, normalized.schoolId, actorSchoolId);

    const scope = `template.create:${actor.id}`;
    const requestHash = hashIdempotentInput(scope, {}, { ...normalized, schoolId });

    const result = await this.executeIdempotent(scope, idempotencyKey, requestHash, async () => {
      const now = new Date();
      const record = await this.store.createTemplate({
        ...normalized,
        schoolId,
        id: newTemplateId(),
        createdBy: actor.id,
        now,
      });
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'template.create',
        targetType: 'project_template',
        targetId: record.id,
        idempotencyKey: `${scope}:${idempotencyKey}`,
        detail: { schoolId, slug: record.slug },
      });
      this.logger.log(`创建模板 id=${record.id} school=${schoolId ?? 'platform'}`);
      return { status: 201, body: { template: await this.project(record), replayed: false } };
    });

    return result.replayed ? { ...result.body, replayed: true } : result.body;
  }

  async updateTemplate(
    actor: CurrentUser,
    templateId: string,
    patch: UpdateTemplateInput,
    idempotencyKey: string,
  ): Promise<TemplateMutationResult> {
    const { template, actorSchoolId } = await this.requireGovernableTemplate(actor, templateId);
    if (template.status === 'published' || template.status === 'archived') {
      throw new ConflictException({
        code: 'TEMPLATE_TRANSITION_INVALID',
        message: `${template.status} 状态的模板不可编辑，请创建新版本`,
      });
    }
    const normalized = normalizeUpdateInput(patch);
    const scope = `template.update:${actor.id}:${templateId}`;
    const requestHash = hashIdempotentInput(scope, { templateId }, normalized);

    const result = await this.executeIdempotent(scope, idempotencyKey, requestHash, async () => {
      const now = new Date();
      const updated = await this.store.updateTemplate(templateId, normalized, now);
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'template.update',
        targetType: 'project_template',
        targetId: templateId,
        idempotencyKey: `${scope}:${idempotencyKey}`,
        detail: { schoolId: template.schoolId, patch: normalized },
      });
      return { status: 200, body: { template: await this.project(updated), replayed: false } };
    });

    return result.replayed ? { ...result.body, replayed: true } : result.body;
  }

  async archiveTemplate(
    actor: CurrentUser,
    templateId: string,
    idempotencyKey: string,
    reason: string | null,
  ): Promise<TemplateMutationResult> {
    const { template } = await this.requireGovernableTemplate(actor, templateId);
    const scope = `template.archive:${actor.id}:${templateId}`;
    const requestHash = hashIdempotentInput(scope, { templateId }, { reason });

    const result = await this.executeIdempotent(scope, idempotencyKey, requestHash, async () => {
      // 已是 archived：视为幂等成功，返回当前状态，不再迁移。
      if (template.status === 'archived') {
        return { status: 200, body: { template: await this.project(template), replayed: true } };
      }
      assertTemplateStatusTransition(template.status, 'archived');
      const now = new Date();
      const archived = await this.store.setTemplateStatus(templateId, 'archived', null, null, now);
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'template.archive',
        targetType: 'project_template',
        targetId: templateId,
        idempotencyKey: `${scope}:${idempotencyKey}`,
        reason,
        detail: { from: template.status },
      });
      return { status: 200, body: { template: await this.project(archived), replayed: false } };
    });

    return result.replayed ? { ...result.body, replayed: true } : result.body;
  }

  /* ============================ 版本 ============================ */

  async createVersion(
    actor: CurrentUser,
    templateId: string,
    input: CreateTemplateVersionInput,
    idempotencyKey: string,
  ): Promise<VersionMutationResult> {
    const { template } = await this.requireGovernableTemplate(actor, templateId);
    if (template.status === 'archived') {
      throw new ConflictException({
        code: 'TEMPLATE_TRANSITION_INVALID',
        message: '已归档模板不能创建新版本',
      });
    }
    const normalized = normalizeVersionInput(input);
    const scope = `template.version.create:${actor.id}:${templateId}`;
    const requestHash = hashIdempotentInput(scope, { templateId }, normalized);

    const result = await this.executeIdempotent(scope, idempotencyKey, requestHash, async () => {
      const now = new Date();
      const versionLabel = await this.store.nextVersionLabel(templateId);
      const version = await this.store.createVersion({
        ...normalized,
        id: newTemplateVersionId(),
        templateId,
        version: versionLabel,
        createdBy: actor.id,
        now,
      });
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'template.version.create',
        targetType: 'project_template_version',
        targetId: version.id,
        idempotencyKey: `${scope}:${idempotencyKey}`,
        detail: { templateId, version: version.version, stageCount: version.stages.length },
      });
      return {
        status: 201,
        body: {
          template: await this.project(template),
          version: toTemplateVersionView(version),
          replayed: false,
        },
      };
    });

    return result.replayed ? { ...result.body, replayed: true } : result.body;
  }

  /**
   * 运行确定性验证评测并写审计。**不改变任何状态**；发布是另一个动作。
   *
   * 幂等语义让「同 key 重放」返回同一份证据报告，便于治理端审阅留痕。
   */
  async verifyVersion(
    actor: CurrentUser,
    templateId: string,
    versionId: string,
    idempotencyKey: string,
  ): Promise<VerifyVersionResult> {
    const { template } = await this.requireGovernableVersion(actor, templateId, versionId);
    const scope = `template.version.verify:${actor.id}:${versionId}`;
    const runKey = `${scope}:${idempotencyKey}`;
    const requestHash = hashIdempotentInput(scope, { templateId, versionId }, {});

    const result = await this.executeIdempotent(scope, idempotencyKey, requestHash, async () => {
      // 进程重启后幂等缓存丢失时，以持久化 run 为准回放同一份报告。
      const replayedRun = await this.verification.findByIdempotencyKey(runKey);
      if (replayedRun !== null) {
        return { status: 200, body: { report: replayedRun.report, replayed: true } };
      }
      const evaluatedAt = new Date();
      const evidence = await this.evidence.collect(versionId);
      const report = evaluateTemplateVerification(evidence, evaluatedAt);
      const run = await this.recordVerification(
        actor,
        template,
        versionId,
        report,
        evidence,
        runKey,
        evaluatedAt,
      );
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'template.version.verify',
        targetType: 'project_template_version',
        targetId: versionId,
        idempotencyKey: runKey,
        detail: {
          templateId,
          runId: run.id,
          passed: run.report.passed,
          checks: run.report.checks,
          evidenceRefs: run.report.evidenceRefs,
          evidenceCount: run.evidenceCount,
        },
      });
      return { status: 200, body: { report: run.report, replayed: false } };
    });

    return result.replayed ? { ...result.body, replayed: true } : result.body;
  }

  /**
   * 发布版本：**服务端**先评测，未通过则 409（附带证据报告），通过才迁移状态。
   *
   * 不可变性：发布只写 `status` / `published_at`（以及模板的 verified_by/at），
   * 版本正文不提供任何更新路径。重复发布（不同 key）按已发布幂等返回。
   */
  async publishVersion(
    actor: CurrentUser,
    templateId: string,
    versionId: string,
    idempotencyKey: string,
    reason: string | null,
  ): Promise<PublishVersionResult> {
    const { template, version } = await this.requireGovernableVersion(actor, templateId, versionId);
    const scope = `template.version.publish:${actor.id}:${versionId}`;
    const runKey = `${scope}:${idempotencyKey}`;
    const requestHash = hashIdempotentInput(scope, { templateId, versionId }, { reason });

    const result = await this.executeIdempotent(scope, idempotencyKey, requestHash, async () => {
      const evaluatedAt = new Date();
      const evidence = await this.evidence.collect(versionId);
      const report = evaluateTemplateVerification(evidence, evaluatedAt);

      if (version.status === 'published') {
        const run = report.passed
          ? await this.recordVerification(
              actor,
              template,
              versionId,
              report,
              evidence,
              runKey,
              evaluatedAt,
            )
          : null;
        return {
          status: 200,
          body: {
            template: await this.project(template),
            version: toTemplateVersionView(version),
            report: run?.report ?? report,
            replayed: true,
          },
        };
      }

      assertTemplateStatusTransition(version.status, 'published');
      if (!report.passed) {
        // 未通过时**不落 run**，保证修正证据后同键重试仍可发布。
        throw new ConflictException({
          code: 'TEMPLATE_VERIFICATION_INCOMPLETE',
          message: '模板验证未通过：项目完成 / 理论掌握 / 实践掌握 / 作品通过 / 班主任复核必须全部满足',
          report,
        });
      }

      // 通过后先落不可变 run，再迁移状态：报告与晋升结果同源。
      const run = await this.recordVerification(
        actor,
        template,
        versionId,
        report,
        evidence,
        runKey,
        evaluatedAt,
      );

      const published = await this.store.setVersionStatus(versionId, 'published', evaluatedAt, evaluatedAt);
      const publishedTemplate = await this.store.setTemplateStatus(
        templateId,
        'published',
        actor.id,
        evaluatedAt,
        evaluatedAt,
      );
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'template.version.publish',
        targetType: 'project_template_version',
        targetId: versionId,
        idempotencyKey: runKey,
        reason,
        detail: {
          templateId,
          version: published.version,
          runId: run.id,
          evidenceRefs: run.report.evidenceRefs,
          evidenceCount: run.evidenceCount,
        },
      });
      this.logger.log(`发布模板版本 template=${templateId} version=${published.version}`);
      return {
        status: 200,
        body: {
          template: await this.project(publishedTemplate),
          version: toTemplateVersionView(published),
          report: run.report,
          replayed: false,
        },
      };
    });

    return result.replayed ? { ...result.body, replayed: true } : result.body;
  }

  /**
   * 回滚：把历史版本的正文复制成**新** draft 版本，绝不原地改写历史版本。
   */
  async rollbackTemplate(
    actor: CurrentUser,
    templateId: string,
    sourceVersionId: string,
    idempotencyKey: string,
    reason: string | null,
  ): Promise<VersionMutationResult> {
    const { template, version: source } = await this.requireGovernableVersion(
      actor,
      templateId,
      sourceVersionId,
    );
    if (template.status === 'archived') {
      throw new ConflictException({
        code: 'TEMPLATE_TRANSITION_INVALID',
        message: '已归档模板不能回滚',
      });
    }
    const scope = `template.rollback:${actor.id}:${templateId}:${sourceVersionId}`;
    const requestHash = hashIdempotentInput(scope, { templateId, sourceVersionId }, { reason });

    const result = await this.executeIdempotent(scope, idempotencyKey, requestHash, async () => {
      const now = new Date();
      const versionLabel = await this.store.nextVersionLabel(templateId);
      const created = await this.store.createVersion({
        id: newTemplateVersionId(),
        templateId,
        version: versionLabel,
        stages: source.stages,
        content: source.content,
        rubric: source.rubric,
        createdBy: actor.id,
        now,
      });
      await this.audit.write({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'template.rollback',
        targetType: 'project_template_version',
        targetId: created.id,
        idempotencyKey: `${scope}:${idempotencyKey}`,
        reason,
        detail: {
          templateId,
          sourceVersionId,
          sourceVersion: source.version,
          newVersion: created.version,
        },
      });
      return {
        status: 201,
        body: {
          template: await this.project(template),
          version: toTemplateVersionView(created),
          replayed: false,
        },
      };
    });

    return result.replayed ? { ...result.body, replayed: true } : result.body;
  }

  /* ============================ 内部 ============================ */

  /**
   * 只在通过评测时落 run：未通过不写，保证修正证据后同键重试仍可发布。
   * 持久层按 `idempotencyKey` 唯一，重启后重放不会产生第二条。
   */
  private async recordVerification(
    actor: CurrentUser,
    template: ProjectTemplateRecord,
    templateVersionId: string,
    report: VerificationReport,
    evidence: VerificationEvidence,
    idempotencyKey: string,
    evaluatedAt: Date,
  ): Promise<VerificationRunRecord> {
    const recorded = await this.verification.record({
      id: newVerificationRunId(),
      schoolId: template.schoolId,
      templateVersionId,
      report,
      evidence,
      evaluatedBy: actor.id,
      idempotencyKey,
      evaluatedAt,
    });
    return recorded.run;
  }

  private async requireGovernableTemplate(
    actor: CurrentUser,
    templateId: string,
  ): Promise<{ template: ProjectTemplateRecord; actorSchoolId: string | null }> {
    const template = await this.store.findTemplate(templateId);
    if (template === null) throw templateNotFound();
    const actorSchoolId = await this.directory.findSchoolId(actor.id);
    assertCanGovernTemplate(actor, template, actorSchoolId);
    return { template, actorSchoolId };
  }

  private async requireGovernableVersion(
    actor: CurrentUser,
    templateId: string,
    versionId: string,
  ): Promise<{
    template: ProjectTemplateRecord;
    version: ProjectTemplateVersionRecord;
    actorSchoolId: string | null;
  }> {
    const { template, actorSchoolId } = await this.requireGovernableTemplate(actor, templateId);
    const version = await this.store.findVersion(versionId);
    if (version === null || version.templateId !== templateId) throw versionNotFound();
    return { template, version, actorSchoolId };
  }

  private async project(record: ProjectTemplateRecord): Promise<TemplateView> {
    const versions = await this.store.listVersions(record.id);
    return toTemplateView(record, latestPublishedVersionId(versions));
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
      if (error instanceof TemplateStoreConflictError) {
        throw new ConflictException({
          code: 'TEMPLATE_CONFLICT',
          message: error.message,
        });
      }
      throwHttpForIdempotencyError(error);
    }
  }
}

/* ============================ 校验（纯函数） ============================ */

function normalizeCreateInput(input: CreateTemplateInput): CreateTemplateInput {
  return {
    schoolId: input.schoolId ?? null,
    slug: assertSlug(input.slug),
    title: assertText(input.title, 'title', MAX_TITLE_LENGTH),
    summary: assertText(input.summary, 'summary', MAX_SUMMARY_LENGTH),
    domain: assertOptionalText(input.domain, 'domain', 80),
    ageRange: assertOptionalText(input.ageRange, 'ageRange', 40),
    difficulty: assertOptionalText(input.difficulty, 'difficulty', 40),
    estimatedDurationMinutes: assertOptionalDuration(input.estimatedDurationMinutes),
    requiredMaterials: assertStringList(input.requiredMaterials, 'requiredMaterials'),
    learningObjectives: assertStringList(input.learningObjectives, 'learningObjectives'),
    outcomeForm: assertOptionalText(input.outcomeForm, 'outcomeForm', 120),
    safetyNotes: assertOptionalText(input.safetyNotes, 'safetyNotes', 1000),
  };
}

function normalizeUpdateInput(input: UpdateTemplateInput): UpdateTemplateInput {
  const out: UpdateTemplateInput = {};
  if (input.title !== undefined) out.title = assertText(input.title, 'title', MAX_TITLE_LENGTH);
  if (input.summary !== undefined) {
    out.summary = assertText(input.summary, 'summary', MAX_SUMMARY_LENGTH);
  }
  if (input.domain !== undefined) out.domain = assertOptionalText(input.domain, 'domain', 80);
  if (input.ageRange !== undefined) {
    out.ageRange = assertOptionalText(input.ageRange, 'ageRange', 40);
  }
  if (input.difficulty !== undefined) {
    out.difficulty = assertOptionalText(input.difficulty, 'difficulty', 40);
  }
  if (input.estimatedDurationMinutes !== undefined) {
    out.estimatedDurationMinutes = assertOptionalDuration(input.estimatedDurationMinutes);
  }
  if (input.requiredMaterials !== undefined) {
    out.requiredMaterials = assertStringList(input.requiredMaterials, 'requiredMaterials');
  }
  if (input.learningObjectives !== undefined) {
    out.learningObjectives = assertStringList(input.learningObjectives, 'learningObjectives');
  }
  if (input.outcomeForm !== undefined) {
    out.outcomeForm = assertOptionalText(input.outcomeForm, 'outcomeForm', 120);
  }
  if (input.safetyNotes !== undefined) {
    out.safetyNotes = assertOptionalText(input.safetyNotes, 'safetyNotes', 1000);
  }
  if (Object.keys(out).length === 0) {
    throw new BadRequestException({
      code: 'TEMPLATE_INPUT_INVALID',
      message: 'PATCH 至少需要一个可更新字段',
    });
  }
  return out;
}

function normalizeVersionInput(input: CreateTemplateVersionInput): CreateTemplateVersionInput {
  const stages = assertStages(input.stages);
  const content = input.content ?? {};
  if (content === null || typeof content !== 'object' || Array.isArray(content)) {
    throw new BadRequestException({
      code: 'TEMPLATE_INPUT_INVALID',
      message: 'content 必须为对象',
    });
  }
  const rubric = input.rubric ?? [];
  if (!Array.isArray(rubric)) {
    throw new BadRequestException({
      code: 'TEMPLATE_INPUT_INVALID',
      message: 'rubric 必须为数组',
    });
  }
  return { stages, content, rubric };
}

function assertSlug(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new BadRequestException({ code: 'TEMPLATE_INPUT_INVALID', message: 'slug 必须为字符串' });
  }
  const slug = raw.trim();
  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
    throw new BadRequestException({
      code: 'TEMPLATE_INPUT_INVALID',
      message: `slug 必须为小写字母 / 数字 / 连字符，且不超过 ${MAX_SLUG_LENGTH} 字符`,
    });
  }
  return slug;
}

function assertText(raw: unknown, label: string, max: number): string {
  if (typeof raw !== 'string') {
    throw new BadRequestException({ code: 'TEMPLATE_INPUT_INVALID', message: `${label} 必须为字符串` });
  }
  const value = raw.trim();
  if (value.length === 0 || value.length > max) {
    throw new BadRequestException({
      code: 'TEMPLATE_INPUT_INVALID',
      message: `${label} 不能为空且不超过 ${max} 字符`,
    });
  }
  return value;
}

function assertOptionalText(raw: unknown, label: string, max: number): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') {
    throw new BadRequestException({ code: 'TEMPLATE_INPUT_INVALID', message: `${label} 必须为字符串` });
  }
  const value = raw.trim();
  if (value.length === 0) return null;
  if (value.length > max) {
    throw new BadRequestException({
      code: 'TEMPLATE_INPUT_INVALID',
      message: `${label} 不超过 ${max} 字符`,
    });
  }
  return value;
}

function assertOptionalDuration(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0 || raw > 10_000) {
    throw new BadRequestException({
      code: 'TEMPLATE_INPUT_INVALID',
      message: 'estimatedDurationMinutes 必须为正整数（分钟）',
    });
  }
  return raw;
}

function assertStringList(raw: unknown, label: string): string[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new BadRequestException({
      code: 'TEMPLATE_INPUT_INVALID',
      message: `${label} 必须为字符串数组`,
    });
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new BadRequestException({
        code: 'TEMPLATE_INPUT_INVALID',
        message: `${label} 必须为字符串数组`,
      });
    }
    const value = item.trim();
    if (value.length === 0) continue;
    if (value.length > MAX_LIST_ITEM_LENGTH) {
      throw new BadRequestException({
        code: 'TEMPLATE_INPUT_INVALID',
        message: `${label} 单项不超过 ${MAX_LIST_ITEM_LENGTH} 字符`,
      });
    }
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  if (out.length > MAX_LIST_ITEMS) {
    throw new BadRequestException({
      code: 'TEMPLATE_INPUT_INVALID',
      message: `${label} 最多 ${MAX_LIST_ITEMS} 项`,
    });
  }
  return out;
}

/** 阶段定义随版本冻结；校验数量 / 唯一性 / 非空，避免前端塞入全局常量。 */
function assertStages(raw: unknown): TemplateStage[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BadRequestException({
      code: 'TEMPLATE_INPUT_INVALID',
      message: 'stages 必须为非空数组',
    });
  }
  if (raw.length > MAX_STAGE_COUNT) {
    throw new BadRequestException({
      code: 'TEMPLATE_INPUT_INVALID',
      message: `stages 最多 ${MAX_STAGE_COUNT} 个`,
    });
  }
  const seen = new Set<string>();
  const stages: TemplateStage[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') {
      throw new BadRequestException({
        code: 'TEMPLATE_INPUT_INVALID',
        message: 'stages 每项必须为 { id, label }',
      });
    }
    const stage = item as { id?: unknown; label?: unknown };
    const id = typeof stage.id === 'string' ? stage.id.trim() : '';
    const label = typeof stage.label === 'string' ? stage.label.trim() : '';
    if (id.length === 0 || label.length === 0 || label.length > MAX_STAGE_LABEL_LENGTH) {
      throw new BadRequestException({
        code: 'TEMPLATE_INPUT_INVALID',
        message: `stages 每项 id/label 非空，label 不超过 ${MAX_STAGE_LABEL_LENGTH} 字符`,
      });
    }
    if (seen.has(id)) {
      throw new BadRequestException({
        code: 'TEMPLATE_INPUT_INVALID',
        message: `stages id 重复：${id}`,
      });
    }
    seen.add(id);
    stages.push({ id, label });
  }
  return stages;
}
