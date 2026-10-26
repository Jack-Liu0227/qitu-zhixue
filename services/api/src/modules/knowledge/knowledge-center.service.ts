import { engineDefinition } from './knowledge-engine.catalog';
import { legacyMcpManifest } from '../platform-registry/legacy-mcp-catalog';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  adminAssistants,
  agentConfigs,
  runtimeMcpServers,
  modelModels,
  tutorPartners,
  type Database,
} from '@qitu/database';
import { sql, type SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { CurrentUser } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import type { ParsedUpload } from './knowledge-upload.service';
import { AuditWriter } from '../../common/audit/audit.service';
import {
  IdempotencyStore,
  hashIdempotentInput,
  throwHttpForIdempotencyError,
} from '../../common/idempotency';
import {
  ENGINE_CATALOG,
  KNOWLEDGE_TOOL,
  assertAssistantsBindable,
  parseAssistantBindingsInput,
  record,
  redactConnection,
  validateKnowledgeConfig,
  type PlatformKnowledgeConfig,
} from './knowledge-center.config';

export interface KnowledgeBaseRow {
  id: string;
  name: string;
  kind: string;
  project_id: string | null;
  school_id: string | null;
  owner_user_id: string | null;
  engine_instance_id: string | null;
  lifecycle: string;
  build_state: string;
  active_index_version_id: string | null;
  revision: number;
  updated_at: string;
  document_count: number;
  library_settings?: Record<string, unknown>;
}
export interface KnowledgeMember {
  id: string;
  kb_id: string;
  title: string;
  content: string;
  checksum: string;
  document_id: string | null;
  source_revision: string;
  origin: Record<string, unknown>;
  visibility: string;
}
export function rows<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}
export const checksum = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class KnowledgeCenterService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly audit: AuditWriter,
    @Optional() @Inject(IdempotencyStore) private readonly idempotency?: IdempotencyStore,
  ) {}

  private async executeIdempotent<T>(
    scope: string,
    key: string,
    pathParams: Record<string, unknown>,
    body: unknown,
    handler: () => Promise<T>,
  ): Promise<T> {
    if (!this.idempotency) throw new ServiceUnavailableException('知识中心幂等存储不可用');
    try {
      const result = await this.idempotency.execute(
        scope,
        key,
        hashIdempotentInput(scope, pathParams, body),
        async () => ({ body: await handler() }),
      );
      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }

  database(): Database {
    if (!this.db) throw new ServiceUnavailableException('知识中心需要持久化数据库');
    return this.db;
  }
  async query<T>(query: SQL): Promise<T[]> {
    return rows<T>(await this.database().execute(query));
  }

  async configuration(): Promise<{ revision: number; config: PlatformKnowledgeConfig }> {
    const db = this.database();
    const [latest] = await this.query<{ revision: number; config: PlatformKnowledgeConfig }>(
      sql`SELECT revision,config FROM platform_configuration_revisions ORDER BY revision DESC LIMIT 1`,
    );
    // Preserve saved enablement/bindings under the legacy key while updating the registered tools.
    if (latest)
      return {
        ...latest,
        config: {
          ...latest.config,
          platformTools: {
            ...latest.config.platformTools,
            'project-knowledge': {
              ...latest.config.platformTools['project-knowledge'],
              ...KNOWLEDGE_TOOL,
            },
          },
        },
      };
    const [servers, assistants] = await Promise.all([
      db.select().from(runtimeMcpServers),
      db.select().from(adminAssistants),
    ]);
    const ima = servers.find((s) => s.id === 'ima-knowledge');
    const config: PlatformKnowledgeConfig = {
      mcpServers: Object.fromEntries(
        servers
          .filter((s) => s.id !== 'ima-knowledge')
          .map((s) => [
            s.id,
            { name: s.label, enabled: s.enabled, transport: s.transport, tools: s.toolIds },
          ]),
      ),
      knowledgeEngines: {
        'llamaindex-main': {
          name: 'LlamaIndex',
          description: '知识库原文索引与检索',
          provider: 'llamaindex',
          enabled: false,
          config: { retrieval_profile: 'hybrid', top_k: 5 },
        },
        ...(ima
          ? {
              'ima-main': {
                name: 'Tencent ima',
                description: '已登记的 ima 只读桥接服务',
                provider: 'ima',
                enabled: ima.enabled,
                config: {
                  connectionRef: 'ima-legacy',
                  allowedKnowledgeBaseIds: [],
                  allowMaterialize: false,
                },
              },
            }
          : {}),
      },
      platformTools: {
        'project-knowledge': {
          ...KNOWLEDGE_TOOL,
          enabled: ima?.enabled ?? false,
          boundAssistants: assistants
            .filter((a) => a.mcpServerIds.includes('ima-knowledge'))
            .map((a) => a.id),
        },
      },
    };
    // Seed once; racing first readers cannot overwrite one another.
    await db.execute(
      sql`INSERT INTO platform_configuration_revisions(revision,config) VALUES(1,${JSON.stringify(config)}::jsonb) ON CONFLICT DO NOTHING`,
    );
    return (
      await this.query<{ revision: number; config: PlatformKnowledgeConfig }>(
        sql`SELECT revision,config FROM platform_configuration_revisions ORDER BY revision DESC LIMIT 1`,
      )
    )[0]!;
  }

  async validate(input: unknown) {
    const current = await this.configuration();
    const config = validateKnowledgeConfig(input, current.config);
    const assistants = await this.database().select().from(adminAssistants);
    if (
      config.platformTools['project-knowledge'].boundAssistants.some(
        (id) => !assistants.some((a) => a.id === id),
      )
    )
      throw new BadRequestException({
        code: 'CONFIG_REFERENCE_INVALID',
        message: '授权列表包含未知助手 ID',
      });
    const models = await this.database().select().from(modelModels);
    const servers = await this.database().select().from(runtimeMcpServers);
    for (const [id, server] of Object.entries(config.mcpServers)) {
      const registered = servers.find((s) => s.id === id || s.label === id || s.id === (server as any).name || s.id === `mcp-${id}` || s.id.replace(/^mcp-/, '') === id);
      const manifest = legacyMcpManifest(id) || legacyMcpManifest((server as any).name) || legacyMcpManifest(registered?.label ?? '');
      const manifestTools = manifest?.tools.map((t) => t.name) ?? [];
      const allowedPool = new Set([...(registered?.toolIds ?? []), ...manifestTools]);
      // Tool catalog comes from the registered bridge, never a model supplied tool name.
      if (!registered || (allowedPool.size > 0 && (server.tools as string[]).some((t) => !allowedPool.has(t))))
        throw new BadRequestException('MCP 工具不在服务端已注册清单内');
    }
    for (const engine of Object.values(config.knowledgeEngines)) {
      for (const [key, value] of Object.entries(engine.config)) {
        if (
          key.endsWith('ModelRef') &&
          !models.some((m) => `${m.providerId}:${m.modelId}` === value)
        )
          throw new BadRequestException({
            code: 'CONFIG_REFERENCE_INVALID',
            message: `${key} 须引用 providerId:modelId`,
          });
        if (key === 'connectionRef' && value !== 'ima-legacy')
          throw new BadRequestException({
            code: 'CONFIG_REFERENCE_INVALID',
            message: '连接须先通过受保护的服务端流程登记',
          });
      }
    }
    return { config, revision: current.revision };
  }

  async save(actor: CurrentUser, body: unknown, key: string) {
    const input = record(body);
    if (
      Object.keys(input).some((k) => !['config', 'expectedRevision'].includes(k)) ||
      !Number.isInteger(input.expectedRevision)
    )
      throw new BadRequestException('须提交 config 与 expectedRevision');
    const hash = checksum(JSON.stringify(body));
    const [replayed] = await this.query<{
      revision: number;
      config: PlatformKnowledgeConfig;
      request_hash: string;
    }>(
      sql`SELECT * FROM platform_configuration_revisions WHERE updated_by=${actor.id} AND idempotency_key=${key}`,
    );
    if (replayed) {
      if (replayed.request_hash !== hash) throw new ConflictException('幂等键已用于其他配置');
      return { revision: replayed.revision, config: replayed.config };
    }
    const validated = await this.validate(input.config);
    return this.database().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(281017)`);
      const [completed] = rows<{
        revision: number;
        config: PlatformKnowledgeConfig;
        request_hash: string;
      }>(
        await tx.execute(
          sql`SELECT * FROM platform_configuration_revisions WHERE updated_by=${actor.id} AND idempotency_key=${key}`,
        ),
      );
      if (completed) {
        if (completed.request_hash !== hash) throw new ConflictException('幂等键已用于其他配置');
        return { revision: completed.revision, config: completed.config };
      }
      const [current] = rows<{ revision: number }>(
        await tx.execute(
          sql`SELECT revision FROM platform_configuration_revisions ORDER BY revision DESC LIMIT 1`,
        ),
      );
      if (
        !current ||
        current.revision !== input.expectedRevision ||
        current.revision !== validated.revision
      )
        throw new ConflictException({
          code: 'CONFIG_REVISION_CONFLICT',
          message: '配置已被其他页面修改，请重新读取',
          currentRevision: current?.revision,
        });
      const revision = current.revision + 1;
      await tx.execute(
        sql`INSERT INTO platform_configuration_revisions(revision,parent_revision,config,updated_by,idempotency_key,request_hash) VALUES(${revision},${current.revision},${JSON.stringify(validated.config)}::jsonb,${actor.id},${key},${hash})`,
      );
      for (const [id, server] of Object.entries(validated.config.mcpServers)) {
        const toolList = Array.isArray(server.tools) ? (server.tools as string[]) : [];
        await tx.execute(
          sql`UPDATE runtime_mcp_servers 
              SET label=${server.name as string},
                  enabled=${server.enabled as boolean},
                  tool_ids=${JSON.stringify(toolList)}::jsonb,
                  tool_count=${toolList.length},
                  updated_at=now() 
              WHERE id=${id} OR id=${server.name as string} OR label=${server.name as string}`,
        );
      }
      await this.audit.write(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'knowledge.configuration.save',
          targetType: 'platform_configuration',
          targetId: String(revision),
          detail: { revision, parentRevision: current.revision },
        },
        tx,
      );
      return { revision, config: validated.config };
    });
  }

  async canRetrieve(assistantId: string, knowledgeBaseId?: string) {
    const { config } = await this.configuration();
    const tool = config.platformTools['project-knowledge'];
    const assistants = await this.database().select().from(adminAssistants);
    const globallyAllowed =
      tool.enabled &&
      tool.boundAssistants.includes(assistantId) &&
      assistants.some((a) => a.id === assistantId && a.enabled);
    if (!globallyAllowed) return false;
    if (!knowledgeBaseId) return true;
    const [binding] = await this.query<{ enabled: boolean }>(
      sql`SELECT b.enabled FROM knowledge_base_agent_bindings b JOIN knowledge_bases k ON k.id=b.kb_id WHERE b.kb_id=${knowledgeBaseId} AND b.agent_kind='admin_assistant' AND b.agent_id=${assistantId} AND b.mode='retrieve' AND b.enabled=true AND k.lifecycle='active' AND k.library_settings->>'enabled' IS DISTINCT FROM 'false'`,
    );
    return binding?.enabled === true;
  }

  /** Current per-library grants are also the ceiling for legacy IMA tools. */
  async imaKnowledgeBaseIds(assistantId?: string, studentId?: string): Promise<string[]> {
    if (assistantId && !(await this.canRetrieve(assistantId))) return [];
    const { config } = await this.configuration();
    const connections = await this.query<{
      engine_instance_id: string;
      external_ref: Record<string, unknown>;
    }>(
      sql`SELECT k.engine_instance_id,c.external_ref FROM knowledge_base_connections c
        JOIN knowledge_bases k ON k.id=c.kb_id WHERE c.provider='ima' AND c.status='ready'
        AND k.lifecycle='active' AND k.kind<>'project' AND k.library_settings->>'enabled' IS DISTINCT FROM 'false'
        AND (${studentId === undefined} OR EXISTS(SELECT 1 FROM users u WHERE u.id=${studentId ?? ''}
          AND (k.kind='platform' OR (k.kind='school' AND k.school_id=u.school_id)
          OR (k.kind='student' AND k.owner_user_id=u.id))))
        AND (${assistantId === undefined} OR EXISTS(SELECT 1 FROM knowledge_base_agent_bindings b
          WHERE b.kb_id=k.id AND b.agent_kind='admin_assistant' AND b.agent_id=${assistantId ?? ''}
          AND b.mode='retrieve' AND b.enabled=true))`,
    );
    const allowed: string[] = [];
    for (const connection of connections) {
      const engine = config.knowledgeEngines[connection.engine_instance_id];
      const id = connection.external_ref.remoteKnowledgeBaseId;
      if (
        engine?.enabled &&
        engine.provider === 'ima' &&
        typeof id === 'string' &&
        Array.isArray(engine.config.allowedKnowledgeBaseIds) &&
        engine.config.allowedKnowledgeBaseIds.includes(id)
      )
        allowed.push(id);
    }
    return [...new Set(allowed)];
  }

  async baseBindings(knowledgeBaseId: string) {
    const base = await this.base(knowledgeBaseId);
    const saved = base.bindings.bindings as {
      agentKind: string;
      agentId: string;
      mode: string;
      enabled: boolean;
    }[];
    const { config } = await this.configuration();
    const tool = config.platformTools['project-knowledge'];
    const assistants = await this.database().select().from(adminAssistants);
    return {
      bindingRevision: base.revision,
      bindings: saved,
      catalog: assistants.map((a) => {
        const binding = saved.find(
          (b) => b.agentKind === 'admin_assistant' && b.agentId === a.id && b.mode === 'retrieve',
        );
        const enabled = binding?.enabled ?? false;
        return {
          agentKind: 'admin_assistant',
          agentId: a.id,
          agentName: a.name,
          avatar: a.avatar,
          mode: 'retrieve',
          enabled,
          targetEnabled: a.enabled,
          effective: enabled && a.enabled && tool.enabled && tool.boundAssistants.includes(a.id),
          readonlyReason: !a.enabled ? '助手已停用' : null,
          reasons: !tool.enabled ? ['知识库检索总开关关闭'] : [],
        };
      }),
    };
  }

  async saveBaseBindings(actor: CurrentUser, knowledgeBaseId: string, body: unknown, key: string) {
    const input = record(body);
    if (
      Object.keys(input).some((field) => !['expectedRevision', 'bindings'].includes(field)) ||
      !Number.isInteger(input.expectedRevision) ||
      !Array.isArray(input.bindings)
    )
      throw new BadRequestException({ code: 'CONFIG_INVALID', message: '绑定请求无效' });
    const wanted = input.bindings as unknown[];
    if (wanted.length > 500)
      throw new BadRequestException({ code: 'CONFIG_INVALID', message: '绑定数量超限' });
    const parsed = wanted.map((raw) => {
      const row = record(raw);
      if (
        Object.keys(row).some(
          (field) => !['agentKind', 'agentId', 'mode', 'enabled'].includes(field),
        ) ||
        !['admin_assistant', 'tutor_partner', 'runtime_agent'].includes(String(row.agentKind)) ||
        !['retrieve', 'materialize'].includes(String(row.mode)) ||
        typeof row.agentId !== 'string' ||
        !row.agentId ||
        row.agentId.length > 160 ||
        typeof row.enabled !== 'boolean'
      )
        throw new BadRequestException({ code: 'CONFIG_INVALID', message: '绑定目标字段无效' });
      return {
        agentKind: row.agentKind as string,
        agentId: row.agentId,
        mode: row.mode as string,
        enabled: row.enabled,
      };
    });
    const unique = new Set(parsed.map((row) => `${row.agentKind}:${row.agentId}:${row.mode}`));
    if (unique.size !== parsed.length)
      throw new BadRequestException({ code: 'CONFIG_INVALID', message: '绑定不能重复' });
    const assistants = await this.database()
      .select({ id: adminAssistants.id, enabled: adminAssistants.enabled })
      .from(adminAssistants);
    const partners = await this.database()
      .select({ id: tutorPartners.id, enabled: tutorPartners.enabled })
      .from(tutorPartners);
    const agents = await this.database()
      .select({ id: agentConfigs.id, enabled: agentConfigs.enabled })
      .from(agentConfigs);
    for (const row of parsed) {
      const catalog =
        row.agentKind === 'admin_assistant'
          ? assistants
          : row.agentKind === 'tutor_partner'
            ? partners
            : agents;
      const target = catalog.find((entry) => entry.id === row.agentId);
      if (!target)
        throw new BadRequestException({ code: 'AGENT_NOT_FOUND', message: '绑定目标不存在' });
      if (!target.enabled && row.enabled)
        throw new BadRequestException({ code: 'AGENT_DISABLED', message: '绑定目标已停用' });
    }
    const hash = checksum(JSON.stringify({ knowledgeBaseId, body }));
    const replayId = `knowledge.binding.${actor.id}.${key}`;
    const [replay] = await this.query<{ detail: { requestHash?: string }; target_id: string }>(
      sql`SELECT detail,target_id FROM audit_logs WHERE idempotency_key=${replayId}`,
    );
    if (replay) {
      if (replay.detail?.requestHash !== hash)
        throw new ConflictException({
          code: 'IDEMPOTENCY_CONFLICT',
          message: '幂等键已用于其他绑定请求',
        });
      return { knowledgeBaseId, ...(await this.baseBindings(knowledgeBaseId)) };
    }
    return this.database().transaction(async (tx) => {
      // Same configuration lock as the JSON editor; a per-library grant also grants the tool.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(281017)`);
      const [base] = rows<{ revision: number; kind: string }>(
        await tx.execute(
          sql`SELECT revision,kind FROM knowledge_bases WHERE id=${knowledgeBaseId} AND lifecycle='active' FOR UPDATE`,
        ),
      );
      if (!base) throw new NotFoundException('知识库不可用');
      if (base.kind === 'project')
        throw new BadRequestException('历史自动知识库不再构建，请手动创建知识库');
      if (base.revision !== input.expectedRevision)
        throw new ConflictException({
          code: 'KNOWLEDGE_BINDING_CONFLICT',
          message: '知识库修订已变化',
        });
      const nextRevision = base.revision + 1;
      await tx.execute(
        sql`DELETE FROM knowledge_base_agent_bindings WHERE kb_id=${knowledgeBaseId}`,
      );
      for (const row of parsed)
        await tx.execute(
          sql`INSERT INTO knowledge_base_agent_bindings(kb_id,agent_kind,agent_id,mode,enabled,revision,created_by,updated_by) VALUES(${knowledgeBaseId},${row.agentKind},${row.agentId},${row.mode},${row.enabled},${nextRevision},${actor.id},${actor.id})`,
        );
      const selectedAssistants = parsed
        .filter(
          (row) => row.agentKind === 'admin_assistant' && row.mode === 'retrieve' && row.enabled,
        )
        .map((row) => row.agentId);
      if (selectedAssistants.length) {
        const [current] = rows<{ revision: number; config: PlatformKnowledgeConfig }>(
          await tx.execute(
            sql`SELECT revision,config FROM platform_configuration_revisions ORDER BY revision DESC LIMIT 1`,
          ),
        );
        if (current) {
          const tool = current.config.platformTools['project-knowledge'];
          const allowed = [...new Set([...tool.boundAssistants, ...selectedAssistants])];
          if (allowed.length !== tool.boundAssistants.length) {
            const config = {
              ...current.config,
              platformTools: {
                ...current.config.platformTools,
                'project-knowledge': { ...tool, boundAssistants: allowed },
              },
            };
            await tx.execute(
              sql`INSERT INTO platform_configuration_revisions(revision,config,updated_by,idempotency_key,request_hash) VALUES(${current.revision + 1},${JSON.stringify(config)}::jsonb,${actor.id},${`library-grant:${key}`},${hash})`,
            );
          }
        }
      }
      await tx.execute(
        sql`UPDATE knowledge_bases SET revision=${nextRevision},updated_at=now() WHERE id=${knowledgeBaseId}`,
      );
      await this.audit.write(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'knowledge.base.bindings.save',
          targetType: 'knowledge_base',
          targetId: String(nextRevision),
          idempotencyKey: replayId,
          detail: {
            requestHash: hash,
            bindingCount: parsed.length,
            bindingIdsHash: checksum(
              parsed
                .map((row) => `${row.agentKind}:${row.agentId}:${row.mode}`)
                .sort()
                .join('|'),
            ),
          },
        },
        tx,
      );
      return { knowledgeBaseId, bindingRevision: nextRevision, bindings: parsed };
    });
  }

  /**
   *   * 知识库↔助手绑定（docs/design/20261018-knowledge-center-deeptutor-reference.md §2）：
   * 知识库检索工具绑定到哪些助手。只读目录 + 聚焦写入；
   * 保存复用 platform-config 的 expectedRevision 并发控制、幂等与审计事务。
   */
  async assistantBindings(): Promise<{
    revision: number;
    assistantIds: string[];
    catalog: { id: string; name: string; avatar: string | null; enabled: boolean }[];
  }> {
    const { revision, config } = await this.configuration();
    const assistants = await this.database().select().from(adminAssistants);
    return {
      revision,
      assistantIds: [...config.platformTools['project-knowledge'].boundAssistants],
      catalog: assistants.map((assistant) => ({
        id: assistant.id,
        name: assistant.name,
        avatar: assistant.avatar ?? null,
        enabled: assistant.enabled,
      })),
    };
  }

  async saveAssistantBindings(actor: CurrentUser, body: unknown, key: string) {
    const { expectedRevision, assistantIds } = parseAssistantBindingsInput(body);
    const rows = await this.database()
      .select({ id: adminAssistants.id, enabled: adminAssistants.enabled })
      .from(adminAssistants);
    assertAssistantsBindable(assistantIds, rows);
    const { revision, config } = await this.configuration();
    const next = {
      ...config,
      platformTools: {
        ...config.platformTools,
        'project-knowledge': {
          ...config.platformTools['project-knowledge'],
          boundAssistants: [...assistantIds],
        },
      },
    };
    return this.save(actor, { config: next, expectedRevision }, key);
  }

  async engines() {
    const { revision, config } = await this.configuration();
    const checks = await this.query<{
      instance_id: string;
      config_revision: number;
      health_status: string;
      checked_at: string;
      error_code: string | null;
      capabilities: unknown;
    }>(sql`SELECT * FROM knowledge_engine_checks`);
    const bases = await this.bases();
    return ENGINE_CATALOG.map(([provider, name, group]) => ({
      provider,
      name,
      group,
      definition: engineDefinition(provider),
      instances: Object.entries(config.knowledgeEngines)
        .filter(([, e]) => e.provider === provider)
        .map(([id, e]) => ({
          id,
          ...e,
          revision,
          configurationStatus: 'saved',
          applicationStatus: 'applied',
          health:
            checks.find((c) => c.instance_id === id && c.config_revision === revision) ?? null,
          associatedBases: bases
            .filter((b) => b.engine_instance_id === id)
            .map((b) => ({ id: b.id, name: b.name })),
          configurationUrl: `/admin/settings/tools?knowledgeEngine=${encodeURIComponent(id)}`,
        })),
    }));
  }

  async bases() {
    return this.query<KnowledgeBaseRow>(
      sql`SELECT k.*, (SELECT count(*)::int FROM knowledge_base_members m WHERE m.kb_id=k.id AND m.visibility='active') document_count, (SELECT count(*)::int FROM knowledge_base_agent_bindings b WHERE b.kb_id=k.id AND b.agent_kind='admin_assistant' AND b.enabled=true AND b.mode='retrieve') assistant_count FROM knowledge_bases k WHERE lifecycle<>'deleted' ORDER BY updated_at DESC`,
    );
  }
  async base(id: string) {
    const base = (await this.bases()).find((b) => b.id === id);
    if (!base) throw new NotFoundException('知识库不可用');
    const [connection] = await this.query<{
      flavour: string;
      provider: string;
      external_ref: Record<string, unknown>;
      credential_ref: string | null;
      status: string;
      last_error_code: string | null;
      last_check_at: string | null;
    }>(
      sql`SELECT flavour,provider,external_ref,credential_ref,status,last_error_code,last_check_at::text FROM knowledge_base_connections WHERE kb_id=${id}`,
    );
    const sources = await this.query<{
      id: string;
      kind: string;
      status: string;
      source_config: Record<string, unknown>;
      last_error_code: string | null;
      last_source_revision: string | null;
      schedule_hours: number | null;
      last_sync_at: string | null;
    }>(
      sql`SELECT id,kind,status,source_config,last_error_code,last_source_revision,schedule_hours,last_sync_at FROM knowledge_sources WHERE kb_id=${id} ORDER BY created_at`,
    );
    const bindings = await this.query(
      sql`SELECT agent_kind as "agentKind",agent_id as "agentId",mode,enabled,revision FROM knowledge_base_agent_bindings WHERE kb_id=${id} ORDER BY agent_kind,agent_id,mode`,
    );
    return {
      ...base,
      files: await this.query<Omit<KnowledgeMember, 'content'>>(
        sql`SELECT m.id,m.kb_id,m.title,m.checksum,m.document_id,m.source_revision,m.origin,m.visibility FROM knowledge_base_members m LEFT JOIN knowledge_sources s ON s.id=m.origin->>'sourceId' WHERE m.kb_id=${id} AND m.visibility='active' AND (m.origin->>'kind' IS DISTINCT FROM 'managed-source' OR s.status<>'revoked') ORDER BY m.created_at`,
      ),
      versions: await this.query(
        sql`SELECT id,status,manifest,created_at FROM knowledge_index_versions WHERE kb_id=${id} ORDER BY created_at DESC`,
      ),
      jobs: await this.query(
        sql`SELECT * FROM knowledge_jobs WHERE kb_id=${id} ORDER BY created_at DESC`,
      ),
      connection: connection
        ? redactConnection({
            flavour: connection.flavour,
            provider: connection.provider,
            externalRef: connection.external_ref,
            credentialRef: connection.credential_ref,
            status: connection.status,
            lastErrorCode: connection.last_error_code,
            lastCheckAt: connection.last_check_at,
          })
        : { status: 'not_applicable' },
      bindings: { bindingRevision: base.revision, bindings },
      sources: sources.map((source) => ({
        id: source.id,
        kind: source.kind,
        status: source.status,
        sourceConfig:
          source.kind === 'folder'
            ? { ...source.source_config, path: '[allowlisted path]' }
            : source.source_config,
        lastErrorCode: source.last_error_code,
        lastSourceRevision: source.last_source_revision,
        scheduleHours: source.schedule_hours,
        lastSyncAt: source.last_sync_at,
      })),
    };
  }
  async createBase(actor: CurrentUser, body: unknown, key: string) {
    const input = record(body);
    if (
      Object.keys(input).some(
        (k) =>
          ![
            'name',
            'engineInstanceId',
            'embeddingModelRef',
            'retrievalMode',
            'storageWorkspaceRef',
          ].includes(k),
      ) ||
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 160
    )
      throw new BadRequestException('请输入知识库名称');
    const config = await this.configuration();
    if (
      typeof input.engineInstanceId !== 'string' ||
      !config.config.knowledgeEngines[input.engineInstanceId]
    )
      throw new BadRequestException('请选择已配置引擎');
    const id = `kb-${checksum(`${actor.id}:${key}`).slice(0, 32)}`;
    if (input.storageWorkspaceRef !== undefined && input.storageWorkspaceRef !== 'account')
      throw new BadRequestException('请选择账户资源库');
    const selectedEngine = config.config.knowledgeEngines[input.engineInstanceId as string]!;
    const overrides: Record<string, unknown> = {};
    if (input.embeddingModelRef !== undefined) {
      if (typeof input.embeddingModelRef !== 'string')
        throw new BadRequestException('嵌入模型无效');
      const models = await this.database().select().from(modelModels);
      const model = models.find((m) => `${m.providerId}:${m.modelId}` === input.embeddingModelRef);
      if (
        !model ||
        !(Array.isArray(model.outputModalities) && model.outputModalities.includes('embedding'))
      )
        throw new BadRequestException('请选择已配置的嵌入模型');
      overrides.embeddingModelRef = input.embeddingModelRef;
    }
    if (input.retrievalMode !== undefined) {
      if (
        typeof input.retrievalMode !== 'string' ||
        !engineDefinition(selectedEngine.provider).modes.includes(input.retrievalMode)
      )
        throw new BadRequestException('检索模式无效');
      overrides[selectedEngine.provider === 'llamaindex' ? 'retrieval_profile' : 'mode'] =
        input.retrievalMode;
    }
    const settings = { storageWorkspaceRef: 'account', engineOverrides: overrides };
    const [existing] = await this.query<KnowledgeBaseRow>(
      sql`SELECT * FROM knowledge_bases WHERE id=${id}`,
    );
    if (
      existing &&
      (existing.name !== input.name.trim() ||
        existing.engine_instance_id !== input.engineInstanceId ||
        JSON.stringify(existing.library_settings?.engineOverrides ?? {}) !==
          JSON.stringify(overrides))
    )
      throw new ConflictException('幂等键已用于其他知识库');
    await this.database().transaction(async (tx) => {
      const inserted = rows(
        await tx.execute(
          sql`INSERT INTO knowledge_bases(id,name,kind,engine_instance_id,build_state,library_settings) VALUES(${id},${String(input.name).trim()},'platform',${String(input.engineInstanceId)},'unindexed',${JSON.stringify(settings)}::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id`,
        ),
      );
      if (inserted.length)
        await this.audit.write(
          {
            actorId: actor.id,
            actorRole: actor.role,
            action: 'knowledge.base.create',
            targetType: 'knowledge_base',
            targetId: id,
            idempotencyKey: `knowledge.base.create:${actor.id}:${key}`,
            detail: { engineInstanceId: input.engineInstanceId },
          },
          tx,
        );
    });
    const saved = await this.base(id);
    if (saved.name !== input.name.trim() || saved.engine_instance_id !== input.engineInstanceId)
      throw new ConflictException('幂等键已用于其他知识库');
    return saved;
  }
  async addFile(actor: CurrentUser, id: string, body: unknown, key: string, upload?: ParsedUpload) {
    const base = await this.base(id);
    const input = record(body);
    if (base.kind === 'project' || base.lifecycle !== 'active')
      throw new BadRequestException('该历史知识库只读，或知识库已停用');
    if (
      Object.keys(input).some((k) => !['title', 'content', 'allowMaterialize'].includes(k)) ||
      typeof input.title !== 'string' ||
      !input.title.trim() ||
      input.title.length > 160 ||
      typeof input.content !== 'string' ||
      !input.content.trim() ||
      Buffer.byteLength(input.content) > 5 * 1024 * 1024 ||
      (input.allowMaterialize !== undefined && typeof input.allowMaterialize !== 'boolean')
    )
      throw new BadRequestException('资料需包含标题和正文，正文不超过 5 MiB');
    const memberId = `material-${checksum(`${actor.id}:${id}:${key}`).slice(0, 32)}`;
    const requestHash = checksum(
      JSON.stringify({
        ...input,
        ...(upload ? { originalChecksum: upload.originalChecksum, fileName: upload.fileName } : {}),
      }),
    );
    const hash = checksum(input.content);
    await this.database().transaction(async (tx) => {
      const [locked] = rows<KnowledgeBaseRow>(
        await tx.execute(
          sql`SELECT id,kind FROM knowledge_bases WHERE id=${id} AND lifecycle='active' FOR UPDATE`,
        ),
      );
      if (!locked || locked.kind === 'project')
        throw new BadRequestException('知识库已删除或不可上传');
      const [existing] = rows<{ checksum: string; origin: { requestHash: string } }>(
        await tx.execute(
          sql`SELECT checksum,origin FROM knowledge_base_members WHERE id=${memberId}`,
        ),
      );
      if (existing && existing.origin.requestHash !== requestHash)
        throw new ConflictException('幂等键已用于其他资料');
      if (upload && !existing) {
        const [usage] = rows<{ documents: number; bytes: number }>(
          await tx.execute(
            sql`SELECT count(*)::int documents,coalesce(sum(octet_length(content)),0)::float8 bytes FROM knowledge_base_members WHERE kb_id=${id} AND visibility='active'`,
          ),
        );
        if (
          usage!.documents >= 20 ||
          usage!.bytes + Buffer.byteLength(input.content as string) > 7 * 1024 * 1024
        )
          throw new BadRequestException({
            code: 'KNOWLEDGE_LIBRARY_LIMIT',
            message: '当前引擎每库最多 20 份资料、正文合计 7 MiB，请分库保存后重试。',
          });
      }
      const [duplicate] = rows<{ id: string }>(
        await tx.execute(
          sql`SELECT id FROM knowledge_base_members WHERE kb_id=${id} AND checksum=${hash}`,
        ),
      );
      if (duplicate && duplicate.id !== memberId)
        throw new ConflictException('该正文已经在知识库中，请编辑已有资料');
      const fileMetadata = upload
        ? {
            fileName: upload.fileName,
            mimeType: upload.mimeType,
            byteSize: upload.byteSize,
            originalChecksum: upload.originalChecksum,
            parser: upload.parser,
            upstreamCommit: upload.upstreamCommit,
            pageCount: upload.pageCount,
          }
        : {};
      await tx.execute(
        sql`INSERT INTO knowledge_base_members(id,kb_id,title,content,checksum,source_revision,origin) VALUES(${memberId},${id},${input.title},${input.content},${hash},${hash},${JSON.stringify({ kind: 'admin-upload', canMaterialize: false, reviewedBy: actor.id, requestHash, ...fileMetadata })}::jsonb) ON CONFLICT DO NOTHING`,
      );
      if (upload)
        await tx.execute(
          sql`INSERT INTO knowledge_file_originals(member_id,file_name,mime_type,byte_size,checksum,body) VALUES(${memberId},${upload.fileName},${upload.mimeType},${upload.byteSize},${upload.originalChecksum},decode(${upload.base64},'base64')) ON CONFLICT DO NOTHING`,
        );
      if (!existing)
        await tx.execute(
          sql`UPDATE knowledge_bases SET revision=revision+1,build_state='unindexed',updated_at=now() WHERE id=${id}`,
        );
      await this.audit.write(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'knowledge.file.add',
          targetType: 'knowledge_base',
          targetId: id,
          detail: { memberId, checksum: hash },
        },
        tx,
      );
    });
    return this.rebuild(id, `${actor.id}:file:${key}`);
  }
  async rebuild(id: string, key: string) {
    const jobId = `build-${checksum(`${id}:${key}`).slice(0, 40)}`;
    await this.database().transaction(async (tx) => {
      const [base] = rows<KnowledgeBaseRow>(
        await tx.execute(
          sql`SELECT * FROM knowledge_bases WHERE id=${id} AND lifecycle='active' FOR UPDATE`,
        ),
      );
      if (!base) throw new NotFoundException('知识库不可用');
      if (base.kind === 'project')
        throw new BadRequestException('历史自动知识库不再构建，请手动创建知识库');
      const [replay] = rows(await tx.execute(sql`SELECT id FROM knowledge_jobs WHERE id=${jobId}`));
      if (replay) return;
      const [running] = rows<{ id: string; input_revision: number }>(
        await tx.execute(
          sql`SELECT id,input_revision FROM knowledge_jobs WHERE kb_id=${id} AND state NOT IN ('ready','failed','empty','cancelled')`,
        ),
      );
      if (running && running.input_revision === base.revision) return;
      if (running)
        await tx.execute(
          sql`UPDATE knowledge_jobs SET state='cancelled',fencing_token=fencing_token+1,lease_until=NULL WHERE id=${running.id}`,
        );
      const revision = base.revision + 1;
      await tx.execute(
        sql`UPDATE knowledge_bases SET revision=${revision},build_state='queued',updated_at=now() WHERE id=${id}`,
      );
      await tx.execute(
        sql`INSERT INTO knowledge_jobs(id,kb_id,operation,input_revision) VALUES(${jobId},${id},${'index'},${revision})`,
      );
    });
    return this.base(id);
  }
  async file(id: string, memberId: string) {
    await this.base(id);
    const [file] = await this.query<KnowledgeMember>(
      sql`SELECT m.* FROM knowledge_base_members m LEFT JOIN knowledge_sources s ON s.id=m.origin->>'sourceId' WHERE m.kb_id=${id} AND m.id=${memberId} AND m.visibility='active' AND (m.origin->>'kind' IS DISTINCT FROM 'managed-source' OR s.status<>'revoked')`,
    );
    if (!file) throw new NotFoundException('资料不可用');
    return file;
  }
  async original(id: string, memberId: string) {
    await this.file(id, memberId);
    const [original] = await this.query<{ file_name: string; mime_type: string; body: Buffer }>(
      sql`SELECT file_name,mime_type,body FROM knowledge_file_originals WHERE member_id=${memberId}`,
    );
    if (!original) throw new NotFoundException('此资料没有原始上传文件');
    return original;
  }
  async updateFile(actor: CurrentUser, id: string, memberId: string, body: unknown, key: string) {
    const base = await this.base(id);
    const input = record(body);
    if (base.kind === 'project' || base.lifecycle !== 'active')
      throw new BadRequestException('该历史知识库只读，或知识库已停用');
    if (
      Object.keys(input).some((k) => !['allowMaterialize', 'deleted'].includes(k)) ||
      !Object.keys(input).length ||
      Object.values(input).some((v) => typeof v !== 'boolean')
    )
      throw new BadRequestException('资料许可或删除参数无效');
    const scope = `admin.knowledge.file.update:${actor.id}`;
    return this.executeIdempotent(scope, key, { id, memberId }, body, async () => {
      await this.database().transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM knowledge_bases WHERE id=${id} FOR UPDATE`);
        const files = rows(
          await tx.execute(
            sql`SELECT id FROM knowledge_base_members WHERE kb_id=${id} AND id=${memberId}`,
          ),
        );
        if (!files.length) throw new NotFoundException('资料不可用');
        let changed = false;
        if (input.allowMaterialize !== undefined)
          changed =
            rows(
              await tx.execute(
                sql`UPDATE knowledge_base_members SET origin=jsonb_set(origin,'{canMaterialize}',${JSON.stringify(input.allowMaterialize)}::jsonb) WHERE id=${memberId} AND origin->'canMaterialize' IS DISTINCT FROM ${JSON.stringify(input.allowMaterialize)}::jsonb RETURNING id`,
              ),
            ).length > 0;
        if (input.deleted === true)
          changed =
            rows(
              await tx.execute(
                sql`UPDATE knowledge_base_members SET visibility='deleted' WHERE id=${memberId} AND visibility<>'deleted' RETURNING id`,
              ),
            ).length > 0 || changed;
        if (changed)
          await tx.execute(
            sql`UPDATE knowledge_bases SET revision=revision+1,updated_at=now(),build_state='unindexed' WHERE id=${id}`,
          );
        await this.audit.write(
          {
            actorId: actor.id,
            actorRole: actor.role,
            action: 'knowledge.file.permissions',
            targetType: 'knowledge_base_member',
            targetId: memberId,
            idempotencyKey: `${scope}:${key}`,
            detail: { allowMaterialize: input.allowMaterialize, deleted: input.deleted },
          },
          tx,
        );
      });
      return this.base(id);
    });
  }
  async job(id: string) {
    const [job] = await this.query(sql`SELECT * FROM knowledge_jobs WHERE id=${id}`);
    if (!job) throw new NotFoundException('任务不可用');
    return {
      job,
      events: await this.query(
        sql`SELECT * FROM knowledge_job_events WHERE job_id=${id} ORDER BY event_seq`,
      ),
    };
  }
  async cancel(actor: CurrentUser, id: string, key: string) {
    const scope = `admin.knowledge.job.cancel:${actor.id}`;
    return this.executeIdempotent(scope, key, { id }, {}, async () => {
      await this.database().transaction(async (tx) => {
        const jobs = rows<{ kb_id: string; input_revision: number; source_id: string | null }>(
          await tx.execute(
            sql`UPDATE knowledge_jobs SET state='cancelled',fencing_token=fencing_token+1,lease_until=NULL,updated_at=now() WHERE id=${id} AND state NOT IN ('ready','failed','empty','cancelled') RETURNING kb_id,input_revision,source_id`,
          ),
        );
        if (jobs[0]) {
          await tx.execute(
            sql`UPDATE knowledge_base_members SET visibility='superseded' WHERE kb_id=${jobs[0].kb_id} AND visibility='candidate' AND origin->>'syncJobId'=${id}`,
          );
          await tx.execute(
            sql`UPDATE knowledge_bases SET build_state='cancelled',updated_at=now() WHERE id=${jobs[0].kb_id} AND revision=${jobs[0].input_revision}`,
          );
          if (jobs[0].source_id) {
            await tx.execute(
              sql`UPDATE knowledge_sync_runs SET state='cancelled',error_code='SYNC_CANCELLED',updated_at=now() WHERE id=${id}`,
            );
            await tx.execute(
              sql`UPDATE knowledge_sources SET status=CASE WHEN status='revoked' THEN 'revoked' ELSE 'active' END,last_error_code='SYNC_CANCELLED',updated_at=now() WHERE id=${jobs[0].source_id}`,
            );
          }
          await this.audit.write(
            {
              actorId: actor.id,
              actorRole: actor.role,
              action: jobs[0].source_id ? 'knowledge.source.sync.cancel' : 'knowledge.job.cancel',
              targetType: 'knowledge_job',
              targetId: id,
              idempotencyKey: `${scope}:${key}`,
              detail: { jobId: id, sourceId: jobs[0].source_id, state: 'cancelled' },
            },
            tx,
          );
        }
      });
      return this.job(id);
    });
  }
}
