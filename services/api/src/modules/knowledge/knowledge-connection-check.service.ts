import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CurrentUser } from '@qitu/contracts';
import { sql } from 'drizzle-orm';
import { AuditWriter } from '../../common/audit/audit.service';
import { KnowledgeCenterService, checksum, rows } from './knowledge-center.service';
import { record, type PlatformKnowledgeConfig } from './knowledge-center.config';
import { KnowledgeEngineService } from './knowledge-engine.service';
import { imaConnectionMessage } from './knowledge-ima-errors';
import { libraryEngine } from './knowledge-library.service';

@Injectable()
export class KnowledgeConnectionCheckService {
  constructor(
    private readonly center: KnowledgeCenterService,
    private readonly engine: KnowledgeEngineService,
    private readonly audit: AuditWriter,
  ) {}

  async run(actor: CurrentUser, id: string, body: unknown, key: string, reconnect = false) {
    const input = record(body);
    if (
      Object.keys(input).some((k) => !['expectedRevision', 'remoteKnowledgeBaseId'].includes(k)) ||
      typeof input.expectedRevision !== 'number' ||
      !Number.isSafeInteger(input.expectedRevision) ||
      (input.remoteKnowledgeBaseId !== undefined &&
        (typeof input.remoteKnowledgeBaseId !== 'string' ||
          !input.remoteKnowledgeBaseId.trim() ||
          input.remoteKnowledgeBaseId.length > 512)) ||
      (!reconnect && input.remoteKnowledgeBaseId !== undefined) ||
      (reconnect && typeof input.remoteKnowledgeBaseId !== 'string')
    )
      throw new BadRequestException({ code: 'CONFIG_INVALID', message: '连接操作参数无效' });
    const requestHash = checksum(JSON.stringify({ id, body, reconnect }));
    const auditKey = `knowledge.connection.check:${actor.id}:${checksum(key)}`;
    const [replay] = await this.center.query<{ detail: { requestHash: string; result: object } }>(
      sql`SELECT detail FROM audit_logs WHERE idempotency_key=${auditKey}`,
    );
    if (replay) {
      if (replay.detail.requestHash !== requestHash)
        throw new ConflictException({
          code: 'IDEMPOTENCY_CONFLICT',
          message: '幂等键已用于其他连接操作',
        });
      return replay.detail.result;
    }
    const base = await this.center.base(id);
    if (
      base.revision !== input.expectedRevision ||
      base.kind === 'project' ||
      base.lifecycle !== 'active'
    )
      throw new ConflictException({
        code: 'KNOWLEDGE_LIBRARY_CONFLICT',
        message: '知识库已变化或只读，请重新读取',
      });
    const [connection] = await this.center.query<{
      external_ref: Record<string, string>;
      provider: string;
    }>(sql`SELECT external_ref,provider FROM knowledge_base_connections WHERE kb_id=${id}`);
    const { config } = await this.center.configuration();
    const configured = config.knowledgeEngines[base.engine_instance_id ?? ''];
    if (!connection || !configured?.enabled)
      throw new NotFoundException('关联连接或已启用的知识引擎不存在');
    if (reconnect && configured.provider !== 'ima')
      throw new BadRequestException({
        code: 'REMOTE_CONNECTION_UNSUPPORTED',
        message: '此来源请通过原服务管理连接',
      });
    const externalRef = { ...connection.external_ref };
    if (reconnect && typeof input.remoteKnowledgeBaseId === 'string')
      externalRef.remoteKnowledgeBaseId = input.remoteKnowledgeBaseId.trim();
    const engineHash = checksum(JSON.stringify(configured));
    const externalHash = checksum(JSON.stringify(connection.external_ref));
    const engine = libraryEngine(base, configured);
    const adapter = this.engine.adapterFor(engine.provider);
    if (!adapter)
      throw new BadRequestException({
        code: 'REMOTE_CONNECTION_UNSUPPORTED',
        message: '此引擎尚不支持远端连接检查',
      });
    let receipt = await adapter.connect(engine, externalRef);
    if (receipt.ok && engine.provider === 'ima') {
      const listed = await this.engine.execute(engine, {
        operation: 'documents',
        externalRef,
        folderId: '',
        cursor: '',
      });
      receipt = { ...listed, status: listed.status ?? (listed.ok ? 'ready' : 'unavailable') };
    }
    const errorCode = receipt.errorCode ?? (receipt.ok ? null : 'REMOTE_CONNECTION_FAILED');
    if (reconnect && !receipt.ok)
      throw new BadRequestException({
        code: errorCode,
        message: imaConnectionMessage(errorCode ?? undefined),
      });
    const checkedAt = new Date().toISOString();
    return this.center.database().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(281017)`);
      const [replayed] = rows<{ detail: { requestHash: string; result: object } }>(
        await tx.execute(sql`SELECT detail FROM audit_logs WHERE idempotency_key=${auditKey}`),
      );
      if (replayed) {
        if (replayed.detail.requestHash !== requestHash)
          throw new ConflictException({
            code: 'IDEMPOTENCY_CONFLICT',
            message: '幂等键已用于其他连接操作',
          });
        return replayed.detail.result;
      }
      const [fresh] = rows<{
        revision: number;
        engine_instance_id: string | null;
        library_settings: Record<string, unknown>;
      }>(
        await tx.execute(
          sql`SELECT revision,engine_instance_id,library_settings FROM knowledge_bases WHERE id=${id} AND lifecycle='active' FOR UPDATE`,
        ),
      );
      const [currentConnection] = rows<{ external_ref: Record<string, string> }>(
        await tx.execute(
          sql`SELECT external_ref FROM knowledge_base_connections WHERE kb_id=${id} FOR UPDATE`,
        ),
      );
      const [current] = rows<{ revision: number; config: PlatformKnowledgeConfig }>(
        await tx.execute(
          sql`SELECT revision,config FROM platform_configuration_revisions ORDER BY revision DESC LIMIT 1`,
        ),
      );
      const nowEngine = current?.config.knowledgeEngines[fresh?.engine_instance_id ?? ''];
      if (
        !fresh ||
        fresh.revision !== input.expectedRevision ||
        !nowEngine ||
        !currentConnection ||
        checksum(JSON.stringify(nowEngine)) !== engineHash ||
        checksum(JSON.stringify(currentConnection.external_ref)) !== externalHash ||
        checksum(JSON.stringify(fresh.library_settings)) !==
          checksum(JSON.stringify(base.library_settings ?? {}))
      )
        throw new ConflictException({
          code: 'KNOWLEDGE_LIBRARY_CONFLICT',
          message: '检查过程中配置已变化，请重新检查',
        });
      if (reconnect) {
        const allowed = Array.isArray(nowEngine.config.allowedKnowledgeBaseIds)
          ? nowEngine.config.allowedKnowledgeBaseIds
          : [];
        if (!allowed.includes(externalRef.remoteKnowledgeBaseId)) {
          const next = structuredClone(current.config);
          const target = next.knowledgeEngines[fresh.engine_instance_id ?? ''];
          if (!target) throw new NotFoundException('知识引擎不可用');
          target.config.allowedKnowledgeBaseIds = [...allowed, externalRef.remoteKnowledgeBaseId];
          await tx.execute(sql`INSERT INTO platform_configuration_revisions(revision,parent_revision,config,updated_by,idempotency_key,request_hash)
            VALUES(${current.revision + 1},${current.revision},${JSON.stringify(next)}::jsonb,${actor.id},${auditKey},${requestHash})`);
        }
        await tx.execute(sql`DELETE FROM knowledge_remote_evidence WHERE kb_id=${id}`);
      }
      const status = receipt.ok
        ? 'ready'
        : receipt.status === 'unreachable'
          ? 'unreachable'
          : receipt.status === 'needs_key'
            ? 'unauthorized'
            : 'error';
      await tx.execute(sql`UPDATE knowledge_base_connections SET external_ref=${JSON.stringify(externalRef)}::jsonb,
        status=${status},last_check_at=${checkedAt}::timestamptz,last_error_code=${errorCode},updated_at=now() WHERE kb_id=${id}`);
      await tx.execute(
        sql`UPDATE knowledge_bases SET revision=revision+1,updated_at=now() WHERE id=${id}`,
      );
      const result = {
        id,
        ok: receipt.ok,
        status,
        errorCode,
        checkedAt,
        revision: fresh.revision + 1,
        message: receipt.ok
          ? '连接与资源读取检查通过'
          : engine.provider === 'ima'
            ? imaConnectionMessage(errorCode ?? undefined)
            : '远端连接检查失败，请检查来源配置',
      };
      await this.audit.write(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: reconnect ? 'knowledge.connection.relink' : 'knowledge.connection.check',
          targetType: 'knowledge_base',
          targetId: id,
          idempotencyKey: auditKey,
          detail: {
            requestHash,
            result,
            previousResourceHash: externalHash,
            resourceHash: checksum(JSON.stringify(externalRef)),
          },
        },
        tx,
      );
      return result;
    });
  }
}
