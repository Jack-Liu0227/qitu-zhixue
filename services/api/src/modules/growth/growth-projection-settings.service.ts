import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { parseGrowthProjectionSettings, type CurrentUser, type GrowthProjectionSettings, type GrowthProjectionSettingsView } from '@qitu/contracts';
import { adminAssistants, agentConfigs, type Database } from '@qitu/database';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DATABASE_TOKEN } from '../../database';
import { AuditWriter } from '../../common/audit/audit.service';
import { KnowledgeCenterService, rows } from '../knowledge/knowledge-center.service';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type ConfigurationRow = { revision: number; config: Record<string, unknown>; request_hash?: string };
const EMPTY_SETTINGS: GrowthProjectionSettings = { profileAssistantId: null, growthAssistantId: null };

@Injectable()
export class GrowthProjectionSettingsService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly knowledge: KnowledgeCenterService,
    private readonly audit: AuditWriter,
  ) {}

  async read(): Promise<GrowthProjectionSettingsView> {
    this.database();
    const current = await this.knowledge.configuration();
    return this.view(current.revision, current.config.growthProjection);
  }

  async save(actor: CurrentUser, body: unknown, key: string): Promise<GrowthProjectionSettingsView> {
    if (actor.role !== 'admin') throw new ForbiddenException('GROWTH_PROJECTION_ADMIN_REQUIRED');
    if (!/^[A-Za-z0-9._:-]{1,120}$/u.test(key ?? '')) throw new BadRequestException('IDEMPOTENCY_KEY_REQUIRED');
    const input = body as Record<string, unknown> | null;
    const settings = parseGrowthProjectionSettings(input?.settings);
    if (!input || Array.isArray(input) || Object.keys(input).some((field) => !['expectedRevision', 'settings'].includes(field))
      || !Number.isInteger(input.expectedRevision) || (input.expectedRevision as number) < 1 || !settings) {
      throw new BadRequestException('GROWTH_PROJECTION_SETTINGS_INVALID');
    }
    const hash = createHash('sha256').update(JSON.stringify({ expectedRevision: input.expectedRevision, settings })).digest('hex');
    const storedKey = `growth-projection:${key}`;
    const saved = await this.database().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(281017)`);
      const [replay] = rows<ConfigurationRow>(await tx.execute(sql`SELECT revision,config,request_hash FROM platform_configuration_revisions WHERE updated_by=${actor.id} AND idempotency_key=${storedKey}`));
      if (replay) {
        if (replay.request_hash !== hash) throw new ConflictException('IDEMPOTENCY_KEY_CONFLICT');
        return replay;
      }
      const [current] = rows<ConfigurationRow>(await tx.execute(sql`SELECT revision,config FROM platform_configuration_revisions ORDER BY revision DESC LIMIT 1`));
      if (!current || current.revision !== input.expectedRevision) throw new ConflictException({ code: 'CONFIG_REVISION_CONFLICT', currentRevision: current?.revision ?? 0 });
      const eligible = await this.eligibleAssistants(tx);
      for (const id of [settings.profileAssistantId, settings.growthAssistantId]) {
        if (id !== null && !eligible.some((item) => item.id === id)) throw new BadRequestException('GROWTH_PROJECTION_ASSISTANT_UNAVAILABLE');
      }
      const revision = current.revision + 1;
      const config = { ...current.config, growthProjection: settings };
      await tx.execute(sql`INSERT INTO platform_configuration_revisions(revision,parent_revision,config,updated_by,idempotency_key,request_hash) VALUES(${revision},${current.revision},${JSON.stringify(config)}::jsonb,${actor.id},${storedKey},${hash})`);
      await this.audit.write({
        actorId: actor.id, actorRole: actor.role, action: 'growth.projection.settings.save',
        targetType: 'platform_configuration', targetId: String(revision), idempotencyKey: storedKey,
        detail: { revision, parentRevision: current.revision, ...settings },
      }, tx);
      const [persisted] = rows<ConfigurationRow>(await tx.execute(sql`SELECT revision,config FROM platform_configuration_revisions WHERE revision=${revision}`));
      if (!persisted) throw new ServiceUnavailableException('CONFIG_READBACK_FAILED');
      return persisted;
    });
    return this.view(saved.revision, saved.config.growthProjection);
  }

  private async view(revision: number, raw: unknown): Promise<GrowthProjectionSettingsView> {
    const settings = parseGrowthProjectionSettings(raw) ?? { ...EMPTY_SETTINGS };
    const assistants = await this.eligibleAssistants(this.database());
    const readiness = (id: string | null) => id === null ? 'unconfigured' as const
      : assistants.some((item) => item.id === id) ? 'ready' as const : 'disabled_or_missing' as const;
    return {
      revision, settings, assistants,
      readiness: { profile: readiness(settings.profileAssistantId), growth: readiness(settings.growthAssistantId) },
      pendingPolicy: 'proposed',
    };
  }

  private async eligibleAssistants(db: Database | Transaction): Promise<Array<{ id: string; displayName: string }>> {
    const [assistants, agents] = await Promise.all([
      db.select({ id: adminAssistants.id, name: adminAssistants.name, enabled: adminAssistants.enabled }).from(adminAssistants),
      db.select({ id: agentConfigs.id, enabled: agentConfigs.enabled }).from(agentConfigs),
    ]);
    const enabled = new Set(agents.filter((agent) => agent.enabled).map((agent) => agent.id));
    return assistants.filter((assistant) => assistant.enabled && enabled.has(assistant.id))
      .map((assistant) => ({ id: assistant.id, displayName: assistant.name })).sort((a, b) => a.id.localeCompare(b.id));
  }

  private database(): Database {
    if (!this.db) throw new ServiceUnavailableException('GROWTH_PROJECTION_STORAGE_UNAVAILABLE');
    return this.db;
  }
}
