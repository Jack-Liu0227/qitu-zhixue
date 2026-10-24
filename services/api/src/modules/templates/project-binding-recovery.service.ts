import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { AdminProjectBindingRecovery, AdminProjectBindingReconfirmation, CurrentUser } from '@qitu/contracts';
import type { Database } from '@qitu/database';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter, type AuditTransaction } from '../../common/audit/audit.service';
import { IdempotencyStore } from '../../common/idempotency/idempotency.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { throwHttpForIdempotencyError } from '../../common/idempotency/idempotency.errors';
import { TemplateBindingStore, TemplateBindingStoreConflictError } from './templates-binding.store';
import { TemplateBindingService } from './templates-binding.service';
import { TemplateStore } from './templates.store';
import { TemplateViewerDirectory } from './template-evidence.store';
import { assertCanGovernTemplate } from './templates.policy';
import { TeachingBundleCatalog } from './teaching-bundle.catalog';
import { teachingValueDigest } from './teaching-bundle.canonical';
import { teamVersionView } from '../platform-registry/teaching-team-capture.service';

@Injectable()
export class ProjectBindingRecoveryService {
  constructor(private readonly templates: TemplateStore, private readonly directory: TemplateViewerDirectory,
    private readonly store: TemplateBindingStore, private readonly bindings: TemplateBindingService,
    private readonly audit: AuditWriter, private readonly idempotency: IdempotencyStore,
    private readonly catalog: TeachingBundleCatalog, @Optional() @Inject(DATABASE_TOKEN) private readonly db: Database | null = null) {}

  private async authorize(actor: CurrentUser, templateId: string, versionId: string) {
    if (actor.role !== 'admin') throw new ForbiddenException('历史项目绑定修复仅限管理员。');
    const template = await this.templates.findTemplate(templateId);
    const version = await this.templates.findVersion(versionId);
    if (!template || !version || version.templateId !== templateId) throw new NotFoundException('模板版本不存在');
    assertCanGovernTemplate(actor, template, await this.directory.findSchoolId(actor.id));
    return { template, version };
  }

  async preview(actor: CurrentUser, templateId: string, versionId: string): Promise<AdminProjectBindingRecovery[]> {
    await this.authorize(actor, templateId, versionId);
    const projects = await this.store.listAffectedProjects(versionId);
    const result: AdminProjectBindingRecovery[] = [];
    for (const project of projects) {
      const snapshot = await this.store.findSnapshot(project.projectId);
      const frozen = await this.bindings.findFrozenSnapshotForProject(project.projectId, versionId);
      result.push({ projectId: project.projectId, state: frozen ? 'ready' : snapshot === null ? 'missing'
        : snapshot.templateVersionId !== versionId ? 'invalid'
        : snapshot.backfilled || snapshot.bundleDigest === null ? 'legacy' : 'invalid' });
    }
    return result;
  }

  async reconfirm(actor: CurrentUser, templateId: string, versionId: string, bindingId: string, projectId: string,
    reason: string, key: string): Promise<AdminProjectBindingReconfirmation> {
    const { template, version } = await this.authorize(actor, templateId, versionId);
    if (template.status === 'archived' || !['published', 'piloting'].includes(version.status)) {
      throw new ConflictException({ code: 'PROJECT_BINDING_VERSION_UNAVAILABLE', message: '只能使用已发布或试点中的课程版本修复。' });
    }
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 200) throw new BadRequestException('请填写 200 字以内的修复原因。');
    const project = (await this.store.listAffectedProjects(versionId)).find((entry) => entry.projectId === projectId);
    if (!project) throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', message: '项目不属于该模板版本。' });
    // This is template-scoped configuration maintenance. No individual learner content is returned.
    const scope = `admin.project-binding.reconfirm:${actor.id}:${projectId}`;
    try {
      const result = await this.idempotency.execute(scope, key,
        hashIdempotentInput(scope, { templateId, versionId, bindingId, projectId }, { reason: reason.trim() }), async () => {
          const perform = async (tx?: AuditTransaction) => {
            const target = await this.store.findActiveBinding(versionId, tx);
            if (!target || target.id !== bindingId || !target.validation.valid) {
              throw new ConflictException({ code: 'PROJECT_BINDING_CHANGED', message: '生效绑定已变化，请重新读取并确认。' });
            }
            const team = await this.store.findTeamVersion(target.teamVersionId, target.id);
            if (!target.bundleDraft || !target.bundlePayload || !target.bundleDigest || !team
              || teamVersionView(team).runtimeSnapshotStatus !== 'published') {
              throw new ConflictException({ code: 'PROJECT_TEACHING_BUNDLE_UNAVAILABLE', message: '请先发布团队、生成教学配置并校验启用绑定。' });
            }
            const compiled = await this.catalog.compile(version, team, target.bundleDraft);
            if (compiled.digest !== target.bundleDigest || teachingValueDigest(target.bundlePayload) !== target.bundleDigest) throw new ConflictException({ code: 'BUNDLE_CATALOG_CHANGED', message: '教学配置已变化，请重新审核绑定。' });
            const previous = await this.store.findSnapshot(projectId, tx);
            const frozen = await this.bindings.findFrozenSnapshotForProject(projectId, versionId, tx);
            if (frozen) {
              if (frozen.bindingId !== bindingId) throw new ConflictException({ code: 'PROJECT_BINDING_ALREADY_FROZEN', message: '项目已有有效冻结绑定，不能覆盖。' });
              return { projectId, snapshot: frozen, replayed: true };
            }
            if (previous && (previous.templateVersionId !== versionId || !previous.backfilled && previous.bundleDigest !== null)) {
              throw new ConflictException({ code: 'PROJECT_BINDING_REVIEW_REQUIRED', message: '项目冻结配置异常，需要单独核查，不能覆盖。' });
            }
            await this.store.reconfirmLegacySnapshot({ projectId, templateVersionId: versionId, bindingId,
              teamVersionId: target.teamVersionId, bindingHash: target.bindingHash, bundleDigest: target.bundleDigest,
              boundAt: new Date(), backfilled: false }, previous, tx);
            const snapshot = await this.bindings.findFrozenSnapshotForProject(projectId, versionId, tx);
            if (!snapshot) throw new ConflictException('项目绑定修复回读未确认');
            await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'project.binding.reconfirm',
              targetType: 'project', targetId: projectId, idempotencyKey: `${scope}:${key}`, reason: reason.trim(),
              detail: { templateVersionId: versionId, bindingId, bindingHash: target.bindingHash, bundleDigest: target.bundleDigest,
                previousBindingId: previous?.bindingId ?? null, previousBindingHash: previous?.bindingHash ?? null,
                previousBackfilled: previous?.backfilled ?? null, previousBoundAt: previous?.boundAt.toISOString() ?? null } }, tx);
            return { projectId, snapshot, replayed: false };
          };
          const body = this.db ? await this.db.transaction((tx) => perform(tx)) : await perform();
          return { status: 200, body };
        });
      return { ...result.body, replayed: result.replayed || result.body.replayed };
    } catch (error) {
      if (error instanceof TemplateBindingStoreConflictError) throw new ConflictException({ code: 'PROJECT_BINDING_CHANGED', message: error.message });
      throwHttpForIdempotencyError(error); throw error;
    }
  }
}
