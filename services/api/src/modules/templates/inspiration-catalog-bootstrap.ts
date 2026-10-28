import { ForbiddenException, HttpException } from '@nestjs/common';
import type { AdminAssistantCreateInput, AdminTeamCreateInput, CurrentUser } from '@qitu/contracts';
import { loadTutorRuntimeSource } from '../../common/tutor-runtime/runtime-source';
import type { PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { INSPIRATION_COURSES, type InspirationCourse } from './content/inspiration';
import { INSPIRATION_DIALOGUE_COURSES } from './content/inspiration/dialogue-courses';
import { teachingValueDigest } from './teaching-bundle.canonical';
import type { TemplateBindingService } from './templates-binding.service';
import type { TemplateBindingStore } from './templates-binding.store';
import type { TemplateGovernanceService } from './templates-governance.service';
import type { TemplateStore } from './templates.store';

export interface InspirationCatalogPorts {
  registry: Pick<PlatformRegistryService, 'listAssistants' | 'createAssistant' | 'listTeams' | 'createTeam' | 'isModelAvailable'>;
  templates: TemplateStore; bindingStore: TemplateBindingStore;
  governance: TemplateGovernanceService;
  bindings: Pick<TemplateBindingService, 'prepareCurrentTeams' | 'validateBinding' | 'activateBinding'>;
}
export interface InspirationCatalogOptions {
  actor: CurrentUser; model: { modelProviderId: string; modelId: string }; mode: 'draft' | 'pilot';
  projects?: readonly string[];
  progression?: 'guided' | 'dialogue';
}
function requireCondition(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }

export function inspirationAssistantInput(course: InspirationCourse, index: number, model: InspirationCatalogOptions['model']): AdminAssistantCreateInput {
  const role = course.roles[index];
  requireCondition(role, 'CATALOG_ASSISTANT_ROLE_INVALID');
  return { name: role, description: `${course.spec.title}：${role}`, role, ...model, enabled: true, teamSelectable: true,
    enabledSkills: course.skills, toolIds: ['tutor.propose_lesson_activity'], mcpServerIds: [],
    instructions: [
      `你是${course.teamName}的${role}，引导11至15岁零基础学生完成“${course.spec.title}”。`,
      `驱动问题：${course.spec.theme!.drivingQuestion}。最终作品：${course.templateInput.outcomeForm}。`,
      index === 0 ? '先了解已有理解，一次讲一个概念，用安全板书和例子展示，再让学生解释或预测。'
        : index === 1 ? '围绕当前冻结课时指导方法与学生作品；每次只建议一个可验证的改进，不代做完整作品。'
          : '结合学生已有作品提出有界质询，要求引用具体证据，指导解释、修订和反思。',
      `课程材料：${course.spec.materials.join('\n')}`,
      `安全边界：${course.spec.safetyRequirements.join('\n')}`,
      '只读取服务端提供的当前项目、冻结课时、活动、资料和实际授权工具。先展示再提问，不输出大段灌输。',
      '学生的回答或操作经既有 owner 保存为证据后，由服务端策略选择下一动作。正式待答题求助不替换题目，也不提前披露答案。',
      '遵守 autonomous-learning.v1，教师只读。TheoryMastered 前只做概念与低风险示例；不要求教师审批，不自行宣布掌握、通过作品或改变课时阶段。',
      '区分模拟材料、模型推测和真实记录；不得编造来源、测量、用户测试或学生成果。没有检索授权时只用冻结材料，明确未核验部分。',
    ].join('\n') };
}
function assistantIdentity(value: Awaited<ReturnType<InspirationCatalogPorts['registry']['listAssistants']>>[number]) {
  return { name: value.name, description: value.description, role: value.role, modelProviderId: value.modelProviderId, modelId: value.modelId,
    enabled: value.enabled, teamSelectable: value.teamSelectable, enabledSkills: value.enabledSkills, toolIds: value.toolIds,
    mcpServerIds: value.mcpServerIds, instructions: value.instructions };
}
export function inspirationTeamInput(course: InspirationCourse): AdminTeamCreateInput {
  return { name: course.teamName, description: `${course.spec.title}的三角色教学团队，课程与门禁由版本化模板维护。`,
    leaderAssistantId: course.assistantIds[0], enabled: true, workspaceMode: 'shared', sessionMode: 'auto', concurrencyLimit: 1,
    members: course.assistantIds.map((assistantId, index) => ({ assistantId, slotId: `${course.teamId}-slot-${index + 1}`,
      role: index === 0 ? 'leader' : index === 1 ? 'teammate' : 'reviewer', roleLabel: course.roles[index] })),
  };
}

async function configureCourse(ports: InspirationCatalogPorts, options: InspirationCatalogOptions, course: InspirationCourse) {
  const { actor } = options;
  for (const [index, id] of course.assistantIds.entries()) {
    const input = inspirationAssistantInput(course, index, options.model);
    let assistant = (await ports.registry.listAssistants()).find(item => item.id === id);
    if (!assistant) await ports.registry.createAssistant(actor, input, id);
    assistant = (await ports.registry.listAssistants()).find(item => item.id === id);
    requireCondition(assistant && teachingValueDigest(assistantIdentity(assistant)) === teachingValueDigest(input), 'CATALOG_ASSISTANT_READBACK_MISMATCH');
  }
  const teamInput = inspirationTeamInput(course);
  let team = (await ports.registry.listTeams()).find(item => item.id === course.teamId);
  if (!team) await ports.registry.createTeam(actor, teamInput, course.teamId);
  team = (await ports.registry.listTeams()).find(item => item.id === course.teamId);
  requireCondition(team && team.enabled && team.name === course.teamName && team.leaderAssistantId === course.assistantIds[0]
    && team.members.length === 3 && team.members.every(member => teamInput.members.some(expected => expected.assistantId === member.assistantId
      && expected.slotId === member.slotId && expected.role === member.role)), 'CATALOG_TEAM_READBACK_MISMATCH');
  let template = await ports.templates.findTemplateBySlug(null, course.slug);
  if (!template) {
    const created = await ports.governance.createTemplate(actor, course.templateInput, `${course.bootstrapKey}:template`);
    template = await ports.templates.findTemplate(created.template.id);
  }
  requireCondition(template && template.status !== 'archived' && template.title === course.spec.title && template.domain === course.spec.targetDomain,
    'CATALOG_TEMPLATE_READBACK_MISMATCH');
  let version = (await ports.templates.listVersions(template.id)).find(item => item.content.bootstrapKey === course.bootstrapKey);
  if (!version) {
    const created = await ports.governance.createVersion(actor, template.id, course.versionInput, `${course.bootstrapKey}:version`);
    version = await ports.templates.findVersion(created.version.id) ?? undefined;
  }
  requireCondition(version && teachingValueDigest({ stages: version.stages, content: version.content, rubric: version.rubric })
    === teachingValueDigest(course.versionInput), 'CATALOG_TEMPLATE_CONTENT_CHANGED');
  let binding = await ports.bindingStore.findActiveBinding(version.id);
  if (!binding) {
    const arranged = await ports.bindings.prepareCurrentTeams(actor, template.id, version.id, {
      teamId: team.id, scheduleProfileId: course.profileId, teams: [{ teamId: team.id, expectedUpdatedAt: team.updatedAt }],
      sessions: course.spec.curriculum!.profiles[0]!.sessions.map(session => ({ sessionIndex: session.sessionIndex,
        teamId: team.id, kind: 'assistant', assistantId: session.leadAssistantId })),
    }, `${course.bootstrapKey}:arrange`);
    binding = await ports.bindingStore.findBinding(arranged.binding.id);
    requireCondition(binding, 'CATALOG_BINDING_READBACK_FAILED');
    if (options.mode === 'pilot') {
      if (version.status === 'draft') await ports.governance.pilotVersion(actor, template.id, version.id, `${course.bootstrapKey}:pilot`,
        '新增跨领域项目的受治理试点；配置与隔离行为验收不代表真实课堂成效或正式发布。');
      await ports.bindings.validateBinding(actor, template.id, version.id, arranged.binding.id, `${course.bootstrapKey}:validate`);
      binding = await ports.bindingStore.findBinding(arranged.binding.id);
      requireCondition(binding?.validation.valid, 'CATALOG_BINDING_VALIDATION_FAILED');
      await ports.bindings.activateBinding(actor, template.id, version.id, binding.id, `${course.bootstrapKey}:activate`);
      binding = await ports.bindingStore.findActiveBinding(version.id);
    }
  }
  requireCondition(binding, 'CATALOG_BINDING_READBACK_FAILED');
  if (options.mode === 'pilot') requireCondition(binding.status === 'active' && binding.bundlePayload
    && binding.bundleDigest === teachingValueDigest(binding.bundlePayload)
    && binding.bundlePayload.templateDigest === teachingValueDigest(course.spec)
    && !binding.bundlePayload.knowledgeGrant, 'CATALOG_ACTIVE_BINDING_READBACK_FAILED');
  const actualTemplate = await ports.templates.findTemplate(template.id), actualVersion = await ports.templates.findVersion(version.id);
  return { slug: course.slug, title: course.spec.title, templateId: template.id, templateVersionId: version.id,
    templateStatus: actualTemplate?.status, versionStatus: actualVersion?.status, teamId: team.id, assistantIds: course.assistantIds,
    bindingId: binding.id, bindingStatus: binding.status, bindingHash: binding.bindingHash, bundleDigest: binding.bundleDigest,
    lessonCount: 8, liveRequestVerified: false, classroomValidated: false };
}

/** Explicit Admin command. Uses existing owners and never creates learner projects or evidence. */
export async function configureInspirationCatalog(ports: InspirationCatalogPorts, options: InspirationCatalogOptions) {
  if (options.actor.role !== 'admin') throw new ForbiddenException({ code: 'CATALOG_ADMIN_REQUIRED' });
  requireCondition(options.mode === 'draft' || options.mode === 'pilot', 'CATALOG_MODE_INVALID');
  requireCondition(options.model.modelProviderId && options.model.modelId && ports.registry.isModelAvailable(options.model), 'CATALOG_MODEL_UNAVAILABLE');
  requireCondition(options.progression === undefined || options.progression === 'guided' || options.progression === 'dialogue', 'CATALOG_PROGRESSION_INVALID');
  const catalog = options.progression === 'dialogue' ? INSPIRATION_DIALOGUE_COURSES : INSPIRATION_COURSES;
  const courses = options.projects ? catalog.filter(course => options.projects!.includes(course.slug)) : [...catalog];
  requireCondition(courses.length && (!options.projects || new Set(options.projects).size === options.projects.length
    && courses.length === options.projects.length), 'CATALOG_PROJECT_SELECTION_INVALID');
  const runtime = loadTutorRuntimeSource();
  for (const course of courses) for (const id of course.skills) requireCondition(runtime.skills.some(skill =>
    skill.id === id && skill.runtime === 'teaching' && skill.status === 'ready' && skill.publicationStatus === 'published'
      && skill.version && skill.contentHash), `CATALOG_SKILL_UNAVAILABLE:${id}`);
  const results: Array<{ status: 'configured'; resource: Awaited<ReturnType<typeof configureCourse>> } | { status: 'failed'; slug: string; code: string }> = [];
  for (const course of courses) {
    try { results.push({ status: 'configured', resource: await configureCourse(ports, options, course) }); }
    catch (error) {
      const response = error instanceof HttpException ? error.getResponse() : null;
      const ownerCode = response && typeof response === 'object' && 'code' in response ? response.code : null;
      const code = typeof ownerCode === 'string' && /^[A-Z_]+$/.test(ownerCode) ? ownerCode
        : error instanceof Error && /^CATALOG_[A-Z_]+$/.test(error.message) ? error.message : 'CATALOG_PROJECT_CONFIGURATION_FAILED';
      results.push({ status: 'failed', slug: course.slug, code });
    }
  }
  return { mode: options.mode, success: results.every(item => item.status === 'configured'), results };
}
