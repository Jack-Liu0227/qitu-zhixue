import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CurrentUser,
  KnowledgeBindingMatrix,
  KnowledgeMatrixChange,
  KnowledgeMatrixPatch,
  KnowledgeMatrixSaveResult,
} from '@qitu/contracts';
import { sql } from 'drizzle-orm';
import { AuditWriter } from '../../common/audit/audit.service';
import { KnowledgeCenterService, checksum, rows } from './knowledge-center.service';
import { record, type PlatformKnowledgeConfig } from './knowledge-center.config';

export function parseMatrixPatch(body: unknown): KnowledgeMatrixPatch {
  const input = record(body);
  if (
    Object.keys(input).some((k) => k !== 'changes') ||
    !Array.isArray(input.changes) ||
    !input.changes.length ||
    input.changes.length > 100
  )
    throw new BadRequestException({
      code: 'CONFIG_INVALID',
      message: '请选择需要保存的绑定，单次最多 100 个库',
    });
  let count = 0;
  const changes: KnowledgeMatrixChange[] = input.changes.map((value) => {
    const group = record(value);
    if (
      Object.keys(group).some(
        (k) => !['knowledgeBaseId', 'expectedRevision', 'bindings'].includes(k),
      ) ||
      typeof group.knowledgeBaseId !== 'string' ||
      !group.knowledgeBaseId ||
      group.knowledgeBaseId.length > 160 ||
      typeof group.expectedRevision !== 'number' ||
      !Number.isSafeInteger(group.expectedRevision) ||
      group.expectedRevision < 1 ||
      !Array.isArray(group.bindings) ||
      !group.bindings.length ||
      group.bindings.length > 500
    )
      throw new BadRequestException({ code: 'CONFIG_INVALID', message: '绑定参数或修订号无效' });
    const bindings = group.bindings.map((value) => {
      const cell = record(value);
      if (
        Object.keys(cell).some((k) => !['assistantId', 'enabled'].includes(k)) ||
        typeof cell.assistantId !== 'string' ||
        !cell.assistantId ||
        cell.assistantId.length > 160 ||
        typeof cell.enabled !== 'boolean'
      )
        throw new BadRequestException({ code: 'CONFIG_INVALID', message: '助手绑定参数无效' });
      return { assistantId: cell.assistantId, enabled: cell.enabled };
    });
    count += bindings.length;
    if (new Set(bindings.map((b) => b.assistantId)).size !== bindings.length)
      throw new BadRequestException({ code: 'CONFIG_INVALID', message: '同一助手绑定不能重复' });
    return {
      knowledgeBaseId: group.knowledgeBaseId,
      expectedRevision: group.expectedRevision,
      bindings,
    };
  });
  if (count > 2000 || new Set(changes.map((c) => c.knowledgeBaseId)).size !== changes.length)
    throw new BadRequestException({ code: 'CONFIG_INVALID', message: '库重复或绑定数量超限' });
  return { changes };
}

@Injectable()
export class KnowledgeMatrixService {
  private readonly logger = new Logger(KnowledgeMatrixService.name);
  constructor(
    private readonly center: KnowledgeCenterService,
    private readonly audit: AuditWriter,
  ) {}

  async get(): Promise<KnowledgeBindingMatrix> {
    return this.center.database().transaction(
      async (tx) => {
        const [current] = rows<{ revision: number; config: PlatformKnowledgeConfig }>(
          await tx.execute(
            sql`SELECT revision,config FROM platform_configuration_revisions ORDER BY revision DESC LIMIT 1`,
          ),
        );
        if (!current) throw new NotFoundException('知识配置尚未初始化，请先读取知识引擎');
        const tool = current.config.platformTools['project-knowledge'];
        const assistants = rows<{
          id: string;
          name: string;
          avatar: string | null;
          enabled: boolean;
        }>(
          await tx.execute(
            sql`SELECT id,name,avatar,enabled FROM admin_assistants ORDER BY name,id LIMIT 501`,
          ),
        );
        const libraries = rows<{
          id: string;
          name: string;
          revision: number;
          kind: string;
          lifecycle: string;
          engine_instance_id: string | null;
          library_settings: Record<string, unknown>;
          build_state: string;
          connection_status: string | null;
          last_check_at: string | null;
          last_error_code: string | null;
        }>(
          await tx.execute(sql`SELECT k.id,k.name,k.revision,k.kind,k.lifecycle,k.engine_instance_id,
        k.library_settings,k.build_state,c.status connection_status,c.last_check_at::text,c.last_error_code
        FROM knowledge_bases k LEFT JOIN knowledge_base_connections c ON c.kb_id=k.id
        WHERE k.lifecycle<>'deleted' AND k.kind<>'project' ORDER BY k.name,k.id LIMIT 201`),
        );
        const bindings = rows<{ knowledgeBaseId: string; assistantId: string; enabled: boolean }>(
          await tx.execute(
            sql`SELECT b.kb_id "knowledgeBaseId",b.agent_id "assistantId",b.enabled
          FROM knowledge_base_agent_bindings b JOIN knowledge_bases k ON k.id=b.kb_id
          WHERE b.agent_kind='admin_assistant' AND b.mode='retrieve' AND k.lifecycle<>'deleted' AND k.kind<>'project'`,
          ),
        );
        return {
          complete: assistants.length <= 500 && libraries.length <= 200,
          configurationRevision: current.revision,
          retrievalEnabled: tool.enabled,
          assistants: assistants
            .slice(0, 500)
            .map((a) => ({ ...a, retrievalAllowed: tool.boundAssistants.includes(a.id) })),
          libraries: libraries.slice(0, 200).map((k) => {
            const engine = current.config.knowledgeEngines[k.engine_instance_id ?? ''];
            const enabled = k.lifecycle === 'active' && k.library_settings.enabled !== false;
            const reasons: string[] = [];
            if (!enabled) reasons.push('知识库已停用');
            if (!engine?.enabled) reasons.push('知识引擎未启用');
            if (k.connection_status && k.connection_status !== 'ready')
              reasons.push('连接待检查或异常');
            if (!k.connection_status && k.build_state !== 'ready') reasons.push('索引尚未就绪');
            return {
              id: k.id,
              name: k.name,
              revision: k.revision,
              provider: engine?.provider ?? null,
              engineInstanceId: k.engine_instance_id,
              enabled,
              connectionStatus: k.connection_status,
              lastCheckedAt: k.last_check_at,
              lastErrorCode: k.last_error_code,
              buildState: k.build_state,
              reasons,
            };
          }),
          bindings,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async patch(
    actor: CurrentUser,
    body: unknown,
    key: string,
  ): Promise<{ results: KnowledgeMatrixSaveResult[] }> {
    const { changes } = parseMatrixPatch(body);
    const results: KnowledgeMatrixSaveResult[] = [];
    for (const change of changes) {
      try {
        results.push(await this.saveGroup(actor, change, key));
      } catch (error) {
        const response = error instanceof HttpException ? error.getResponse() : null;
        const detail = typeof response === 'object' && response !== null ? record(response) : {};
        this.logger.warn(
          `Binding rejected library=${change.knowledgeBaseId} code=${typeof detail.code === 'string' ? detail.code : 'KNOWLEDGE_BINDING_SAVE_FAILED'}`,
        );
        results.push({
          knowledgeBaseId: change.knowledgeBaseId,
          status: 'failed',
          code: typeof detail.code === 'string' ? detail.code : 'KNOWLEDGE_BINDING_SAVE_FAILED',
          message:
            error instanceof HttpException && typeof detail.message === 'string'
              ? detail.message
              : '此知识库绑定未保存，请重新读取后重试',
        });
      }
    }
    return { results };
  }

  private async saveGroup(
    actor: CurrentUser,
    change: KnowledgeMatrixChange,
    key: string,
  ): Promise<KnowledgeMatrixSaveResult> {
    const hash = checksum(JSON.stringify(change));
    const auditKey = `knowledge.matrix:${actor.id}:${checksum(key + ':' + change.knowledgeBaseId)}`;
    return this.center.database().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(281017)`);
      const [replay] = rows<{ detail: { requestHash: string; revision: number } }>(
        await tx.execute(sql`SELECT detail FROM audit_logs WHERE idempotency_key=${auditKey}`),
      );
      if (replay) {
        if (replay.detail.requestHash !== hash)
          throw new ConflictException({
            code: 'IDEMPOTENCY_CONFLICT',
            message: '幂等键对应的修改已变化，请重新读取',
          });
        return {
          knowledgeBaseId: change.knowledgeBaseId,
          status: 'saved',
          revision: replay.detail.revision,
        };
      }
      const [base] = rows<{ revision: number; kind: string }>(
        await tx.execute(
          sql`SELECT revision,kind FROM knowledge_bases WHERE id=${change.knowledgeBaseId} AND lifecycle<>'deleted' FOR UPDATE`,
        ),
      );
      if (!base || base.kind === 'project')
        throw new BadRequestException({
          code: 'KNOWLEDGE_BASE_UNAVAILABLE',
          message: '知识库已删除或属于只读历史项目',
        });
      if (base.revision !== change.expectedRevision)
        throw new ConflictException({
          code: 'KNOWLEDGE_BINDING_CONFLICT',
          message: '此库配置已变化，请重新读取并核对待保存修改',
        });
      const assistants = rows<{ id: string; enabled: boolean }>(
        await tx.execute(sql`SELECT id,enabled FROM admin_assistants FOR SHARE`),
      );
      for (const cell of change.bindings) {
        const target = assistants.find((a) => a.id === cell.assistantId);
        if (cell.enabled && (!target || !target.enabled))
          throw new BadRequestException({
            code: 'AGENT_DISABLED',
            message: '新增绑定的助手不存在或已停用',
          });
      }
      const revision = base.revision + 1;
      for (const cell of change.bindings) {
        await tx.execute(sql`INSERT INTO knowledge_base_agent_bindings(kb_id,agent_kind,agent_id,mode,enabled,revision,created_by,updated_by)
          VALUES(${change.knowledgeBaseId},'admin_assistant',${cell.assistantId},'retrieve',${cell.enabled},${revision},${actor.id},${actor.id})
          ON CONFLICT(kb_id,agent_kind,agent_id,mode) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision,
          updated_by=excluded.updated_by,updated_at=now()`);
      }
      const [current] = rows<{ revision: number; config: PlatformKnowledgeConfig }>(
        await tx.execute(
          sql`SELECT revision,config FROM platform_configuration_revisions ORDER BY revision DESC LIMIT 1`,
        ),
      );
      if (!current) throw new NotFoundException('知识配置不可用');
      const tool = current.config.platformTools['project-knowledge'];
      const allowed = [
        ...new Set([
          ...tool.boundAssistants,
          ...change.bindings.filter((b) => b.enabled).map((b) => b.assistantId),
        ]),
      ];
      if (allowed.length !== tool.boundAssistants.length) {
        const config = {
          ...current.config,
          platformTools: {
            ...current.config.platformTools,
            'project-knowledge': { ...tool, boundAssistants: allowed },
          },
        };
        await tx.execute(sql`INSERT INTO platform_configuration_revisions(revision,parent_revision,config,updated_by,idempotency_key,request_hash)
          VALUES(${current.revision + 1},${current.revision},${JSON.stringify(config)}::jsonb,${actor.id},${auditKey},${hash})`);
      }
      await tx.execute(
        sql`UPDATE knowledge_bases SET revision=${revision},updated_at=now() WHERE id=${change.knowledgeBaseId}`,
      );
      await this.audit.write(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'knowledge.matrix.patch',
          targetType: 'knowledge_base',
          targetId: change.knowledgeBaseId,
          idempotencyKey: auditKey,
          detail: { requestHash: hash, revision, bindingCount: change.bindings.length },
        },
        tx,
      );
      return { knowledgeBaseId: change.knowledgeBaseId, status: 'saved', revision };
    });
  }

  async retrieval(actor: CurrentUser, body: unknown, key: string) {
    const input = record(body);
    if (
      Object.keys(input).some((k) => !['expectedRevision', 'enabled'].includes(k)) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      typeof input.enabled !== 'boolean'
    )
      throw new BadRequestException({ code: 'CONFIG_INVALID', message: '检索开关参数无效' });
    const enabled = input.enabled;
    const requestHash = checksum(
      JSON.stringify({ expectedRevision: input.expectedRevision, enabled }),
    );
    const auditKey = `knowledge.retrieval:${actor.id}:${checksum(key)}`;
    return this.center.database().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(281017)`);
      const [replay] = rows<{ detail: { requestHash: string; revision: number } }>(
        await tx.execute(sql`SELECT detail FROM audit_logs WHERE idempotency_key=${auditKey}`),
      );
      if (replay) {
        if (replay.detail.requestHash !== requestHash)
          throw new ConflictException({
            code: 'IDEMPOTENCY_CONFLICT',
            message: '幂等键已用于其他检索开关操作',
          });
        return { configurationRevision: replay.detail.revision, enabled };
      }
      const [current] = rows<{ revision: number; config: PlatformKnowledgeConfig }>(
        await tx.execute(
          sql`SELECT revision,config FROM platform_configuration_revisions ORDER BY revision DESC LIMIT 1`,
        ),
      );
      if (!current || current.revision !== input.expectedRevision)
        throw new ConflictException({
          code: 'CONFIG_REVISION_CONFLICT',
          message: '配置已变化，请重新读取',
        });
      const config = structuredClone(current.config);
      config.platformTools['project-knowledge'].enabled = enabled;
      const revision = current.revision + 1;
      await tx.execute(sql`INSERT INTO platform_configuration_revisions(revision,parent_revision,config,updated_by,idempotency_key,request_hash)
        VALUES(${revision},${current.revision},${JSON.stringify(config)}::jsonb,${actor.id},${auditKey},${requestHash})`);
      await this.audit.write(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: 'knowledge.retrieval.settings',
          targetType: 'platform_configuration',
          targetId: String(revision),
          idempotencyKey: auditKey,
          detail: { requestHash, revision, enabled },
        },
        tx,
      );
      return { configurationRevision: revision, enabled };
    });
  }
}
