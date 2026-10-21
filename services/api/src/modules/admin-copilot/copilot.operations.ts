import { ForbiddenException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { AdminCopilotActionKind, CurrentUser, UpsertProviderRequest } from '@qitu/contracts';
import { MODEL_APIS } from '../model-registry/manual-model.validation';
import { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { parseAssistantCreate, parseAssistantUpdate, parseTeamCreate, parseTeamUpdate } from '../platform-registry/admin-ai-config.validation';
import { ImaSettingsService } from '../platform-registry/ima-settings.service';
import { TeamVersionService } from '../platform-registry/team-version.service';
import { GrowthProjectionSettingsService } from '../growth/growth-projection-settings.service';
import { TemplateBindingService } from '../templates/templates-binding.service';
import { executeBinding } from './copilot.bindings';
import type { CopilotScopeResources } from './copilot.scope';
import { TemplateGovernanceService } from '../templates/templates-governance.service';
import type { CreateTemplateInput, UpdateTemplateInput, CreateTemplateVersionInput } from '../templates/templates.types';
import { KnowledgeCenterService } from '../knowledge/knowledge-center.service';
import { ModelRegistryService, type CreateManualModelInput, type UpdateManualModelInput } from '../model-registry/model-registry.service';
import { CopilotResources } from './copilot.resources';
import { loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import { exact, invalid, object, text } from './copilot.protocol';
import { CopilotLifecycle, isLifecycleKind } from './copilot.lifecycle';

/** Each adapter delegates validation, persistence, audit and authorization to its domain owner. */
@Injectable()
export class CopilotOperations {
  constructor(
    readonly registry: PlatformRegistryService,
    readonly templates: TemplateGovernanceService,
    readonly knowledge: KnowledgeCenterService,
    readonly models: ModelRegistryService,
    readonly resources: CopilotResources,
    readonly ima: ImaSettingsService,
    @Optional() readonly bindings?: TemplateBindingService,
    @Optional() readonly growthSettings?: GrowthProjectionSettingsService,
    @Optional() readonly teamVersions?: TeamVersionService,
    @Optional() readonly lifecycle?: CopilotLifecycle,
  ) {}

  async execute(actor: CurrentUser, kind: AdminCopilotActionKind, input: Record<string, unknown>, key: string): Promise<unknown> {
    if (actor.role !== 'admin') throw new ForbiddenException('管家配置仅管理员可用');
    if (isLifecycleKind(kind)) {
      if (!this.lifecycle) throw new ServiceUnavailableException('生命周期管理 owner 不可用');
      return this.lifecycle.execute(actor, kind, input, key);
    }
    if (kind.startsWith('binding.')) return executeBinding(this.bindings, actor, kind, input, key);
    const id = () => text(input.id, 'id');
    const patch = () => object(input.patch);
    switch (kind) {
      case 'growth.projection.configure': {
        if (!this.growthSettings) throw new ServiceUnavailableException('画像与成长用途配置服务不可用');
        exact(input, ['expectedRevision', 'settings']);
        return this.growthSettings.save(actor, input, key);
      }
      case 'assistant.create': return this.registry.createAssistant(actor, parseAssistantCreate(input), `assistant-copilot-${key}`);
      case 'assistant.update': {
        exact(input, ['id', 'patch', 'expectedUpdatedAt']);
        const update = parseAssistantUpdate(patch());
        if (update.enabledSkills && loadTutorRuntimeSource().skillsSource?.status !== 'ready') invalid('技能目录不可用，拒绝替换 enabledSkills');
        return this.registry.updateAssistant(actor, id(), update, text(input.expectedUpdatedAt, 'expectedUpdatedAt'));
      }
      case 'team.version': {
        if (!this.teamVersions) throw new ServiceUnavailableException('团队版本发布服务不可用');
        exact(input, ['id', 'expectedUpdatedAt']);
        return this.teamVersions.publish(actor, id(), { expectedUpdatedAt: input.expectedUpdatedAt }, key);
      }
      case 'team.create': return this.registry.createTeam(actor, parseTeamCreate(input), `team-copilot-${key}`);
      case 'team.update':
        exact(input, ['id', 'patch', 'expectedUpdatedAt']);
        return this.registry.updateTeam(actor, id(), parseTeamUpdate(patch()), text(input.expectedUpdatedAt, 'expectedUpdatedAt'));
      case 'workflow.update':
        exact(input, ['id', 'pblSpec', 'expectedUpdatedAt']);
        return this.registry.updateTeam(actor, id(), parseTeamUpdate({ pblSpec: input.pblSpec }), text(input.expectedUpdatedAt, 'expectedUpdatedAt'));
      case 'template.create':
        exact(input, TEMPLATE_FIELDS);
        return (await this.templates.createTemplate(actor, input as unknown as CreateTemplateInput, key)).template;
      case 'template.update':
        exact(input, ['id', 'patch']);
        exact(patch(), TEMPLATE_FIELDS.filter(f => f !== 'schoolId' && f !== 'slug'));
        return (await this.templates.updateTemplate(actor, id(), patch() as UpdateTemplateInput, key)).template;
      case 'template.version': {
        exact(input, ['templateId', 'sourceVersionId', 'stages', 'content', 'contentPatch', 'rubric']);
        const templateId = text(input.templateId, 'templateId');
        const versions = await this.templates.listGovernedVersions(actor, templateId);
        const source = input.sourceVersionId ? versions.find(v => v.id === input.sourceVersionId) : undefined;
        if (input.sourceVersionId && !source) throw new NotFoundException('源版本不属于该模板');
        if (input.content && input.contentPatch) invalid('content 和 contentPatch 不能同时提交');
        if (input.contentPatch && !source) invalid('contentPatch 必须指定源版本');
        // Shallow patch preserves all untouched frozen fields, including curriculum.
        const content = input.content ? object(input.content)
          : { ...(source?.content ?? {}), ...(input.contentPatch ? object(input.contentPatch) : {}) };
        if (content.linkedTeamId && !(await this.registry.listTeams()).some(t => t.id === content.linkedTeamId && t.enabled)) {
          invalid('模板只能关联真实且启用的团队');
        }
        const request = { stages: input.stages ?? source?.stages, content, rubric: input.rubric ?? source?.rubric ?? [] };
        const result = await this.templates.createVersion(actor, templateId, request as CreateTemplateVersionInput, key);
        return { ...result.version, templateId };
      }
      case 'skill.create': return this.resources.createSkill(actor, input, key);
      case 'skill.publish': return this.resources.publishSkill(actor, input, key);
      case 'skill.revoke': return this.resources.revokeSkill(actor, input, key);
      case 'mcp.register': return this.resources.saveMcp(actor, input, true);
      case 'mcp.update': return this.resources.saveMcp(actor, input, false);
      case 'ima.configure': {
        exact(input, ['expectedRevision', 'enabled']);
        if (!Number.isInteger(input.expectedRevision) || typeof input.enabled !== 'boolean') invalid('IMA 需要当前平台 revision 与 enabled');
        const current = await this.knowledge.configuration();
        const engine = current.config.knowledgeEngines['ima-main'];
        if (!engine || engine.provider !== 'ima') invalid('IMA 引擎未配置，请先通过知识中心配置');
        return this.knowledge.save(actor, { expectedRevision: input.expectedRevision,
          config: { ...current.config, knowledgeEngines: { ...current.config.knowledgeEngines,
            'ima-main': { ...engine, enabled: input.enabled } } } }, key);
      }
      case 'knowledge.create': return this.knowledge.createBase(actor, input, key);
      case 'knowledge.bind':
        exact(input, ['id', 'expectedRevision', 'bindings']);
        return { id: id(), ...await this.knowledge.saveBaseBindings(actor, id(),
          { expectedRevision: input.expectedRevision, bindings: input.bindings }, key) };
      case 'knowledge.configure': return this.knowledge.save(actor, input, key);
      case 'model.provider': {
        exact(input, ['id', 'name', 'baseUrl', 'api', 'authHeader', 'enabled']);
        const { id: providerId, ...body } = input;
        text(providerId, 'id');
        const existing = this.models.listProviders().providers.find(p => p.id === providerId);
        if (existing?.auth.configured && body.baseUrl !== undefined && body.baseUrl !== existing.baseUrl) {
          invalid('带凭据的供应商地址变更请在模型设置页完成');
        }
        if (body.api !== undefined && !MODEL_APIS.includes(body.api as never)) invalid('模型协议无效');
        for (const field of ['name', 'baseUrl']) if (body[field] !== undefined) text(body[field], field, 500);
        for (const field of ['enabled', 'authHeader']) if (body[field] !== undefined && typeof body[field] !== 'boolean') invalid(`${field} 须为布尔值`);
        return this.models.upsertProvider(providerId as string, body as UpsertProviderRequest, actor.id, false);
      }
      case 'model.create':
      case 'model.update': {
        const fields = ['providerId', 'modelId', 'displayName', 'api', 'input', 'output', 'contextWindow', 'maxTokens', 'enabled'];
        exact(input, fields);
        const providerId = text(input.providerId, 'providerId');
        const { providerId: _provider, ...body } = input;
        if (kind === 'model.create') return this.models.createManualModel(providerId, body as unknown as CreateManualModelInput, actor.id, key);
        const { modelId, ...update } = body;
        return this.models.updateManualModel(providerId, text(modelId, 'modelId'), update as UpdateManualModelInput, actor.id, key);
      }
    }
  }

  async scopeResources(actor: CurrentUser, templateId: string | null, versionId: string | null): Promise<CopilotScopeResources> {
    const empty: CopilotScopeResources = { bindingStatus: 'unbound', teamIds: [], assistantIds: [] };
    if (!templateId || !versionId) return empty;
    const version = (await this.templates.listGovernedVersions(actor, templateId)).find(item => item.id === versionId);
    if (!version) throw new NotFoundException('所选版本不属于当前模板');
    if (!this.bindings) throw new ServiceUnavailableException({ code: 'COPILOT_SCOPE_UNAVAILABLE', message: '无法读取模板绑定，配置范围不可确认。' });
    const activeBinding = await this.bindings.resolveActiveBinding(versionId);
    if (activeBinding) {
      const team = await this.resources.readTeamVersion(activeBinding.teamVersionId);
      const members = team.members as Record<string, unknown>[];
      return { bindingStatus: 'active', teamIds: [team.teamId], assistantIds: [...new Set([
        team.leaderAssistantId, ...members.map(member => member.assistantId).filter((id): id is string => typeof id === 'string'),
      ])] };
    }
    // A metadata reference is editable draft context, never an activation claim.
    if (version.status !== 'draft') return empty;
    const linkedTeamId = version.content.linkedTeamId;
    const team = typeof linkedTeamId === 'string' ? (await this.registry.listTeams()).find(item => item.id === linkedTeamId) : undefined;
    if (!team) return empty;
    return { bindingStatus: 'draft_reference', teamIds: [team.id], assistantIds: [...new Set([
      team.leaderAssistantId, ...team.members.map(member => member.assistantId),
    ])] };
  }

  /** Readback is deliberately outside the mutation idempotency record. A failed read can be retried without recreating. */
  async readback(actor: CurrentUser, kind: AdminCopilotActionKind, raw: unknown): Promise<unknown> {
    if (isLifecycleKind(kind)) {
      if (!this.lifecycle) throw new ServiceUnavailableException('生命周期管理 owner 不可用');
      return this.lifecycle.readback(actor, kind, raw);
    }
    const result = object(raw);
    const find = <T extends { id: string }>(rows: T[]) => {
      const item = rows.find(r => r.id === result.id);
      if (!item) throw new NotFoundException('写入完成，但目标资源回读失败');
      return item;
    };
    if (kind === 'growth.projection.configure') {
      if (!this.growthSettings) throw new ServiceUnavailableException('画像与成长用途配置服务不可用');
      return this.growthSettings.read();
    }
    if (kind.startsWith('binding.')) {
      if (!this.bindings) throw new ServiceUnavailableException('模板绑定服务不可用');
      const templateId = text(result.templateId, 'templateId');
      const versionId = text(result.versionId, 'versionId');
      const live = await this.bindings.getTeachingBundle(actor, templateId, versionId, text(result.id, 'id'));
      return { ...live.binding, templateId, versionId };
    }
    if (kind.startsWith('assistant.')) return find(await this.registry.listAssistants());
    if (kind === 'team.version') {
      if (!this.teamVersions) throw new ServiceUnavailableException('团队版本发布服务不可用');
      return this.teamVersions.read(actor, text(result.teamId, 'teamId'), text(result.id, 'id'));
    }
    if (kind.startsWith('team.') || kind === 'workflow.update') return find(await this.registry.listTeams());
    if (kind === 'template.version') return find(await this.templates.listGovernedVersions(actor, text(result.templateId, 'templateId')));
    if (kind.startsWith('template.')) return find(await this.templates.listGovernedTemplates(actor));
    if (kind.startsWith('skill.')) return this.resources.readSkill(actor, text(result.id, 'id'));
    if (kind.startsWith('mcp.')) return this.resources.readMcp(text(result.id, 'id'));
    if (kind === 'ima.configure') return this.ima.getSettings();
    if (kind === 'knowledge.create') return this.knowledge.base(text(result.id, 'id'));
    if (kind === 'knowledge.bind') return { id: result.id, ...await this.knowledge.baseBindings(text(result.id, 'id')) };
    if (kind === 'knowledge.configure') return this.knowledge.configuration();
    // Model owners persist and return their refreshed registry.
    return result;
  }
}
const TEMPLATE_FIELDS = ['schoolId', 'slug', 'title', 'summary', 'domain', 'ageRange', 'difficulty',
  'estimatedDurationMinutes', 'requiredMaterials', 'learningObjectives', 'outcomeForm', 'safetyNotes'];
