import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { adminAssistants, adminTeams, projectTemplates, projectTemplateVersions, visualBindings, withTransaction, type Database } from '@qitu/database';
import { eq, sql } from 'drizzle-orm';
import { VISUAL_ASSETS, visualToken, type CurrentUser, type VisualBinding, type VisualBindingPatch, type VisualOwner, type VisualUsage } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { hashIdempotentInput } from '../../common/idempotency/idempotency.hash';
import { parseVisualOwner, parseVisualUsage, resolveVisualBinding, visualBindingKey } from './visual-assets.policy';

@Injectable()
export class VisualAssetsService {
  private readonly logger = new Logger(VisualAssetsService.name);
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database | null, private readonly audit: AuditWriter) {}

  catalog(usage?: VisualUsage) { return VISUAL_ASSETS.filter((asset) => !usage || asset.usages.includes(usage)); }

  async snapshot(): Promise<VisualBinding[]> {
    if (!this.db) throw new ServiceUnavailableException({ code: 'VISUAL_STORAGE_UNAVAILABLE', message: '素材配置存储不可用' });
    const rows = await this.db.select().from(visualBindings);
    return rows.map((row) => ({ owner: parseVisualOwner({ kind: row.ownerKind, id: row.ownerId }), usage: parseVisualUsage(row.usage),
      selection: row.assetId ? { kind: 'asset', assetId: row.assetId } : { kind: 'inherit' }, revision: row.revision, effectiveAssetId: row.assetId }));
  }

  async read(owner: VisualOwner, usage: VisualUsage): Promise<VisualBinding> {
    return resolveVisualBinding(owner, usage, await this.snapshot());
  }

  /** Public artwork is safe to fall back; a failed configuration read never becomes a successful write. */
  async presentationSnapshot(): Promise<VisualBinding[]> {
    try { return await this.snapshot(); }
    catch { this.logger.warn('Visual selections unavailable; retaining legacy artwork'); return []; }
  }

  avatar(ownerId: string, legacy: string | null | undefined, bindings: readonly VisualBinding[]): string {
    const binding = resolveVisualBinding({ kind: 'assistant', id: ownerId }, 'avatar', bindings);
    if (binding.revision === 0 && legacy && legacy.replace(/\uFE0F/g, '').trim() !== '🤖') return legacy;
    return binding.effectiveAssetId ? visualToken(binding.effectiveAssetId) : legacy ?? '';
  }

  async save(actor: CurrentUser, input: VisualBindingPatch, operationKey: string): Promise<VisualBinding> {
    if (actor.role !== 'admin') throw new ForbiddenException('素材配置仅向管理员开放');
    if (!this.db) throw new ServiceUnavailableException({ code: 'VISUAL_STORAGE_UNAVAILABLE', message: '素材配置存储不可用' });
    const key = visualBindingKey(input.owner, input.usage);
    const operationHash = hashIdempotentInput('visual.binding', { actorId: actor.id }, input);
    await withTransaction(this.db, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
      const owner = input.owner;
      let exists = owner.kind === 'platform';
      if (owner.kind === 'assistant') exists = (await tx.select({ id: adminAssistants.id }).from(adminAssistants).where(eq(adminAssistants.id, owner.id))).length > 0;
      if (owner.kind === 'team') exists = (await tx.select({ id: adminTeams.id }).from(adminTeams).where(eq(adminTeams.id, owner.id))).length > 0;
      if (owner.kind === 'template') exists = (await tx.select({ id: projectTemplates.id }).from(projectTemplates).where(eq(projectTemplates.id, owner.id))).length > 0;
      if (owner.kind === 'template-version') exists = (await tx.select({ id: projectTemplateVersions.id }).from(projectTemplateVersions).where(eq(projectTemplateVersions.id, owner.id))).length > 0;
      if (owner.kind === 'knowledge') {
        const result = await tx.execute(sql`SELECT id FROM knowledge_bases WHERE id=${owner.id}`);
        exists = result.rows.length > 0;
      }
      if (!exists) throw new NotFoundException({ code: 'VISUAL_OWNER_NOT_FOUND', message: '展示对象不存在或不可用' });
      const [current] = await tx.select().from(visualBindings).where(eq(visualBindings.key, key));
      if (current?.operationKey === operationKey && current.operationHash === operationHash) return;
      if ((current?.revision ?? 0) !== input.expectedRevision) throw new ConflictException({ code: 'VISUAL_REVISION_CONFLICT', message: '素材选择已变化，请刷新后重试' });
      const assetId = input.selection.kind === 'asset' ? input.selection.assetId : null;
      const values = { key, ownerKind: owner.kind, ownerId: owner.id, usage: input.usage, assetId,
        revision: (current?.revision ?? 0) + 1, operationKey, operationHash, updatedBy: actor.id, updatedAt: new Date() };
      await tx.insert(visualBindings).values(values).onConflictDoUpdate({ target: visualBindings.key, set: values });
      await this.audit.write({ actorId: actor.id, actorRole: actor.role, action: 'admin.visual.select', targetType: owner.kind, targetId: owner.id,
        detail: { usage: input.usage, before: current?.assetId ?? null, after: assetId, revision: values.revision } }, tx);
    });
    return this.read(input.owner, input.usage);
  }
}
