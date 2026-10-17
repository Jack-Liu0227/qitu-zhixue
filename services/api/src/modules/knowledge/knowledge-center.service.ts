import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { adminAssistants, runtimeMcpServers, modelModels, type Database } from '@qitu/database';
import { sql, type SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { CurrentUser } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import type { ParsedUpload } from './knowledge-upload.service';
import { AuditWriter } from '../../common/audit/audit.service';
import {
  ENGINE_CATALOG,
  PROJECT_TOOL,
  record,
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
  ) {}
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
    if (latest) return latest;
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
          description: '项目原文索引与检索',
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
          ...PROJECT_TOOL,
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
      const registered = servers.find((s) => s.id === id);
      // Tool catalog comes from the registered bridge, never a model supplied tool name.
      if (!registered || (server.tools as string[]).some((t) => !registered.toolIds.includes(t)))
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
      for (const [id, server] of Object.entries(validated.config.mcpServers))
        await tx.execute(
          sql`UPDATE runtime_mcp_servers SET label=${server.name as string},enabled=${server.enabled as boolean},updated_at=now() WHERE id=${id}`,
        );
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

  async canRetrieve(assistantId: string) {
    const { config } = await this.configuration();
    const tool = config.platformTools['project-knowledge'];
    const assistants = await this.database().select().from(adminAssistants);
    return (
      tool.enabled &&
      tool.boundAssistants.includes(assistantId) &&
      assistants.some((a) => a.id === assistantId && a.enabled)
    );
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
      sql`SELECT k.*, (SELECT count(*)::int FROM knowledge_base_members m WHERE m.kb_id=k.id AND m.visibility='active') document_count FROM knowledge_bases k WHERE lifecycle<>'deleted' ORDER BY updated_at DESC`,
    );
  }
  async base(id: string) {
    const base = (await this.bases()).find((b) => b.id === id);
    if (!base) throw new NotFoundException('知识库不可用');
    return {
      ...base,
      files: await this.query<Omit<KnowledgeMember, 'content'>>(
        sql`SELECT id,kb_id,title,checksum,document_id,source_revision,origin,visibility FROM knowledge_base_members WHERE kb_id=${id} AND visibility='active' ORDER BY created_at`,
      ),
      versions: await this.query(
        sql`SELECT id,status,manifest,created_at FROM knowledge_index_versions WHERE kb_id=${id} ORDER BY created_at DESC`,
      ),
      jobs: await this.query(
        sql`SELECT * FROM knowledge_jobs WHERE kb_id=${id} ORDER BY created_at DESC`,
      ),
    };
  }
  async createBase(actor: CurrentUser, body: unknown, key: string) {
    const input = record(body);
    if (
      Object.keys(input).some((k) => !['name', 'engineInstanceId'].includes(k)) ||
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
    const [existing] = await this.query<KnowledgeBaseRow>(
      sql`SELECT * FROM knowledge_bases WHERE id=${id}`,
    );
    if (
      existing &&
      (existing.name !== input.name.trim() ||
        existing.engine_instance_id !== input.engineInstanceId)
    )
      throw new ConflictException('幂等键已用于其他知识库');
    await this.database().execute(
      sql`INSERT INTO knowledge_bases(id,name,kind,engine_instance_id,build_state) VALUES(${id},${input.name.trim()},'platform',${input.engineInstanceId},'unindexed') ON CONFLICT DO NOTHING`,
    );
    const saved = await this.base(id);
    if (saved.name !== input.name.trim() || saved.engine_instance_id !== input.engineInstanceId)
      throw new ConflictException('幂等键已用于其他知识库');
    return saved;
  }
  async addFile(actor: CurrentUser, id: string, body: unknown, key: string, upload?: ParsedUpload) {
    const base = await this.base(id);
    const input = record(body);
    if (base.kind === 'project' || base.lifecycle !== 'active')
      throw new BadRequestException('项目资料由准备任务管理');
    if (
      Object.keys(input).some((k) => !['title', 'content', 'allowMaterialize'].includes(k)) ||
      typeof input.title !== 'string' ||
      !input.title.trim() ||
      input.title.length > 160 ||
      typeof input.content !== 'string' ||
      !input.content.trim() ||
      Buffer.byteLength(input.content) > 5 * 1024 * 1024 ||
      typeof input.allowMaterialize !== 'boolean'
    )
      throw new BadRequestException('资料需包含标题、正文和导入许可，正文不超过 5 MiB');
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
        sql`INSERT INTO knowledge_base_members(id,kb_id,title,content,checksum,source_revision,origin) VALUES(${memberId},${id},${input.title},${input.content},${hash},${hash},${JSON.stringify({ kind: 'admin-upload', canMaterialize: input.allowMaterialize, reviewedBy: actor.id, requestHash, ...fileMetadata })}::jsonb) ON CONFLICT DO NOTHING`,
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
        sql`INSERT INTO knowledge_jobs(id,kb_id,operation,input_revision) VALUES(${jobId},${id},${base.kind === 'project' ? 'prepare' : 'index'},${revision})`,
      );
    });
    return this.base(id);
  }
  async file(id: string, memberId: string) {
    await this.base(id);
    const [file] = await this.query<KnowledgeMember>(
      sql`SELECT * FROM knowledge_base_members WHERE kb_id=${id} AND id=${memberId} AND visibility='active'`,
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
  async updateFile(actor: CurrentUser, id: string, memberId: string, body: unknown) {
    const base = await this.base(id);
    const input = record(body);
    if (base.kind === 'project' || base.lifecycle !== 'active')
      throw new BadRequestException('项目资料由准备任务管理');
    if (
      Object.keys(input).some((k) => !['allowMaterialize', 'deleted'].includes(k)) ||
      !Object.keys(input).length ||
      Object.values(input).some((v) => typeof v !== 'boolean')
    )
      throw new BadRequestException('资料许可或删除参数无效');
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
          detail: input,
        },
        tx,
      );
    });
    return this.base(id);
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
  async cancel(id: string) {
    await this.database().transaction(async (tx) => {
      const jobs = rows<{ kb_id: string; input_revision: number }>(
        await tx.execute(
          sql`UPDATE knowledge_jobs SET state='cancelled',fencing_token=fencing_token+1,lease_until=NULL,updated_at=now() WHERE id=${id} AND state NOT IN ('ready','failed','empty','cancelled') RETURNING kb_id,input_revision`,
        ),
      );
      if (jobs[0])
        await tx.execute(
          sql`UPDATE knowledge_bases SET build_state='cancelled',updated_at=now() WHERE id=${jobs[0].kb_id} AND revision=${jobs[0].input_revision}`,
        );
    });
    return this.job(id);
  }
}
