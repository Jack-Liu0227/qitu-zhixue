import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CurrentUser } from '@qitu/contracts';
import { AuditWriter } from '../../common/audit/audit.service';
import { KnowledgeCenterService, checksum, rows } from './knowledge-center.service';
import { record, type EngineConfig } from './knowledge-center.config';
import { KnowledgeEngineService } from './knowledge-engine.service';

/** Per-library choices are separate from reusable engine defaults and never contain credentials. */
export function libraryEngine(
  base: { library_settings?: Record<string, unknown> },
  engine: EngineConfig,
): EngineConfig {
  const overrides = record(base.library_settings?.engineOverrides ?? {});
  return { ...engine, config: { ...engine.config, ...overrides } };
}

@Injectable()
export class KnowledgeLibraryService {
  constructor(
    private readonly center: KnowledgeCenterService,
    private readonly audit: AuditWriter,
    private readonly engine: KnowledgeEngineService,
  ) {}

  async manage(actor: CurrentUser, id: string, body: unknown, key: string) {
    const input = record(body);
    if (
      Object.keys(input).some(
        (k) =>
          ![
            'expectedRevision',
            'name',
            'isDefault',
            'deleted',
            'engineInstanceId',
            'createFolder',
            'moveFile',
          ].includes(k),
      ) ||
      !Number.isInteger(input.expectedRevision) ||
      (input.name !== undefined &&
        (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160)) ||
      (input.isDefault !== undefined && typeof input.isDefault !== 'boolean') ||
      (input.deleted !== undefined && input.deleted !== true)
    )
      throw new BadRequestException({ code: 'CONFIG_INVALID', message: '知识库管理参数无效' });
    if (
      input.createFolder !== undefined &&
      (typeof input.createFolder !== 'string' ||
        !input.createFolder.trim() ||
        input.createFolder.length > 160 ||
        input.createFolder.split('/').some((p) => !p || p === '..' || p === '.') ||
        input.createFolder.includes('\\'))
    )
      throw new BadRequestException('文件夹名称无效');
    const moving = input.moveFile === undefined ? null : record(input.moveFile);
    if (
      moving &&
      (Object.keys(moving).some((k) => !['memberId', 'folder'].includes(k)) ||
        typeof moving.memberId !== 'string' ||
        typeof moving.folder !== 'string')
    )
      throw new BadRequestException('文件移动参数无效');
    if (input.engineInstanceId !== undefined) {
      const { config } = await this.center.configuration();
      const selected =
        typeof input.engineInstanceId === 'string' &&
        config.knowledgeEngines[input.engineInstanceId];
      if (
        !selected ||
        !selected.enabled ||
        !['llamaindex', 'graphrag', 'lightrag', 'pageindex', 'pageindex-oss'].includes(
          selected.provider,
        )
      )
        throw new BadRequestException('请选择已启用的索引引擎');
    }
    const requestHash = checksum(JSON.stringify({ id, body }));
    const auditKey = `knowledge.library:${actor.id}:${key}`;
    return this.center.database().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(281018)`);
      const [replay] = rows<{ detail: { requestHash: string } }>(
        await tx.execute(sql`SELECT detail FROM audit_logs WHERE idempotency_key=${auditKey}`),
      );
      if (replay) {
        if (replay.detail.requestHash !== requestHash)
          throw new ConflictException('幂等键已用于其他操作');
        return input.deleted ? { id, deleted: true } : this.center.base(id);
      }
      const [base] = rows<{ revision: number; library_settings: Record<string, unknown> }>(
        await tx.execute(
          sql`SELECT revision,library_settings FROM knowledge_bases WHERE id=${id} AND lifecycle='active' FOR UPDATE`,
        ),
      );
      if (!base) throw new NotFoundException('知识库不可用');
      if (base.revision !== input.expectedRevision)
        throw new ConflictException({
          code: 'KNOWLEDGE_LIBRARY_CONFLICT',
          message: '知识库已变化，请刷新后重试',
        });
      if (input.engineInstanceId !== undefined || input.createFolder !== undefined || moving) {
        const connection = rows(
          await tx.execute(sql`SELECT id FROM knowledge_base_connections WHERE kb_id=${id}`),
        );
        if (connection.length) throw new BadRequestException('关联库只读，请在来源中管理资料');
      }
      if (input.deleted) {
        await tx.execute(
          sql`UPDATE knowledge_bases SET lifecycle='deleted',revision=revision+1,updated_at=now() WHERE id=${id}`,
        );
        await tx.execute(
          sql`UPDATE knowledge_jobs SET state='cancelled',lease_until=NULL,updated_at=now() WHERE kb_id=${id} AND state NOT IN ('ready','empty','failed','cancelled')`,
        );
        await tx.execute(
          sql`UPDATE knowledge_sources SET status='revoked',updated_at=now() WHERE kb_id=${id}`,
        );
        await tx.execute(
          sql`UPDATE knowledge_base_connections SET status='revoked',updated_at=now() WHERE kb_id=${id}`,
        );
      } else {
        if (input.isDefault === true)
          await tx.execute(
            sql`UPDATE knowledge_bases SET library_settings=library_settings||'{"isDefault":false}'::jsonb,revision=revision+1 WHERE id<>${id} AND library_settings->>'isDefault'='true'`,
          );
        const settings: Record<string, unknown> = {
          ...base.library_settings,
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.engineInstanceId !== undefined ? { engineOverrides: {} } : {}),
        };
        const folders = Array.isArray(settings.folders) ? (settings.folders as string[]) : [];
        if (input.createFolder !== undefined)
          settings.folders = [...new Set([...folders, String(input.createFolder).trim()])];
        if (moving) {
          if (moving.folder && !folders.includes(String(moving.folder)))
            throw new BadRequestException('目标文件夹不存在');
          const changed = rows(
            await tx.execute(
              sql`UPDATE knowledge_base_members SET origin=origin||${JSON.stringify({ folder: moving.folder })}::jsonb WHERE id=${String(moving.memberId)} AND kb_id=${id} AND visibility='active' RETURNING id`,
            ),
          );
          if (!changed.length) throw new NotFoundException('文件不存在');
        }
        await tx.execute(
          sql`UPDATE knowledge_bases SET name=coalesce(${input.name ? String(input.name).trim() : null},name),library_settings=${JSON.stringify(settings)}::jsonb,revision=revision+1,updated_at=now() WHERE id=${id}`,
        );
        if (input.engineInstanceId !== undefined)
          await tx.execute(
            sql`UPDATE knowledge_bases SET engine_instance_id=${String(input.engineInstanceId)},active_index_version_id=NULL,build_state='unindexed' WHERE id=${id}`,
          );
      }
      await this.audit.write(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: input.deleted ? 'knowledge.base.delete' : 'knowledge.base.settings',
          targetType: 'knowledge_base',
          targetId: id,
          idempotencyKey: auditKey,
          detail: { requestHash, deleted: Boolean(input.deleted) },
        },
        tx,
      );
      return { id, deleted: Boolean(input.deleted), revision: base.revision + 1 };
    });
  }

  private async linked(id: string) {
    const base = await this.center.base(id);
    const [connection] = await this.center.query<{ external_ref: Record<string, string> }>(
      sql`SELECT external_ref FROM knowledge_base_connections WHERE kb_id=${id} AND status='ready'`,
    );
    const { config } = await this.center.configuration();
    const engine = config.knowledgeEngines[base.engine_instance_id ?? ''];
    if (!connection || !engine?.enabled) throw new NotFoundException('关联库未连接或引擎已停用');
    return { base, connection, engine: libraryEngine(base, engine) };
  }

  async documents(id: string, folderId = '', cursor = '') {
    if (folderId.length > 512 || cursor.length > 2048)
      throw new BadRequestException('目录参数无效');
    const { connection, engine } = await this.linked(id);
    const result = await this.engine.execute(engine, {
      operation: 'documents',
      externalRef: connection.external_ref,
      folderId,
      cursor,
    });
    if (!result.ok)
      throw new BadRequestException({
        code: result.errorCode ?? 'SOURCE_DOCUMENTS_UNAVAILABLE',
        message: '此来源暂不提供文件目录，请通过已绑定助手检索，或到原服务管理文件。',
      });
    return result.manifest;
  }

  private async readDocument(
    id: string,
    documentId: string,
    folderId: string,
    cursor: string,
    original: boolean,
  ) {
    if (!documentId || documentId.length > 512) throw new BadRequestException('文件参数无效');
    const listing = await this.documents(id, folderId, cursor);
    const items = Array.isArray(listing?.items) ? (listing.items as Record<string, unknown>[]) : [];
    if (!items.some((i) => i.id === documentId)) throw new NotFoundException('文件不属于当前目录');
    const { connection, engine } = await this.linked(id);
    const receipt = await this.engine.execute(engine, {
      operation: original ? 'read_original' : 'read_document',
      externalRef: connection.external_ref,
      documentId,
      folderId,
    });
    if (!receipt.ok) throw new BadRequestException('来源正文暂不可读，请到原服务查看');
    return { receipt, title: String(items.find((i) => i.id === documentId)?.title ?? '文档') };
  }

  async originalDocument(id: string, documentId: string, folderId = '', cursor = '') {
    const { receipt, title } = await this.readDocument(id, documentId, folderId, cursor, true);
    const encoded = receipt.manifest?.body;
    if (typeof encoded !== 'string' || encoded.length > 28 * 1024 * 1024)
      throw new NotFoundException('此来源暂未提供 PDF 原文件');
    const body = Buffer.from(encoded, 'base64');
    if (body.length > 20 * 1024 * 1024 || body.subarray(0, 5).toString('ascii') !== '%PDF-')
      throw new NotFoundException('此来源暂未提供 PDF 原文件');
    return { body, mime_type: 'application/pdf', file_name: title };
  }

  async document(id: string, documentId: string, folderId = '', cursor = '') {
    const { receipt, title } = await this.readDocument(id, documentId, folderId, cursor, false);
    return {
      title,
      content: String(receipt.manifest?.content ?? ''),
      origin: { ...record(receipt.manifest?.origin ?? {}), kind: 'linked-knowledge' },
    };
  }

  async source(actor: CurrentUser, baseId: string, sourceId: string, body: unknown, key: string) {
    const input = record(body);
    if (
      Object.keys(input).some((k) => !['revoked', 'scheduleHours'].includes(k)) ||
      (!input.revoked && input.scheduleHours === undefined) ||
      (input.revoked !== undefined && input.revoked !== true) ||
      (input.scheduleHours !== undefined &&
        input.scheduleHours !== null &&
        (!Number.isInteger(input.scheduleHours) ||
          Number(input.scheduleHours) < 1 ||
          Number(input.scheduleHours) > 720))
    )
      throw new BadRequestException('来源管理参数无效');
    await this.center.base(baseId);
    const auditKey = `knowledge.source.manage:${actor.id}:${key}`;
    const requestHash = checksum(JSON.stringify({ baseId, sourceId, body }));
    await this.center.database().transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM knowledge_bases WHERE id=${baseId} AND lifecycle='active' FOR UPDATE`,
      );
      const [replay] = rows<{ detail: { requestHash: string } }>(
        await tx.execute(sql`SELECT detail FROM audit_logs WHERE idempotency_key=${auditKey}`),
      );
      if (replay) {
        if (replay.detail.requestHash !== requestHash)
          throw new ConflictException('幂等键已用于其他操作');
        return;
      }
      const found = rows(
        await tx.execute(
          sql`SELECT id FROM knowledge_sources WHERE id=${sourceId} AND kb_id=${baseId} FOR UPDATE`,
        ),
      );
      if (!found.length) throw new NotFoundException('来源不存在');
      if (input.revoked) {
        await tx.execute(
          sql`UPDATE knowledge_sources SET status='revoked',schedule_hours=NULL,next_sync_at=NULL,updated_at=now() WHERE id=${sourceId}`,
        );
        await tx.execute(
          sql`UPDATE knowledge_jobs SET state='cancelled',lease_until=NULL WHERE source_id=${sourceId} AND state NOT IN ('ready','empty','failed','cancelled')`,
        );
      } else {
        await tx.execute(
          sql`UPDATE knowledge_sources SET schedule_hours=${input.scheduleHours as number | null},next_sync_at=CASE WHEN ${input.scheduleHours === null} THEN NULL ELSE now()+${Number(input.scheduleHours ?? 0)}*interval '1 hour' END,updated_at=now() WHERE id=${sourceId}`,
        );
      }
      await this.audit.write(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'knowledge.source.manage',
          targetType: 'knowledge_source',
          targetId: sourceId,
          idempotencyKey: auditKey,
          detail: { requestHash, revoked: Boolean(input.revoked) },
        },
        tx,
      );
    });
    return this.center.base(baseId);
  }
}
