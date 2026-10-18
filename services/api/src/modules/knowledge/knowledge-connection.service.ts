import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CurrentUser } from '@qitu/contracts';
import { KnowledgeCenterService, checksum, rows } from './knowledge-center.service';
import { AuditWriter } from '../../common/audit/audit.service';
import {
  parseKnowledgeBaseConnection,
  record,
  type KnowledgeBaseMode,
} from './knowledge-center.config';
import { KnowledgeEngineService } from './knowledge-engine.service';
import { KnowledgeLinkProbeService } from './knowledge-link-probe.service';
import {
  IdempotencyStore,
  hashIdempotentInput,
  throwHttpForIdempotencyError,
} from '../../common/idempotency';

/** Connection lifecycle is separate from indexed KB lifecycle. External resources are pointers. */
@Injectable()
export class KnowledgeConnectionService {
  constructor(
    private readonly center: KnowledgeCenterService,
    private readonly engine: KnowledgeEngineService,
    private readonly linked: KnowledgeLinkProbeService,
    private readonly audit: AuditWriter,
    @Optional() @Inject(IdempotencyStore) private readonly idempotency?: IdempotencyStore,
  ) {}

  private async prepare(body: unknown) {
    const input = record(body);
    if (
      Object.keys(input).some(
        (field) =>
          ![
            'name',
            'engineInstanceId',
            'mode',
            'retrievalMode',
            'storageWorkspaceRef',
            'connection',
            'embeddingModelRef',
          ].includes(field),
      ) ||
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 160 ||
      typeof input.engineInstanceId !== 'string'
    )
      throw new BadRequestException({ code: 'CONFIG_INVALID', message: '知识库创建请求无效' });
    const mode = (input.mode ?? 'create_new') as KnowledgeBaseMode;
    const { config } = await this.center.configuration();
    const engine = config.knowledgeEngines[input.engineInstanceId];
    if (!engine?.enabled)
      throw new BadRequestException({
        code: 'ENGINE_NOT_CONFIGURED',
        message: '请先配置并启用所选引擎',
      });
    const defaults: Record<string, string> = {};
    if (
      ['weknora', 'lightrag-server', 'kiwix'].includes(engine.provider) &&
      engine.config.server_url
    )
      defaults.serverUrl = String(engine.config.server_url);
    if (['weknora', 'ima'].includes(engine.provider) && engine.config.remoteKnowledgeBaseId)
      defaults.remoteKnowledgeBaseId = String(engine.config.remoteKnowledgeBaseId);
    const connection = parseKnowledgeBaseConnection(engine.provider, mode, {
      ...defaults,
      ...record(input.connection ?? {}),
    });
    if (mode === 'link_existing' && engine.provider === 'pageindex')
      throw new BadRequestException({
        code: 'REMOTE_CONNECTION_UNSUPPORTED',
        message: 'PageIndex Cloud 不支持从本地目录连接',
      });
    if (mode === 'link_existing' && connection.flavour === 'linked') {
      const expectedSignature =
        typeof engine.config.embeddingModelRef === 'string'
          ? engine.config.embeddingModelRef
          : undefined;
      const probe = await this.linked.probe(
        engine.provider,
        connection.externalRef.externalPath!,
        expectedSignature,
        engine,
      );
      if (!probe.ok || !probe.realPath)
        throw new BadRequestException({
          code: probe.errorCode ?? 'LINKED_INDEX_NOT_READY',
          message: '外部索引预检失败，请检查路径和嵌入模型',
        });
      connection.externalRef.externalPath = probe.realPath;
      connection.externalRef.indexVersion = probe.version!;
      if (probe.embeddingSignature)
        connection.externalRef.embeddingSignature = probe.embeddingSignature;
    }
    let receipt: {
      ok: boolean;
      status: string;
      errorCode?: string;
      manifest?: Record<string, unknown>;
    } | null = null;
    const adapter = this.engine.adapterFor(engine.provider);
    if (
      ['ima', 'weknora'].includes(engine.provider) &&
      !connection.externalRef.remoteKnowledgeBaseId
    )
      throw new BadRequestException({
        code: 'REMOTE_RESOURCE_NOT_FOUND',
        message: '请填写远端知识库 ID',
      });
    if (adapter && connection.flavour) {
      receipt = await adapter.connect(engine, connection.externalRef);
      if (!receipt.ok)
        throw new BadRequestException({
          code: receipt.errorCode ?? 'REMOTE_CONNECTION_FAILED',
          message: '远端知识库连接失败',
        });
    } else if (connection.flavour && connection.flavour !== 'linked') {
      throw new BadRequestException({
        code: 'REMOTE_CONNECTION_UNSUPPORTED',
        message: '该连接器尚无已验证的服务端检索适配器',
      });
    }
    return { input, mode, engine, connection, receipt };
  }
  async probe(body: unknown) {
    const prepared = await this.prepare(body);
    return {
      ok: true,
      provider: prepared.engine.provider,
      status: 'ready',
      manifest: prepared.receipt?.manifest ?? {},
    };
  }
  async createBase(actor: CurrentUser, body: unknown, key: string) {
    const { input, mode, engine, connection, receipt } = await this.prepare(body);
    if (engine.provider === 'ima' && connection.externalRef.remoteKnowledgeBaseId) {
      const current = await this.center.configuration();
      const saved = current.config.knowledgeEngines[String(input.engineInstanceId)]!;
      const allowed = Array.isArray(saved.config.allowedKnowledgeBaseIds)
        ? (saved.config.allowedKnowledgeBaseIds as string[])
        : [];
      if (!allowed.includes(connection.externalRef.remoteKnowledgeBaseId)) {
        const config = structuredClone(current.config);
        config.knowledgeEngines[String(input.engineInstanceId)]!.config.allowedKnowledgeBaseIds = [
          ...allowed,
          connection.externalRef.remoteKnowledgeBaseId,
        ];
        await this.center.save(
          actor,
          { expectedRevision: current.revision, config },
          `library-source:${key}`,
        );
      }
    }
    const creation: Record<string, unknown> = {
      name: input.name,
      engineInstanceId: input.engineInstanceId,
    };
    for (const field of ['retrievalMode', 'storageWorkspaceRef', 'embeddingModelRef'])
      if (input[field] !== undefined) creation[field] = input[field];
    const base = await this.center.createBase(actor, creation, key);
    if (!connection.flavour)
      return { ...base, mode, state: 'unindexed', connection: { status: 'not_applicable' } };
    const connectionId = `connection-${checksum(`${base.id}:${key}`).slice(0, 40)}`;
    const externalRef = { ...connection.externalRef };
    await this.center.database().transaction(async (tx) => {
      const [existing] = rows<{ id: string; external_ref: Record<string, unknown> }>(
        await tx.execute(
          sql`SELECT id,external_ref FROM knowledge_base_connections WHERE kb_id=${base.id} FOR UPDATE`,
        ),
      );
      if (existing && JSON.stringify(existing.external_ref) !== JSON.stringify(externalRef))
        throw new ConflictException({
          code: 'IDEMPOTENCY_CONFLICT',
          message: '知识库已有其他连接',
        });
      await tx.execute(
        sql`INSERT INTO knowledge_base_connections(id,kb_id,flavour,provider,external_ref,status,last_check_at) VALUES(${connectionId},${base.id},${connection.flavour},${engine.provider},${JSON.stringify(externalRef)}::jsonb,'ready',now()) ON CONFLICT(kb_id) DO NOTHING`,
      );
      await tx.execute(
        sql`UPDATE knowledge_bases SET build_state='ready',updated_at=now() WHERE id=${base.id}`,
      );
      await this.audit.write(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'knowledge.connection.create',
          targetType: 'knowledge_base',
          targetId: base.id,
          detail: { provider: engine.provider, mode },
        },
        tx,
      );
    });
    return { ...(await this.center.base(base.id)), mode, state: 'ready' };
  }

  async detach(actor: CurrentUser, id: string, key: string) {
    const base = await this.center.base(id);
    const scope = `admin.knowledge.connection.detach:${actor.id}`;
    if (!this.idempotency) throw new ServiceUnavailableException('知识中心幂等存储不可用');
    try {
      const result = await this.idempotency.execute(
        scope,
        key,
        hashIdempotentInput(scope, { id }, {}),
        async () => {
          const auditKey = `${scope}:${key}`;
          await this.center.database().transaction(async (tx) => {
            const [connection] = rows<{ flavour: string }>(
              await tx.execute(
                sql`SELECT flavour FROM knowledge_base_connections WHERE kb_id=${id} FOR UPDATE`,
              ),
            );
            if (!connection) return;
            await tx.execute(
              sql`UPDATE knowledge_base_connections SET status='revoked',last_error_code=NULL,updated_at=now() WHERE kb_id=${id}`,
            );
            await tx.execute(
              sql`UPDATE knowledge_bases SET build_state='unindexed',updated_at=now() WHERE id=${id}`,
            );
            await this.audit.write(
              {
                actorId: actor.id,
                actorRole: actor.role,
                action: 'knowledge.connection.detach',
                targetType: 'knowledge_base',
                targetId: id,
                idempotencyKey: auditKey,
                detail: { flavour: connection.flavour },
              },
              tx,
            );
          });
          return { body: await this.center.base(base.id) };
        },
      );
      return result.body;
    } catch (error) {
      throwHttpForIdempotencyError(error);
    }
  }
}
