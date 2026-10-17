import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TutorKnowledgeSearchResult } from '@qitu/ai-client';
import type { ModelRuntimeTool } from '@qitu/model-runtime';
import {
  KnowledgeCenterService,
  type KnowledgeMember,
  type KnowledgeBaseRow,
} from './knowledge-center.service';
import { KnowledgeEngineService } from './knowledge-engine.service';
import { materializationAllowed, type SourcePolicy } from './knowledge-source.policy';

@Injectable()
export class ProjectKnowledgeService {
  constructor(
    private readonly center: KnowledgeCenterService,
    private readonly engine: KnowledgeEngineService,
  ) {}
  async owned(studentId: string, projectId: string) {
    const [base] = await this.center.query<KnowledgeBaseRow>(
      sql`SELECT k.*,u.school_id FROM knowledge_bases k JOIN project_knowledge_bindings b ON b.kb_id=k.id JOIN projects p ON p.id=b.project_id JOIN users u ON u.id=p.student_user_id WHERE b.project_id=${projectId} AND p.student_user_id=${studentId} AND k.lifecycle='active'`,
    );
    if (!base) throw new NotFoundException('项目资料不可用');
    return base;
  }
  async status(studentId: string, projectId: string) {
    const base = await this.owned(studentId, projectId);
    const [job] = await this.center.query<{ id: string; state: string }>(
      sql`SELECT id,state FROM knowledge_jobs WHERE kb_id=${base.id} ORDER BY created_at DESC LIMIT 1`,
    );
    const { config } = await this.center.configuration();
    const effectiveState =
      base.active_index_version_id &&
      !config.knowledgeEngines[base.engine_instance_id ?? '']?.enabled
        ? 'unavailable'
        : base.build_state;
    return {
      knowledgeBaseId: base.id,
      name: base.name,
      mode: 'project_only',
      state: effectiveState,
      activeIndexVersionId: base.active_index_version_id,
      jobId: job?.id ?? null,
    };
  }
  async eligibleMembers(base: KnowledgeBaseRow) {
    const { config } = await this.center.configuration();
    const members = await this.center.query<KnowledgeMember>(
      sql`SELECT m.* FROM knowledge_base_members m WHERE m.kb_id=${base.id} AND m.visibility='active'`,
    );
    const sources = await this.center.query<KnowledgeMember & SourcePolicy>(
      sql`SELECT s.*,k.kind,k.lifecycle,k.owner_user_id,k.school_id,k.engine_instance_id FROM knowledge_base_members s JOIN knowledge_bases k ON k.id=s.kb_id WHERE s.id IN (SELECT origin->>'sourceMemberId' FROM knowledge_base_members WHERE kb_id=${base.id})`,
    );
    return members.filter((m) => {
      // A source permission/version change immediately removes derived evidence.
      const sourceId = m.origin.sourceMemberId;
      if (typeof sourceId !== 'string') return base.kind !== 'project';
      const source = sources.find((s) => s.id === sourceId);
      return (
        !!source && source.checksum === m.checksum && materializationAllowed(source, base, config)
      );
    });
  }
  async search(
    studentId: string,
    projectId: string,
    assistantId: string,
    query: string,
    versionId?: string,
  ) {
    if (!(await this.center.canRetrieve(assistantId)))
      return { state: 'CAPABILITY_NOT_AUTHORIZED', evidence: [], base: null };
    const base = await this.owned(studentId, projectId);
    if (!base.active_index_version_id || base.lifecycle !== 'active')
      return { state: 'PROJECT_KB_PREPARING', evidence: [], base };
    if (versionId && versionId !== base.active_index_version_id)
      return { state: 'PROJECT_KB_UNAVAILABLE', evidence: [], base };
    const { config } = await this.center.configuration();
    const engine = config.knowledgeEngines[base.engine_instance_id ?? ''];
    if (!engine?.enabled) return { state: 'PROJECT_KB_UNAVAILABLE', evidence: [], base };
    const [version] = await this.center.query<{
      config_snapshot: { engine: typeof engine };
      manifest: { memberIds?: string[] };
    }>(
      sql`SELECT config_snapshot,manifest FROM knowledge_index_versions WHERE id=${base.active_index_version_id} AND kb_id=${base.id} AND status='ready'`,
    );
    if (!version || JSON.stringify(version.config_snapshot.engine) !== JSON.stringify(engine))
      return { state: 'PROJECT_KB_UNAVAILABLE', evidence: [], base };
    const members = (await this.eligibleMembers(base)).filter((m) =>
      version.manifest.memberIds?.includes(m.id),
    );
    if (!members.length) return { state: 'NO_PROJECT_EVIDENCE', evidence: [], base };
    const receipt = await this.engine.execute(engine, {
      operation: 'search',
      kbId: base.id,
      versionId: base.active_index_version_id,
      query: query.slice(0, 2000),
      allowedMemberIds: members.map((m) => m.id),
      topK: 5,
    });
    const freshConfig = await this.center.configuration();
    if (
      !(await this.center.canRetrieve(assistantId)) ||
      JSON.stringify(freshConfig.config.knowledgeEngines[base.engine_instance_id ?? '']) !==
        JSON.stringify(engine)
    )
      return { state: 'CAPABILITY_NOT_AUTHORIZED', evidence: [], base };
    const freshMembers = await this.eligibleMembers(base);
    const evidence = (receipt.hits ?? []).flatMap((h) => {
      const m = members.find(
        (item) =>
          item.id === h.memberId &&
          freshMembers.some((f) => f.id === item.id && f.checksum === item.checksum),
      );
      if (!m || !h.text) return [];
      return [
        {
          citationId: `${base.active_index_version_id}~${m.id}`,
          projectKnowledgeBaseId: base.id,
          indexVersionId: base.active_index_version_id,
          title: m.title,
          text: h.text,
          origin: m.origin,
          locator: h.locator,
          score: h.score,
        },
      ];
    });
    return {
      state: receipt.ok
        ? evidence.length
          ? 'ready'
          : 'NO_PROJECT_EVIDENCE'
        : (receipt.errorCode ?? 'PROJECT_KB_UNAVAILABLE'),
      evidence,
      base,
    };
  }
  async context(
    studentId: string,
    projectId: string,
    assistantId: string,
    query: string,
  ): Promise<TutorKnowledgeSearchResult[]> {
    const result = await this.search(studentId, projectId, assistantId, query);
    return result.evidence.map((e) => ({
      document: {
        id: e.citationId,
        version: e.indexVersionId!,
        title: e.title,
        summary: e.text,
        content: e.text,
        source: `${result.base?.name} · 引用 ${e.citationId}`,
        scope: 'project',
        active: true,
        tags: [],
      },
      score: e.score ?? 0,
      matchedTerms: [],
    }));
  }
  tools(
    studentId: string,
    projectId: string,
    assistantId: string,
    versionId: string,
  ): ModelRuntimeTool[] {
    return [
      {
        name: 'project_knowledge_search',
        description: '检索当前项目知识库，不查询其他资料库',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', maxLength: 2000 },
            topK: { type: 'integer', minimum: 1, maximum: 8 },
          },
          required: ['query'],
          additionalProperties: false,
        },
        execute: async (args) => {
          if (
            !args ||
            typeof args !== 'object' ||
            Array.isArray(args) ||
            Object.keys(args).some((k) => !['query', 'topK'].includes(k)) ||
            typeof args.query !== 'string'
          )
            return { isError: true, text: 'INVALID_ARGUMENT' };
          const result = await this.search(
            studentId,
            projectId,
            assistantId,
            args.query,
            versionId,
          );
          return {
            isError: result.state !== 'ready',
            text: JSON.stringify({ state: result.state, evidence: result.evidence }),
          };
        },
      },
      {
        name: 'project_knowledge_read',
        description: '读取本轮项目库中的来源正文',
        inputSchema: {
          type: 'object',
          properties: { citationId: { type: 'string' } },
          required: ['citationId'],
          additionalProperties: false,
        },
        execute: async (args) => {
          if (
            !args ||
            typeof args !== 'object' ||
            Array.isArray(args) ||
            Object.keys(args).some((k) => k !== 'citationId') ||
            typeof args.citationId !== 'string'
          )
            return { isError: true, text: 'INVALID_ARGUMENT' };
          try {
            return {
              isError: false,
              text: JSON.stringify(
                await this.read(studentId, projectId, assistantId, args.citationId, versionId),
              ),
            };
          } catch {
            return { isError: true, text: 'RESOURCE_UNAVAILABLE' };
          }
        },
      },
    ];
  }
  async read(
    studentId: string,
    projectId: string,
    assistantId: string,
    citationId: string,
    versionId?: string,
  ) {
    if (!(await this.center.canRetrieve(assistantId))) throw new NotFoundException('资料不可用');
    const base = await this.owned(studentId, projectId);
    const [version, memberId] = citationId.split('~');
    if (
      !version ||
      !memberId ||
      version !== base.active_index_version_id ||
      (versionId && version !== versionId)
    )
      throw new NotFoundException('资料不可用');
    const { config } = await this.center.configuration();
    const engine = config.knowledgeEngines[base.engine_instance_id ?? ''];
    if (!engine?.enabled) throw new NotFoundException('资料不可用');
    const [index] = await this.center.query<{
      config_snapshot: { engine: unknown };
      manifest: { memberIds?: string[] };
    }>(
      sql`SELECT config_snapshot,manifest FROM knowledge_index_versions WHERE id=${version} AND kb_id=${base.id} AND status='ready'`,
    );
    if (!index || JSON.stringify(index.config_snapshot.engine) !== JSON.stringify(engine))
      throw new NotFoundException('资料不可用');
    const member = (await this.eligibleMembers(base)).find(
      (m) => m.id === memberId && index?.manifest.memberIds?.includes(m.id),
    );
    if (!member) throw new NotFoundException('资料不可用');
    return {
      citationId,
      title: member.title,
      text: member.content.slice(0, 24000),
      origin: member.origin,
      knowledgeBase: base.name,
      locator: null,
    };
  }
}
