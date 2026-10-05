import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { AdminRuntimeAgent, AdminRuntimeModelUsageOption, AdminRuntimeSkill, AdminRuntimeSnapshot, AdminRuntimeAgentUpdateRequest, CurrentUser } from '@qitu/contracts';
import { desc, eq, sql } from 'drizzle-orm';
import { agentMemoryRecords, auditLogs, knowledgeDocuments, projectTemplates, tutorPartners, type Database, withTransaction } from '@qitu/database';
import { DATA_MODE_TOKEN, DATABASE_TOKEN, type DataMode } from '../../database';
import { loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import { builtinToolRegistry } from './built-in-tools';
import { QITU_LEARNING_PARTNER } from '@qitu/ai-client';
import { AuditWriter } from '../../common/audit/audit.service';
import { ModelRegistryService } from '../model-registry/model-registry.service';

@Injectable()
export class PlatformRegistryService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    @Inject(DATA_MODE_TOKEN) private readonly mode: DataMode,
    private readonly audit: AuditWriter,
    private readonly models: ModelRegistryService,
  ) {}

  async getSnapshot(): Promise<AdminRuntimeSnapshot> {
    const runtime = loadTutorRuntimeSource();
    let agents: AdminRuntimeAgent[] = [];
    let databaseAvailable = false;

    if (this.db) {
      try {
        await this.db.execute(sql`select 1`);
        databaseAvailable = true;
      } catch {
        databaseAvailable = false;
      }
      if (databaseAvailable) {
        try {
          const partners = await this.db.select().from(tutorPartners);
          agents = partners.map((partner) => ({
            id: partner.id,
            label: partner.displayName,
            description: null,
            role: 'tutor',
            roleDefinition: partner.roleDefinition || QITU_LEARNING_PARTNER.roleDefinition,
            enabled: partner.enabled,
            status: partner.enabled ? 'enabled' as const : 'disabled' as const,
            modelUsage: partner.modelUsage,
            promptVersion: partner.promptVersion,
            capabilities: Array.isArray(partner.capabilities) ? partner.capabilities : [],
            skillIds: [],
            toolIds: [],
            mcpServerIds: [],
          }));
        } catch {
          // Keep the runtime source projection available when the partner table is unavailable.
        }
      }
    }

    const checks = await this.readChecks(databaseAvailable);
    const initialization = {
      overall: checks.some((check) => check.status === 'failed') ? 'degraded' as const
        : checks.some((check) => check.status === 'missing') ? 'not_ready' as const : 'unknown' as const,
      dataMode: this.mode,
      database: this.db === null ? 'in_memory' as const : databaseAvailable ? 'connected' as const : 'unavailable' as const,
      migrationVersion: null,
      checks,
    };

    const skills: AdminRuntimeSkill[] = runtime.skills.map((skill) => ({
      id: skill.id,
      label: skill.label,
      description: skill.description,
      version: skill.version,
      source: 'runtime',
      status: skill.status === 'ready' ? 'ready' : 'unavailable',
      content: skill.content,
      agentIds: skill.id === 'tutor-guided-learning' ? ['qitu-learning-partner'] : [],
    }));

    const usages = this.models.getUsages();
    const modelUsageOptions: AdminRuntimeModelUsageOption[] = usages.bindings.map((binding) => {
      const usage = usages.usages.find((item) => item.id === binding.usageId);
      return { id: binding.usageId, label: usage?.label ?? binding.usageId, available: binding.resolved !== null, modelId: binding.resolved?.modelId ?? null };
    });

    return {
      generatedAt: new Date().toISOString(),
      overall: initialization.overall,
      dataSource: this.mode === 'live' ? 'live' : 'demo',
      policy: {
        id: runtime.policy.id,
        version: runtime.policy.version,
        contentHash: runtime.policy.contentHash,
        status: runtime.policy.status,
        content: runtime.policy.content || null,
      },
      skills,
      // MCP is intentionally empty until a server-owned runtime registry exists.
      // Repository development config must never be promoted into this snapshot.
      mcpServers: [],
      agents: agents.sort((a, b) => a.label.localeCompare(b.label)),
      modelUsageOptions,
      builtInTools: builtinToolRegistry.list(),
      initialization,
    };
  }

  async updateAgent(actor: CurrentUser, agentId: string, input: AdminRuntimeAgentUpdateRequest): Promise<AdminRuntimeAgent> {
    if (!this.db) throw new ServiceUnavailableException('角色治理存储不可用');
    const allowedCapabilities = new Set(['explore', 'plan', 'teach', 'review', 'reflect']);
    const label = input.label?.trim();
    const definition = input.roleDefinition?.trim();
    if (label !== undefined && (label.length < 2 || label.length > 80)) throw new BadRequestException('角色名称长度须为 2 至 80 个字符');
    if (definition !== undefined && (definition.length < 20 || definition.length > 4000)) throw new BadRequestException('角色定义长度须为 20 至 4000 个字符');
    if (input.capabilities && (input.capabilities.length === 0 || input.capabilities.length > 5 || input.capabilities.some((item) => !allowedCapabilities.has(item)))) {
      throw new BadRequestException('角色能力列表无效');
    }
    if (input.modelUsage !== undefined && !this.models.getUsages().usages.some((item) => item.id === input.modelUsage)) {
      throw new BadRequestException('未知的模型用途');
    }

    const [updated] = await withTransaction(this.db, async (tx) => {
      const [existing] = await tx.select().from(tutorPartners).where(eq(tutorPartners.id, agentId)).limit(1);
      if (!existing) throw new NotFoundException('Agent 角色不存在');
      const values = {
        ...(label !== undefined ? { displayName: label } : {}),
        ...(definition !== undefined ? { roleDefinition: definition } : {}),
        ...(input.modelUsage !== undefined ? { modelUsage: input.modelUsage } : {}),
        ...(input.capabilities !== undefined ? { capabilities: [...new Set(input.capabilities)] } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        promptVersion: `admin-${new Date().toISOString()}`,
        updatedAt: new Date(),
      };
      const [row] = await tx.update(tutorPartners).set(values).where(eq(tutorPartners.id, agentId)).returning();
      await this.audit.write({
        actorId: actor.id, actorRole: actor.role, action: 'admin.agent_role.update',
        targetType: 'tutor_partner', targetId: agentId,
        detail: { changedFields: Object.keys(input).filter((key) => key !== 'roleDefinition'), roleDefinitionChanged: definition !== undefined, modelUsage: input.modelUsage },
      }, tx);
      return [row];
    });
    if (!updated) throw new ServiceUnavailableException('角色更新未返回记录');
    return {
      id: updated.id, label: updated.displayName, description: null, role: 'tutor',
      roleDefinition: updated.roleDefinition, enabled: updated.enabled,
      status: updated.enabled ? 'enabled' : 'disabled', modelUsage: updated.modelUsage,
      promptVersion: updated.promptVersion, capabilities: updated.capabilities,
      skillIds: [], toolIds: [], mcpServerIds: [],
    };
  }
  private async readChecks(databaseAvailable: boolean): Promise<AdminRuntimeSnapshot['initialization']['checks']> {
    const checkedAt = new Date().toISOString();
    const checks: AdminRuntimeSnapshot['initialization']['checks'] = [
      {
        id: 'database.schema', label: 'Database schema migrations', area: 'database',
        status: 'unknown', detail: 'Migration state is not inspected by the API.',
        checkedAt, remediation: 'Run the versioned database migrations through the operator deployment path.',
        lastRun: null, operatorRequired: true, executeAllowed: false,
      },
    ];

    for (const area of ['knowledge', 'template', 'tutor'] as const) {
      const action = `admin.initialization.${area}.execute`;
      let lastRun: string | null = null;
      let status: 'ready' | 'missing' | 'failed' | 'unknown' = this.db ? 'unknown' : 'missing';
      let detail: string | null = null;
      if (this.db && databaseAvailable) {
        try {
          const records = area === 'knowledge'
            ? await this.db.select({ id: knowledgeDocuments.id }).from(knowledgeDocuments)
                .where(eq(knowledgeDocuments.id, 'foundation-knowledge-theory-gate')).limit(1)
            : area === 'template'
              ? await this.db.select({ id: projectTemplates.id }).from(projectTemplates)
                  .where(eq(projectTemplates.id, 'foundation-template-project-learning')).limit(1)
              : await this.db.select({ id: agentMemoryRecords.id }).from(agentMemoryRecords)
                  .where(eq(agentMemoryRecords.id, 'foundation-agent-memory-strategy')).limit(1);
          status = records.length > 0 ? 'ready' : 'missing';
          detail = records.length > 0 ? 'Foundation records are present.' : 'Foundation records are not present.';
        } catch {
          status = 'failed';
          detail = 'Foundation state could not be inspected.';
        }
        try {
          const runs = await this.db.select({ at: auditLogs.at }).from(auditLogs)
            .where(eq(auditLogs.action, action)).orderBy(desc(auditLogs.at)).limit(1);
          lastRun = runs[0]?.at.toISOString() ?? null;
        } catch {
          // An absent audit table is represented by an unknown run time, never logged with raw DB errors.
        }
      }
      checks.push({
        id: `${area}.foundation`, label: area === 'knowledge'
          ? 'Knowledge base foundation'
          : area === 'template'
            ? 'Template library foundation'
            : 'Session memory foundation',
        area, status, detail, checkedAt, remediation: status === 'ready' ? null : 'Retry the idempotent foundation initialization after the database schema is available.',
        lastRun, operatorRequired: false, executeAllowed: this.db !== null && databaseAvailable && status !== 'failed',
      });
    }
    return checks;
  }
}
