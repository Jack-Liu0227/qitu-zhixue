import { RUNTIME_TOOL_CATALOG } from '@qitu/contracts';
import type { ManagedKnowledgeScope } from '../ai-tutor/tutor-knowledge-access';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ModelRuntimeTool } from '@qitu/model-runtime';
import {
  KnowledgeCenterService,
  type KnowledgeBaseRow,
  type KnowledgeMember,
  checksum,
} from './knowledge-center.service';
import { KnowledgeEngineService } from './knowledge-engine.service';
import { libraryEngine } from './knowledge-library.service';

/** Read-only access to administrator-managed bases. Projects never provision or own a base. */
@Injectable()
export class KnowledgeRetrievalService {
  private readonly logger = new Logger(KnowledgeRetrievalService.name);
  constructor(
    private readonly center: KnowledgeCenterService,
    private readonly engine: KnowledgeEngineService,
  ) {}

  private async attestRead(base: KnowledgeBaseRow, citationId: string, title: string, scope?: ManagedKnowledgeScope, fingerprint?: string, sourceIdentity?: unknown) {
    if (!scope?.recordReadEvidence) return {};
    const connection = await this.connection(base);
    const kb = connection?.external_ref.remoteKnowledgeBaseId;
    if (!connection || connection.engine.provider !== 'ima' || !kb || !scope.knowledgeBaseIds?.includes(kb)
      || fingerprint && connection.fingerprint !== fingerprint) {
      throw new NotFoundException('资料不可用');
    }
    // Stable content identity permits reuse; authorization still comes from this scoped read.
    const documentRefHash = checksum(JSON.stringify({ source: sourceIdentity ?? citationId, fingerprint: connection.fingerprint }));
    const sourceRef = `knowledge-read:${checksum(JSON.stringify([scope.key, kb, documentRefHash]))}`;
    if (!await scope.recordReadEvidence({ sourceRef, knowledgeBaseId: kb, documentRefHash, title,
      expiresAt: Date.now() + 5 * 60_000 })) throw new NotFoundException('资料不可用');
    return { evidence_ref: sourceRef };
  }

  private async connection(base: KnowledgeBaseRow) {
    const [connection] = await this.center.query<{
      id: string;
      external_ref: Record<string, string>;
      status: string;
    }>(
      sql`SELECT id,external_ref,status FROM knowledge_base_connections WHERE kb_id=${base.id} AND status='ready'`,
    );
    if (!connection) return null;
    const { config } = await this.center.configuration();
    const saved = config.knowledgeEngines[base.engine_instance_id ?? ''];
    if (!saved?.enabled) return null;
    const engine = libraryEngine(base, saved);
    return { ...connection, engine, fingerprint: checksum(JSON.stringify({ connection, engine })) };
  }

  private async remoteSearch(
    studentId: string,
    assistantId: string,
    base: KnowledgeBaseRow,
    query: string,
    topK: number,
    scope?: ManagedKnowledgeScope,
  ) {
    const connection = await this.connection(base);
    if (!connection) return null;
    const receipt = await this.engine.execute(connection.engine, {
      operation: 'search',
      query,
      topK,
      externalRef: connection.external_ref,
      remoteKnowledgeBaseId: connection.external_ref.remoteKnowledgeBaseId,
    });
    if (!receipt.ok) return { failure: this.retrievalFailure(receipt.errorCode) };
    const fresh = (await this.accessible(studentId, assistantId, scope)).find((b) => b.id === base.id);
    if (!fresh || (await this.connection(fresh))?.fingerprint !== connection.fingerprint) return [];
    const manifest = receipt.manifest ?? {};
    const data =
      manifest.data && typeof manifest.data === 'object'
        ? (manifest.data as Record<string, unknown>)
        : manifest;
    const candidates = [
      manifest.items,
      data.chunks,
      data.sources,
      manifest.sources,
      receipt.hits,
    ].find(Array.isArray) as Record<string, unknown>[] | undefined;
    const output = [];
    for (const item of (candidates ?? []).slice(0, topK)) {
      const text = String(
        item.text ?? item.content ?? item.highlight_content ?? item.snippet ?? '',
      ).slice(0, 24000);
      if (!text.trim()) continue;
      const title = String(item.title ?? item.document_name ?? item.file_path ?? base.name).slice(
        0,
        300,
      );
      const sourceId = String(item.media_id ?? item.id ?? item.memberId ?? checksum(text)).slice(
        0,
        300,
      );
      const id = checksum(
        `${scope?.key ?? studentId}:${base.id}:${assistantId}:${connection.fingerprint}:${sourceId}:${text}`,
      );
      const origin = { scopeDigest: checksum(scope?.key ?? studentId), kind: 'linked-knowledge', provider: connection.engine.provider, sourceId };
      await this.center.query(
        sql`INSERT INTO knowledge_remote_evidence(id,kb_id,assistant_id,fingerprint,title,content,origin,expires_at) VALUES(${id},${base.id},${assistantId},${connection.fingerprint},${title},${text},${JSON.stringify(origin)}::jsonb,now()+interval '24 hours') ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at RETURNING id`,
      );
      output.push({
        citationId: `external~${id}`,
        knowledgeBaseId: base.id,
        knowledgeBase: base.name,
        indexVersionId: connection.id,
        title,
        text,
        origin,
        locator: null,
        score: typeof item.score === 'number' ? item.score : null,
      });
    }
    return output;
  }

  private retrievalFailure(code?: string): 'UPSTREAM_DENIED' | 'UPSTREAM_UNAVAILABLE' {
    const reason = ['IMA_CREDENTIALS_REJECTED', 'IMA_ACCESS_DENIED', 'SOURCE_NOT_AUTHORIZED'].includes(code ?? '')
      ? 'UPSTREAM_DENIED' : 'UPSTREAM_UNAVAILABLE';
    this.logger.warn(JSON.stringify({ event: 'knowledge.retrieval.failed', reason }));
    return reason;
  }

  private async accessible(studentId: string, assistantId: string, scope?: ManagedKnowledgeScope) {
    if (!scope || scope.knowledgeBaseIds?.length === 0 || !(await this.center.canRetrieve(assistantId))) return [];
    const ceiling = scope.knowledgeBaseIds === null ? sql`true` : sql`EXISTS (
      SELECT 1 FROM knowledge_base_connections c WHERE c.kb_id=k.id AND c.status='ready'
      AND c.external_ref->>'remoteKnowledgeBaseId' IN (${sql.join(scope.knowledgeBaseIds.map(id => sql`${id}`), sql`, `)}))`;
    const bases = await this.center.query<KnowledgeBaseRow>(sql`SELECT k.* FROM knowledge_bases k
      JOIN users u ON u.id=${studentId}
      JOIN knowledge_base_agent_bindings b ON b.kb_id=k.id AND b.agent_kind='admin_assistant'
        AND b.agent_id=${assistantId} AND b.mode='retrieve' AND b.enabled=true
      WHERE k.lifecycle='active' AND k.library_settings->>'enabled' IS DISTINCT FROM 'false' AND (k.kind='platform' OR
        (k.kind='school' AND k.school_id=u.school_id) OR
        (k.kind='student' AND k.owner_user_id=u.id))
        AND ${ceiling} ORDER BY (k.library_settings->>'isDefault'='true') DESC NULLS LAST,k.id`);
    if (scope.knowledgeBaseIds === null) return bases;
    const allowed = scope.knowledgeBaseIds;
    const decisions = await Promise.all(bases.map(async base => {
      const connection = await this.connection(base);
      return connection?.engine.provider === 'ima' && allowed.includes(connection.external_ref.remoteKnowledgeBaseId ?? '') ? base : null;
    }));
    return decisions.filter((base): base is KnowledgeBaseRow => base !== null);
  }

  private async members(base: KnowledgeBaseRow) {
    return this.center.query<KnowledgeMember>(sql`SELECT m.* FROM knowledge_base_members m
      LEFT JOIN knowledge_sources s ON s.id=m.origin->>'sourceId'
      WHERE m.kb_id=${base.id} AND m.visibility='active'
        AND (m.origin->>'kind' IS DISTINCT FROM 'managed-source' OR s.status<>'revoked')`);
  }

  private async snapshot(base: KnowledgeBaseRow) {
    if (!base.active_index_version_id) return null;
    const { config } = await this.center.configuration();
    const registered = config.knowledgeEngines[base.engine_instance_id ?? ''];
    const engine = registered ? libraryEngine(base, registered) : undefined;
    if (!engine?.enabled) return null;
    const [version] = await this.center.query<{
      config_snapshot: { engine: unknown };
      manifest: { memberIds?: string[] };
    }>(
      sql`SELECT config_snapshot,manifest FROM knowledge_index_versions WHERE id=${base.active_index_version_id} AND kb_id=${base.id} AND status='ready'`,
    );
    if (!version || JSON.stringify(version.config_snapshot.engine) !== JSON.stringify(engine))
      return null;
    const members = (await this.members(base)).filter((m) =>
      version.manifest.memberIds?.includes(m.id),
    );
    return { engine, members };
  }

  async search(studentId: string, assistantId: string, query: string, topK = 5, scope?: ManagedKnowledgeScope) {
    if (!await scope?.authorizeTool?.('knowledge_search'))
      return { state: 'CAPABILITY_NOT_AUTHORIZED', reason: 'TOOL_REVOKED', evidence: [] };
    if (!(await this.center.canRetrieve(assistantId)))
      return { state: 'CAPABILITY_NOT_AUTHORIZED', reason: 'RETRIEVAL_DISABLED', evidence: [] };
    if (scope?.knowledgeBaseIds?.length === 0) return { state: 'PROJECT_KNOWLEDGE_SCOPE_UNAVAILABLE', evidence: [] };
    const bases = await this.accessible(studentId, assistantId, scope);
    const failures: Array<'UPSTREAM_DENIED' | 'UPSTREAM_UNAVAILABLE'> = [];
    const evidence: {
      citationId: string;
      knowledgeBaseId: string;
      knowledgeBase: string;
      indexVersionId: string;
      title: string;
      text: string;
      origin: Record<string, unknown>;
      locator: Record<string, unknown> | null;
      score: number | null;
    }[] = [];
    // Bound work per turn. A large catalogue does not trigger unbounded engine calls.
    for (const base of bases.slice(0, 20)) {
      const linked = await this.remoteSearch(
        studentId,
        assistantId,
        base,
        query.slice(0, 2000),
        topK,
        scope,
      );
      if (linked) {
        if ('failure' in linked) failures.push(linked.failure);
        else evidence.push(...linked);
        continue;
      }
      const snapshot = await this.snapshot(base);
      if (!snapshot?.members.length) continue;
      const receipt = await this.engine.execute(snapshot.engine, {
        operation: 'search',
        kbId: base.id,
        versionId: base.active_index_version_id,
        query: query.slice(0, 2000),
        allowedMemberIds: snapshot.members.map((m) => m.id),
        topK,
      });
      if (!receipt.ok) { failures.push(this.retrievalFailure(receipt.errorCode)); continue; }
      // Revocation, scope, index replacement and source mutation take effect in this turn.
      const fresh = (await this.accessible(studentId, assistantId, scope)).find((k) => k.id === base.id);
      if (!fresh || fresh.active_index_version_id !== base.active_index_version_id) continue;
      const current = await this.snapshot(fresh);
      if (!current || JSON.stringify(current.engine) !== JSON.stringify(snapshot.engine)) continue;
      for (const hit of receipt.hits ?? []) {
        const member = snapshot.members.find(
          (m) =>
            m.id === hit.memberId &&
            current.members.some((f) => f.id === m.id && f.checksum === m.checksum),
        );
        if (!member || !hit.text) continue;
        evidence.push({
          citationId: `${base.active_index_version_id}~${member.id}`,
          knowledgeBaseId: base.id,
          knowledgeBase: base.name,
          indexVersionId: base.active_index_version_id!,
          title: member.title,
          text: hit.text,
          origin: member.origin,
          locator: hit.locator,
          score: hit.score,
        });
      }
    }
    if (!await scope?.authorizeTool?.('knowledge_search')) return { state: 'CAPABILITY_NOT_AUTHORIZED', evidence: [] };
    evidence.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (!evidence.length && failures.length) return {
      state: 'KNOWLEDGE_RETRIEVAL_FAILED', reason: failures.includes('UPSTREAM_DENIED') ? 'UPSTREAM_DENIED' : 'UPSTREAM_UNAVAILABLE', evidence,
    };
    return {
      state: evidence.length ? 'ready' : 'NO_KNOWLEDGE_EVIDENCE',
      evidence: evidence.slice(0, topK),
    };
  }

  async read(studentId: string, assistantId: string, citationId: string, scope?: ManagedKnowledgeScope) {
    if (!await scope?.authorizeTool?.('knowledge_read') || !(await this.center.canRetrieve(assistantId))) throw new NotFoundException('资料不可用');
    if (citationId.startsWith('external~')) {
      const [record] = await this.center.query<{
        kb_id: string;
        fingerprint: string;
        title: string;
        content: string;
        origin: Record<string, unknown>;
      }>(
        sql`SELECT kb_id,fingerprint,title,content,origin FROM knowledge_remote_evidence WHERE id=${citationId.slice(9)} AND assistant_id=${assistantId} AND origin->>'scopeDigest'=${checksum(scope?.key ?? studentId)} AND expires_at>now()`,
      );
      const base =
        record &&
        (await this.accessible(studentId, assistantId, scope)).find((b) => b.id === record.kb_id);
      if (!await scope?.authorizeTool?.('knowledge_read') || !record || !base || (await this.connection(base))?.fingerprint !== record.fingerprint)
        throw new NotFoundException('资料不可用');
      return {
        citationId,
        title: record.title,
        text: record.content,
        origin: record.origin,
        knowledgeBase: base.name,
        locator: null,
        ...await this.attestRead(base, citationId, record.title, scope, record.fingerprint, { id: record.origin.sourceId, content: record.content }),
      };
    }
    const parts = citationId.split('~');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new NotFoundException('资料不可用');
    const [versionId, memberId] = parts;
    const base = (await this.accessible(studentId, assistantId, scope)).find(
      (k) => k.active_index_version_id === versionId,
    );
    if (!base) throw new NotFoundException('资料不可用');
    const snapshot = await this.snapshot(base);
    const member = snapshot?.members.find((m) => m.id === memberId);
    if (!member || !(await this.center.canRetrieve(assistantId, base.id)))
      throw new NotFoundException('资料不可用');
    const fresh = (await this.accessible(studentId, assistantId, scope)).find((k) => k.id === base.id);
    if (!await scope?.authorizeTool?.('knowledge_read') || !fresh || fresh.active_index_version_id !== versionId)
      throw new NotFoundException('资料不可用');
    return {
      citationId,
      title: member.title,
      text: member.content.slice(0, 24000),
      origin: member.origin,
      knowledgeBase: base.name,
      locator: null,
      ...await this.attestRead(base, citationId, member.title, scope),
    };
  }

  tools(studentId: string, assistantId: string, scope?: ManagedKnowledgeScope): ModelRuntimeTool[] {
    if (!scope) return [];
    return [
      {
        name: 'knowledge_search',
        description: RUNTIME_TOOL_CATALOG.find(tool => tool.id === 'knowledge_search')!.description,
        inputSchema: RUNTIME_TOOL_CATALOG.find(tool => tool.id === 'knowledge_search')!.inputSchema!,
        execute: async (args) => {
          if (
            !args ||
            typeof args !== 'object' ||
            Array.isArray(args) ||
            Object.keys(args).some((k) => !['query', 'topK'].includes(k)) ||
            typeof args.query !== 'string' ||
            !args.query.trim() ||
            args.query.length > 2000 ||
            (args.topK !== undefined &&
              (!Number.isInteger(args.topK) || Number(args.topK) < 1 || Number(args.topK) > 8))
          )
            return { isError: true, text: 'TOOL_ARGUMENT_INVALID' };
          const result = await this.search(
            studentId,
            assistantId,
            args.query,
            args.topK as number | undefined,
            scope,
          );
          if (result.state === 'NO_KNOWLEDGE_EVIDENCE') return { outcome: 'empty', text: JSON.stringify(result) };
          if (result.state === 'KNOWLEDGE_RETRIEVAL_FAILED') return { isError: true,
            text: `KNOWLEDGE_${result.reason}. Retrieval failed; this is not an empty search. Do not repeat the same request or claim the textbook was verified. ${JSON.stringify(result)}` };
          if (result.state !== 'ready') return { isError: true,
            text: `KNOWLEDGE_${'reason' in result ? result.reason : 'PROJECT_SCOPE_UNAVAILABLE'}. Scope is no longer authorized. Do not retry the same request; explain the missing authorization. ${JSON.stringify(result)}` };
          return { outcome: 'retrieved', text: JSON.stringify(result) };
        },
      },
      {
        name: 'knowledge_read',
        description: RUNTIME_TOOL_CATALOG.find(tool => tool.id === 'knowledge_read')!.description,
        inputSchema: RUNTIME_TOOL_CATALOG.find(tool => tool.id === 'knowledge_read')!.inputSchema!,
        execute: async (args) => {
          if (
            !args ||
            typeof args !== 'object' ||
            Array.isArray(args) ||
            Object.keys(args).some((k) => k !== 'citationId') ||
            typeof args.citationId !== 'string'
          )
            return { isError: true, text: 'TOOL_ARGUMENT_INVALID' };
          try {
            return {
              isError: false, outcome: 'retrieved',
              text: JSON.stringify(await this.read(studentId, assistantId, args.citationId, scope)),
            };
          } catch {
            return { isError: true, text: 'KNOWLEDGE_SOURCE_UNAVAILABLE. Search again and copy an exact citationId returned in this scope. Do not invent a citation.' };
          }
        },
      },
    ];
  }
}
