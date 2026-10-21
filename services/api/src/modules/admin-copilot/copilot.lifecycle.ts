import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { parseProjectTemplateSpec, type AdminCopilotActionKind, type CurrentUser } from '@qitu/contracts';
import { sql } from 'drizzle-orm';
import { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { ImaSettingsService } from '../platform-registry/ima-settings.service';
import { parseTeamUpdate } from '../platform-registry/admin-ai-config.validation';
import { TemplateGovernanceService } from '../templates/templates-governance.service';
import { assertTemplateTeachingContent } from '../templates/templates.content-validator';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';
import { KnowledgeCenterService } from '../knowledge/knowledge-center.service';
import { KnowledgeLibraryService } from '../knowledge/knowledge-library.service';
import { KnowledgeEngineService } from '../knowledge/knowledge-engine.service';
import { ModelRegistryService } from '../model-registry/model-registry.service';
import { CopilotResources } from './copilot.resources';
import { exact, invalid, object, text } from './copilot.protocol';

const KINDS = [
  'assistant.test', 'assistant.delete', 'team.test', 'team.delete', 'template.test', 'template.verify',
  'template.publish', 'template.archive', 'template.delete', 'skill.test', 'skill.delete',
  'mcp.test', 'mcp.delete', 'knowledge.test', 'knowledge.update', 'knowledge.delete', 'model.test',
] as const satisfies readonly AdminCopilotActionKind[];
type LifecycleKind = typeof KINDS[number];
export function isLifecycleKind(kind: AdminCopilotActionKind): kind is LifecycleKind {
  return KINDS.some(value => value === kind);
}
interface ConfigurationCheck { passed: boolean; digest: string; detail: Record<string, unknown> }
function check(value: unknown, passed: boolean, detail: Record<string, unknown> = {}): ConfigurationCheck {
  // Diagnostics fingerprint the API wire projection, including dates and omitted optional fields.
  const wire: unknown = JSON.parse(JSON.stringify(value));
  return { passed, digest: teachingValueDigest(wire), detail };
}
function failed(message: string): never {
  throw new UnprocessableEntityException({ code: 'COPILOT_TEST_FAILED', message });
}

/** Lifecycle adapter. Diagnostics never create projects, mastery, artifact or growth facts. */
@Injectable()
export class CopilotLifecycle {
  constructor(
    readonly registry: PlatformRegistryService,
    readonly templates: TemplateGovernanceService,
    readonly knowledge: KnowledgeCenterService,
    readonly models: ModelRegistryService,
    readonly resources: CopilotResources,
    readonly ima: ImaSettingsService,
    @Optional() readonly library?: KnowledgeLibraryService,
    @Optional() readonly engine?: KnowledgeEngineService,
  ) {}

  async execute(actor: CurrentUser, kind: LifecycleKind, input: Record<string, unknown>, key: string): Promise<Record<string, unknown>> {
    if (actor.role !== 'admin') throw new ForbiddenException('管家生命周期管理仅管理员可用');
    const id = () => text(input.id, 'id');
    if (kind.endsWith('.test') || kind === 'template.verify') return this.test(actor, kind, input, key);
    switch (kind) {
      case 'assistant.delete': {
        exact(input, ['id', 'expectedUpdatedAt']);
        const source = (await this.registry.listAssistants()).find(row => row.id === id());
        if (!source) throw new NotFoundException('助手不存在');
        if (source.source === 'builtin' || source.id === 'qitu-assistant') throw new ConflictException({ code: 'COPILOT_SOURCE_PROTECTED', message: '内置或管家助手请停用，不能通过管家删除' });
        await this.registry.deleteAssistant(actor, id(), text(input.expectedUpdatedAt, 'expectedUpdatedAt'));
        return { id: id(), deleted: true, deletionMode: 'physical' };
      }
      case 'team.delete':
        exact(input, ['id', 'expectedUpdatedAt']);
        await this.registry.deleteTeam(actor, id(), text(input.expectedUpdatedAt, 'expectedUpdatedAt'));
        return { id: id(), deleted: true, deletionMode: 'physical' };
      case 'template.delete': {
        exact(input, ['templateId']);
        const templateId = text(input.templateId, 'templateId');
        await this.templates.deleteTemplate(actor, templateId, key);
        return { id: templateId, deleted: true, deletionMode: 'physical' };
      }
      case 'template.archive': {
        exact(input, ['templateId', 'reason']);
        const result = await this.templates.archiveTemplate(actor, text(input.templateId, 'templateId'), key, text(input.reason, 'reason', 2000));
        return { ...result.template };
      }
      case 'template.publish': {
        exact(input, ['templateId', 'versionId', 'reason']);
        const templateId = text(input.templateId, 'templateId');
        const result = await this.templates.publishVersion(actor, templateId, text(input.versionId, 'versionId'), key,
          input.reason === undefined ? null : text(input.reason, 'reason', 2000));
        return { ...result.version, templateId };
      }
      case 'skill.delete': return this.resources.deleteSkill(actor, input, key);
      case 'mcp.delete':
        exact(input, ['id']);
        return this.resources.deleteMcp(actor, id(), key);
      case 'knowledge.update':
      case 'knowledge.delete': {
        if (!this.library) throw new ServiceUnavailableException('知识库生命周期 owner 不可用');
        exact(input, kind === 'knowledge.delete' ? ['id', 'expectedRevision'] : ['id', 'expectedRevision', 'patch']);
        const base = await this.knowledge.base(id());
        if (base.kind !== 'platform') throw new ForbiddenException('管家仅管理平台知识库');
        const patch = kind === 'knowledge.delete' ? { deleted: true } : object(input.patch);
        exact(patch, kind === 'knowledge.delete' ? ['deleted'] : ['name', 'isDefault', 'engineInstanceId']);
        if (!Object.keys(patch).length) invalid('知识库修改不能为空');
        return { ...await this.library.manage(actor, id(), { ...patch, expectedRevision: input.expectedRevision }, key) };
      }
      default: invalid('生命周期操作不受支持');
    }
  }

  private async configuration(actor: CurrentUser, kind: LifecycleKind, input: Record<string, unknown>): Promise<ConfigurationCheck> {
    const id = () => text(input.id, 'id');
    switch (kind) {
      case 'assistant.test': {
        const runtime = await this.registry.getAssistantRuntime(id());
        const agent = runtime.agent;
        const source = { id: agent.id, version: agent.promptVersion, enabled: agent.enabled,
          modelProviderId: agent.modelProviderId, modelId: agent.modelId, modelAvailable: agent.modelAvailable,
          skills: runtime.skills.map(skill => [skill.id, skill.contentHash, skill.status, skill.publicationStatus]),
          tools: runtime.tools, mcp: runtime.mcpServers, policy: runtime.policy.contentHash };
        const passed = agent.enabled && agent.modelAvailable === true && !!agent.modelProviderId && !!agent.modelId && runtime.policy.status === 'ready' &&
          agent.skillIds.every(skillId => runtime.skills.some(skill => skill.id === skillId && skill.status === 'ready' && skill.publicationStatus === 'published')) &&
          agent.toolIds.every(toolId => runtime.tools.some(tool => tool.id === toolId)) &&
          agent.mcpServerIds.every(serverId => runtime.mcpServers.some(server => server.serverId === serverId));
        return check(source, passed, { modelProviderId: agent.modelProviderId, modelId: agent.modelId, skillCount: runtime.skills.length });
      }
      case 'team.test': {
        const team = (await this.registry.listTeams()).find(row => row.id === id());
        if (!team) throw new NotFoundException('团队不存在');
        if (!team.pblSpec) return check(team, false, { reason: 'PBL_WORKFLOW_MISSING' });
        parseTeamUpdate({ pblSpec: team.pblSpec });
        const members = await Promise.all(team.members.map(member => this.configuration(actor, 'assistant.test', { id: member.assistantId })));
        const passed = team.enabled && members.length > 0 && members.every(member => member.passed) &&
          team.members.some(member => member.assistantId === team.leaderAssistantId) &&
          team.pblSpec.phases.every(phase => team.members.some(member => member.assistantId === phase.assignedAssistantId));
        return check({ team, members: members.map(member => member.digest) }, passed, { memberCount: members.length, scope: 'configuration_only' });
      }
      case 'template.test':
      case 'template.verify': {
        const templateId = text(input.templateId, 'templateId');
        const version = (await this.templates.listGovernedVersions(actor, templateId)).find(row => row.id === input.versionId);
        if (!version) throw new NotFoundException('版本不属于该模板');
        assertTemplateTeachingContent(version.content, version.stages);
        const spec = parseProjectTemplateSpec(version.content.pbl);
        const profiles = spec.curriculum?.profiles.map(profile => ({ id: profile.id, sessionCount: profile.sessions.length })) ?? [];
        return check({ id: version.id, content: version.content, stages: version.stages, status: version.status }, profiles.length > 0,
          { profiles, phaseCount: spec.phases.length, scope: 'curriculum_configuration' });
      }
      case 'skill.test': {
        const source = await this.resources.readSkill(actor, id());
        return check(source, source.enabled && source.status === 'published', { publicationStatus: source.status, digest: source.digest, scope: 'runtime_admission' });
      }
      case 'mcp.test': {
        const source = await this.resources.readMcp(id());
        return check({ id: source.id, endpointOrigin: source.endpointOrigin, enabled: source.enabled, toolIds: source.toolIds }, true,
          { registered: true, registrationStatus: source.status, scope: 'registration_only' });
      }
      case 'knowledge.test': {
        const base = await this.knowledge.base(id());
        if (base.kind !== 'platform') throw new ForbiddenException('仅可测试平台知识库');
        const config = await this.knowledge.configuration();
        const engine = config.config.knowledgeEngines[base.engine_instance_id ?? ''];
        return check({ id: base.id, revision: base.revision, engineId: base.engine_instance_id, configRevision: config.revision,
          lifecycle: base.lifecycle, buildState: base.build_state, indexVersion: base.active_index_version_id ?? null },
          !!engine?.enabled && base.lifecycle === 'active', { engineId: base.engine_instance_id, buildState: base.build_state,
            indexReady: base.build_state === 'ready', scope: 'configuration_only' });
      }
      case 'model.test': {
        const providerId = text(input.providerId, 'providerId'); const modelId = text(input.modelId, 'modelId');
        const model = this.models.listAgentModelOptions().find(row => row.providerId === providerId && row.modelId === modelId);
        const provider = this.models.listProviders().providers.find(row => row.id === providerId);
        if (!model || !provider) throw new NotFoundException('模型不存在');
        return check({ model, baseUrl: provider.baseUrl, api: provider.api }, model.available, { providerId, modelId });
      }
      default: invalid('不支持的诊断类型');
    }
  }

  private async test(actor: CurrentUser, kind: LifecycleKind, input: Record<string, unknown>, key: string) {
    const template = kind === 'template.test' || kind === 'template.verify';
    exact(input, template ? ['templateId', 'versionId'] : kind === 'model.test' ? ['providerId', 'modelId'] :
      ['assistant.test', 'mcp.test', 'knowledge.test'].includes(kind) ? ['id', 'mode'] : ['id']);
    const allowed = kind === 'assistant.test' ? ['configuration', 'model_connection'] : kind === 'mcp.test' ? ['configuration', 'connection'] :
      kind === 'knowledge.test' ? ['configuration', 'engine_connection'] : [];
    if (allowed.length && !allowed.includes(String(input.mode))) invalid('请指定配置检查或真实连接测试模式');
    const mode = kind === 'template.verify' ? 'publication_evidence' : kind === 'model.test' ? 'model_connection' : String(input.mode ?? 'configuration');
    const before = await this.configuration(actor, kind, input);
    let passed = before.passed;
    if (passed && (kind === 'model.test' || kind === 'assistant.test' && mode === 'model_connection')) {
      const providerId = text(kind === 'model.test' ? input.providerId : before.detail.modelProviderId, 'providerId');
      const modelId = text(kind === 'model.test' ? input.modelId : before.detail.modelId, 'modelId');
      passed = (await this.models.testModel(providerId, modelId, actor.id)).ok;
    } else if (passed && kind === 'mcp.test' && mode === 'connection') {
      passed = input.id === 'ima-knowledge' && (await this.ima.probe(actor)).status === 'connected';
    } else if (passed && kind === 'knowledge.test' && mode === 'engine_connection') {
      if (!this.engine) throw new ServiceUnavailableException('知识引擎测试 owner 不可用');
      passed = (await this.engine.check(text(before.detail.engineId, 'engineId'), key)).ok;
    } else if (kind === 'template.verify') {
      passed = (await this.templates.verifyVersion(actor, text(input.templateId, 'templateId'), text(input.versionId, 'versionId'), key)).report.passed && passed;
    }
    const after = await this.configuration(actor, kind, input);
    if (after.digest !== before.digest) throw new ConflictException({ code: 'COPILOT_TEST_SOURCE_CHANGED', message: '测试期间配置已变化，请用新请求重新测试' });
    return { ...input, id: template ? input.versionId : kind === 'model.test' ? `${String(input.providerId)}/${String(input.modelId)}` : input.id,
      configurationDigest: before.digest, test: { passed, mode, testedAt: new Date().toISOString(), ...before.detail } };
  }

  async readback(actor: CurrentUser, kind: LifecycleKind, raw: unknown): Promise<unknown> {
    if (actor.role !== 'admin') throw new ForbiddenException('管家生命周期管理仅管理员可用');
    const result = object(raw); const id = text(result.id, 'id');
    if (kind.endsWith('.test') || kind === 'template.verify') {
      const test = object(result.test);
      const current = await this.configuration(actor, kind, result);
      if (current.digest !== result.configurationDigest) throw new ConflictException({ code: 'COPILOT_TEST_SOURCE_CHANGED', message: '测试依据已变化，请重新测试' });
      if (test.passed !== true || !current.passed) failed(kind === 'mcp.test' && test.mode === 'connection' && id !== 'ima-knowledge'
        ? 'MCP 未配置通用执行驱动，登记存在不能证明连接可用'
        : `检查未通过：${kind}，模式 ${String(test.mode)}；连接、发布证据或运行准入尚未核验通过`);
      return result;
    }
    if (kind === 'assistant.delete' && (await this.registry.listAssistants()).some(row => row.id === id)) throw new ConflictException('助手删除回读失败');
    if (kind === 'team.delete' && (await this.registry.listTeams()).some(row => row.id === id)) throw new ConflictException('团队删除回读失败');
    if (kind === 'template.delete' && (await this.templates.listGovernedTemplates(actor)).some(row => row.id === id)) throw new ConflictException('模板删除回读失败');
    if (kind === 'skill.delete') {
      const skill = await this.resources.readSkill(actor, id);
      if (skill.status !== 'deprecated' || skill.enabled) throw new ConflictException('Skill 移除回读失败');
      return { ...skill, deleted: true, deletionMode: 'soft' };
    }
    if (kind === 'mcp.delete') return this.resources.assertMcpDeleted(id);
    if (kind === 'knowledge.delete') {
      const [base] = await this.knowledge.query<{ lifecycle: string; revision: number }>(sql`SELECT lifecycle,revision FROM knowledge_bases WHERE id=${id}`);
      if (base?.lifecycle !== 'deleted') throw new ConflictException('知识库删除回读失败');
      return { id, deleted: true, deletionMode: 'soft', revision: base.revision };
    }
    if (kind === 'knowledge.update') return this.knowledge.base(id);
    if (kind === 'template.archive') {
      const item = (await this.templates.listGovernedTemplates(actor)).find(row => row.id === id);
      if (item?.status !== 'archived') throw new ConflictException('模板归档回读失败');
      return item;
    }
    if (kind === 'template.publish') {
      const item = (await this.templates.listGovernedVersions(actor, text(result.templateId, 'templateId'))).find(row => row.id === id);
      if (item?.status !== 'published') throw new ConflictException('模板发布回读失败');
      return item;
    }
    return result;
  }
}
