import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { users, type Database } from '@qitu/database';
import type { AdminTeamCreateInput, CurrentUser } from '@qitu/contracts';
import { DatabaseModule, DATABASE_TOKEN } from '../database';
import { AuditModule } from '../common/audit/audit.module';
import { AccessModule } from '../common/access/access.module';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { hashRequest } from '../common/idempotency/idempotency.hash';
import { TemplatesModule } from '../modules/templates/templates.module';
import { TemplateStore } from '../modules/templates/templates.store';
import { TemplateBindingStore } from '../modules/templates/templates-binding.store';
import { TemplateBindingService } from '../modules/templates/templates-binding.service';
import { TemplateGovernanceService } from '../modules/templates/templates-governance.service';
import { TeachingBundleCatalog } from '../modules/templates/teaching-bundle.catalog';
import { PlatformRegistryModule } from '../modules/platform-registry/platform-registry.module';
import { PlatformRegistryService } from '../modules/platform-registry/platform-registry.service';
import { TeachingTeamCaptureService } from '../modules/platform-registry/teaching-team-capture.service';
import { loadTutorRuntimeSource } from '../common/tutor-runtime/runtime-source';
import { THUNDER_BOOTSTRAP_KEY, THUNDER_PROFILE_ID, THUNDER_TEAM_ID, THUNDER_TEACHING_SKILLS,
  THUNDER_TEMPLATE_INPUT, THUNDER_TEMPLATE_SLUG, THUNDER_TEMPLATE_SPEC, THUNDER_VERSION_INPUT } from '../modules/templates/content/thunder-fighter';
import { WAVE_TEACHING_TEMPLATE_SLUG } from '../modules/templates/content/wave-teaching';

@Module({ imports: [DatabaseModule, AuditModule, AccessModule, IdempotencyModule, TemplatesModule, PlatformRegistryModule] })
class CatalogModule {}

/** Explicit Admin command. Archives catalogue entries only after both retained bindings are ready. */
export async function configureTwoProjectCatalog(adminUserId: string) {
  if (!adminUserId) throw new Error('Explicit --admin-user-id is required');
  const app = await NestFactory.createApplicationContext(CatalogModule, { logger: ['warn', 'error'] });
  try {
    const db = app.get<Database>(DATABASE_TOKEN);
    const [user] = await db.select({ id: users.id, role: users.role, disabledAt: users.disabledAt }).from(users).where(eq(users.id, adminUserId));
    if (!user || user.role !== 'admin' || user.disabledAt) throw new Error('ADMIN_IDENTITY_UNAVAILABLE');
    const actor: CurrentUser = { id: user.id, role: 'admin', email: '', displayName: '' };
    const templates = app.get(TemplateStore), bindingStore = app.get(TemplateBindingStore);
    const bindings = app.get(TemplateBindingService), governance = app.get(TemplateGovernanceService);
    const retained = await templates.findTemplateBySlug(null, WAVE_TEACHING_TEMPLATE_SLUG);
    if (!retained || !['published', 'piloting'].includes(retained.status)) throw new Error('ZERO_BASE_OPTICS_UNAVAILABLE');
    const opticalVersion = (await templates.listVersions(retained.id)).filter(v => ['published', 'piloting'].includes(v.status)).at(-1);
    const opticalBinding = opticalVersion ? await bindingStore.findActiveBinding(opticalVersion.id) : null;
    if (!opticalBinding?.bundlePayload || !opticalBinding.validation.valid) throw new Error('ZERO_BASE_OPTICS_BINDING_UNAVAILABLE');
    const runtime = loadTutorRuntimeSource();
    if (THUNDER_TEACHING_SKILLS.some(id => !runtime.skills.some(s => s.id === id && s.status === 'ready' && s.publicationStatus === 'published'))) {
      throw new Error('THUNDER_TEACHING_SKILL_UNAVAILABLE');
    }
    const registry = app.get(PlatformRegistryService);
    const phaseRoles = THUNDER_TEMPLATE_SPEC.phases;
    for (const id of new Set(phaseRoles.map(p => p.assignedAssistantId))) {
      if (!id) throw new Error('THUNDER_ROLE_MISSING');
      const assistant = (await registry.listAssistants()).find(a => a.id === id);
      if (!assistant?.enabled || !assistant.modelProviderId || !assistant.modelId) throw new Error('THUNDER_ASSISTANT_UNAVAILABLE');
      const enabledSkills = [...new Set([...assistant.enabledSkills, ...THUNDER_TEACHING_SKILLS])];
      const toolIds = [...new Set([...assistant.toolIds, 'tutor.propose_lesson_activity'])];
      const teachingRule = '从零基础开始，每次解释一个概念并展示图示，然后请学生预测或尝试。正式实践须经 TheoryMastered。仅指导学生在受控本地环境编写 Python/Pygame；不能把静态检查当作可玩证明。没有可检索的编程知识库时明确示例来源，不伪称教材检索。';
      const instructions = assistant.instructions.includes(teachingRule) ? assistant.instructions : `${assistant.instructions}\n${teachingRule}`;
      if (hashRequest({ enabledSkills, toolIds, instructions }) !== hashRequest({ enabledSkills: assistant.enabledSkills, toolIds: assistant.toolIds, instructions: assistant.instructions })) {
        await registry.updateAssistant(actor, id, { enabledSkills, toolIds, instructions }, assistant.updatedAt);
      }
    }
    const leaders = ['fighter-concept-coach', 'fighter-code-guide', 'fighter-review-assessor'];
    const input: AdminTeamCreateInput = {
      name: '雷霆战机 · 零基础小游戏导师团队', description: '由概念教练、代码向导和评审导师带领学生完成八课时项目。',
      leaderAssistantId: leaders[0]!, enabled: true, workspaceMode: 'shared', sessionMode: 'supervised',
      members: leaders.map((assistantId, i) => ({ assistantId, role: i === 0 ? 'leader' : i === 1 ? 'teammate' : 'reviewer',
        pblPhase: i === 0 ? 'concept_mastery' : i === 1 ? 'guided_practice' : 'deliverable_review' })),
      pblSpec: { projectId: THUNDER_TEMPLATE_SPEC.id, projectName: THUNDER_TEMPLATE_SPEC.title, targetDomain: THUNDER_TEMPLATE_SPEC.targetDomain,
        theoryMasteredGate: true, allowAutonomousAdvance: false,
        phases: phaseRoles.map(phase => ({ phase: phase.phase, title: phase.title, assignedAssistantId: phase.assignedAssistantId!,
          learningObjectives: phase.objectiveIds.map(id => THUNDER_TEMPLATE_SPEC.objectives.find(o => o.id === id)!.description),
          ...(phase.deliverableType ? { deliverableType: phase.deliverableType } : {}),
          ...(phase.evidenceProfile ? { evidenceProfile: phase.evidenceProfile } : {}),
        })),
      },
    };
    let template = await templates.findTemplateBySlug(null, THUNDER_TEMPLATE_SLUG);
    if (!template) template = await templates.findTemplate((await governance.createTemplate(actor, THUNDER_TEMPLATE_INPUT, `${THUNDER_BOOTSTRAP_KEY}:create`)).template.id);
    if (!template) throw new Error('TEMPLATE_READBACK_FAILED');
    let version = (await templates.listVersions(template.id)).find(v => v.content.bootstrapKey === THUNDER_BOOTSTRAP_KEY);
    if (!version) version = await templates.findVersion((await governance.createVersion(actor, template.id, THUNDER_VERSION_INPUT, `${THUNDER_BOOTSTRAP_KEY}:version`)).version.id) ?? undefined;
    if (!version || hashRequest({ stages: version.stages, content: version.content, rubric: version.rubric }) !== hashRequest(THUNDER_VERSION_INPUT)) throw new Error('THUNDER_VERSION_CONTENT_CHANGED');
    let active = await bindingStore.findActiveBinding(version.id);
    if (!active) {
      const team = await registry.createTeam(actor, input, THUNDER_TEAM_ID);
      const published = await app.get(TeachingTeamCaptureService).capture(actor, team.id, { expectedUpdatedAt: team.updatedAt }, `${THUNDER_BOOTSTRAP_KEY}:team`);
      const teamVersion = published;
      if (!teamVersion) throw new Error('TEAM_VERSION_READBACK_FAILED');
      if (version.status === 'draft') await governance.pilotVersion(actor, template.id, version.id, `${THUNDER_BOOTSTRAP_KEY}:pilot`, '管理员新增雷霆战机零基础八课时课程；按正规试点使用，真实课堂成效待验证。');
      const created = await bindings.createBinding(actor, template.id, version.id, { teamVersionId: published.id, teamSnapshots: { [published.id]: published } }, `${THUNDER_BOOTSTRAP_KEY}:binding`);
      const draft = app.get(TeachingBundleCatalog).prepareDraft(version, teamVersion, THUNDER_PROFILE_ID);
      await bindings.saveTeachingBundleDraft(actor, template.id, version.id, created.binding.id, draft, `${THUNDER_BOOTSTRAP_KEY}:bundle`);
      await bindings.validateBinding(actor, template.id, version.id, created.binding.id, `${THUNDER_BOOTSTRAP_KEY}:validate`);
      await bindings.activateBinding(actor, template.id, version.id, created.binding.id, `${THUNDER_BOOTSTRAP_KEY}:activate`);
      active = await bindingStore.findActiveBinding(version.id);
    }
    if (!active?.validation.valid || !active.bundlePayload || active.bundlePayload.template.id !== THUNDER_TEMPLATE_SPEC.id) throw new Error('THUNDER_BINDING_READBACK_FAILED');
    const retireSlugs = new Set(['curriculum-plan', 'optics-physical-inquiry-16s-guided', 'wave-interference-diffraction-8s']);
    const archived = [];
    for (const entry of await templates.listTemplates({ visibleToSchoolId: null })) {
      if (!retireSlugs.has(entry.slug)) continue;
      const result = await governance.archiveTemplate(actor, entry.id, `two-catalog:archive:v1:${entry.id}`, '管理员将新建项目目录收敛为雷霆战机和零基础干涉衍射；保留原版本、绑定与历史项目。');
      if (result.template.status !== 'archived') throw new Error('ARCHIVE_READBACK_FAILED');
      archived.push({ id: entry.id, slug: entry.slug });
    }
    const visible = (await templates.listTemplates({ visibleToSchoolId: null })).filter(t => ['published', 'piloting'].includes(t.status));
    if (visible.length !== 2 || visible.some(t => ![retained.id, template.id].includes(t.id))) throw new Error('CATALOG_READBACK_MISMATCH');
    return { visible: visible.map(t => ({ id: t.id, slug: t.slug, title: t.title, status: t.status })), archived,
      game: { templateVersionId: version.id, bindingId: active.id, teamVersionId: active.teamVersionId, bundleDigest: active.bundleDigest,
        lessonCount: 8, classroomValidated: false, programmingKnowledgeBaseBound: false },
      preservedOptics: { templateId: retained.id, versionId: opticalVersion!.id, bindingId: opticalBinding.id, bundleDigest: opticalBinding.bundleDigest } };
  } finally { await app.close(); }
}
if (require.main === module) {
  const index = process.argv.indexOf('--admin-user-id');
  void configureTwoProjectCatalog(index < 0 ? '' : process.argv[index + 1] ?? '').then(report => console.log(JSON.stringify(report)))
    .catch(error => { console.error(error instanceof Error ? error.message : 'CATALOG_CONFIGURATION_FAILED'); process.exitCode = 1; });
}
