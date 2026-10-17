import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ImaMcpClient, IMA_READ_TOOLS } from '../ai-tutor/ima-mcp.client';
import { KnowledgeCenterService, checksum } from './knowledge-center.service';
import type { EngineConfig } from './knowledge-center.config';

/** Server-only source importer. Capability references are used transiently, never stored. */
@Injectable()
export class KnowledgeSourceService {
  private readonly client = new ImaMcpClient();
  constructor(private readonly center: KnowledgeCenterService) {}
  async imaTools(instanceId: string, engine: EngineConfig) {
    if (
      !engine.enabled ||
      engine.provider !== 'ima' ||
      engine.config.connectionRef !== 'ima-legacy'
    )
      throw new Error('SOURCE_CONNECTION_UNAVAILABLE');
    return this.client.toolsFor(
      [
        {
          serverId: 'ima-knowledge',
          label: 'ima',
          transport: 'streamable_http',
          toolIds: [...IMA_READ_TOOLS],
        },
      ],
      async () => {
        const { config } = await this.center.configuration();
        const fresh = config.knowledgeEngines[instanceId];
        return (
          !!fresh?.enabled &&
          fresh.provider === 'ima' &&
          fresh.config.connectionRef === engine.config.connectionRef &&
          fresh.config.allowMaterialize === true &&
          Array.isArray(fresh.config.allowedKnowledgeBaseIds) &&
          JSON.stringify(fresh.config.allowedKnowledgeBaseIds) ===
            JSON.stringify(engine.config.allowedKnowledgeBaseIds)
        );
      },
    );
  }
  async discover(
    query: string,
  ): Promise<{ imported: number; failures: number; catalogComplete: boolean }> {
    const { config } = await this.center.configuration();
    let imported = 0;
    let failures = 0;
    let catalogComplete = true;
    for (const [instanceId, engine] of Object.entries(config.knowledgeEngines)) {
      if (
        engine.provider !== 'ima' ||
        !engine.enabled ||
        engine.config.allowMaterialize !== true ||
        !Array.isArray(engine.config.allowedKnowledgeBaseIds) ||
        !engine.config.allowedKnowledgeBaseIds.length
      )
        continue;
      try {
        const tools = await this.imaTools(instanceId, engine);
        const call = async (name: string, args: Record<string, unknown>) => {
          const tool = tools.find((t) => t.name === name);
          if (!tool) throw new Error('SOURCE_TOOL_UNAVAILABLE');
          const response = await tool.execute(args);
          if (response.isError) throw new Error('SOURCE_READ_FAILED');
          return JSON.parse(response.text) as Record<string, unknown>;
        };
        const catalog = await call('ima_list_knowledge_bases', {});
        const permitted = Array.isArray(catalog.knowledge_bases)
          ? (catalog.knowledge_bases as { knowledge_base_id: string; name: string }[])
          : [];
        for (const remoteId of engine.config.allowedKnowledgeBaseIds.slice(0, 10) as string[]) {
          const remote = permitted.find((b) => b.knowledge_base_id === remoteId);
          if (!remote) {
            failures++;
            continue;
          }
          const kbId = `ima-${checksum(`${instanceId}:${remoteId}`).slice(0, 32)}`;
          await this.center
            .database()
            .execute(
              sql`INSERT INTO knowledge_bases(id,name,kind,engine_instance_id,build_state) VALUES(${kbId},${remote.name || 'ima 资料库'},'platform',${instanceId},'connected') ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=now()`,
            );
          const found = await call('ima_search_knowledge', {
            knowledge_base_id: remoteId,
            query: query.slice(0, 500),
            cursor: '',
          });
          catalogComplete = catalogComplete && found.is_end === true;
          const items = Array.isArray(found.items)
            ? (found.items as Record<string, unknown>[])
            : [];
          for (const item of items.slice(0, 8)) {
            if (
              item.kind !== 'document' ||
              typeof item.document_ref !== 'string' ||
              typeof item.document_id !== 'string'
            )
              continue;
            try {
              // Original text/pages only. Excerpts and AI summaries never become materialized documents.
              let content = '';
              let offset = 0;
              let page = 1;
              let complete = false;
              let format = '';
              let totalPages: number | null = null;
              for (let batch = 0; batch < 40; batch++) {
                const result = await call('ima_read_document', {
                  document_ref: item.document_ref,
                  start_page: page,
                  page_count: 1,
                  max_chars: 20000,
                  offset,
                });
                if (result.available !== true) break;
                format = String(result.format);
                if (format === 'text' && typeof result.content === 'string') {
                  content += result.content;
                  offset += result.content.length;
                  if (result.truncated === false && offset === result.total_chars) {
                    complete = true;
                    break;
                  }
                  if (!result.content.length) break;
                } else if (format === 'pdf_text' && Array.isArray(result.pages)) {
                  const pages = result.pages as { page: number; text: string }[];
                  if (
                    !pages.length ||
                    pages.some((p) => typeof p.text !== 'string' || !p.text.trim()) ||
                    result.truncated === true
                  )
                    break;
                  content += pages.map((p) => `\n[原文第 ${p.page} 页]\n${p.text}`).join('\n');
                  totalPages = Number(result.total_pages);
                  page++;
                  if (page > totalPages) {
                    complete = true;
                    break;
                  }
                } else break;
                if (Buffer.byteLength(content) > 1024 * 1024) break;
              }
              if (!complete || !content.trim() || Buffer.byteLength(content) > 1024 * 1024) {
                failures++;
                continue;
              }
              const hash = checksum(content);
              const memberId = `ima-doc-${checksum(`${instanceId}:${remoteId}:${item.document_id}:${hash}`).slice(0, 40)}`;
              const origin = {
                kind: 'ima',
                engineInstanceId: instanceId,
                connectionRef: engine.config.connectionRef,
                remoteKnowledgeBaseId: remoteId,
                remoteDocumentId: item.document_id,
                sourceRevision: hash,
                format,
                totalPages,
                canMaterialize: true,
              };
              await this.center.database().transaction(async (tx) => {
                await tx.execute(sql`SELECT id FROM knowledge_bases WHERE id=${kbId} FOR UPDATE`);
                await tx.execute(
                  sql`UPDATE knowledge_base_members SET visibility='superseded' WHERE kb_id=${kbId} AND origin->>'remoteDocumentId'=${item.document_id as string} AND id<>${memberId}`,
                );
                await tx.execute(
                  sql`INSERT INTO knowledge_base_members(id,kb_id,title,content,checksum,source_revision,origin) VALUES(${memberId},${kbId},${String(item.title).slice(0, 160)},${content},${hash},${hash},${JSON.stringify(origin)}::jsonb) ON CONFLICT(id) DO UPDATE SET visibility='active'`,
                );
              });
              imported++;
            } catch {
              failures++;
            }
          }
        }
      } catch {
        failures++;
      }
    }
    return { imported, failures, catalogComplete };
  }
}
