import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { users, type Database } from '@qitu/database';
import { WAVE_TEACHING_PROFILE_ID, WAVE_TEACHING_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import type { CurrentUser, TeachingBundleDraft, AdminTeamCreateInput, AdminTeamMemberInput, AdminTeamPblSpecInput } from '@qitu/contracts';
import { DatabaseModule, DATABASE_TOKEN } from '../database';
import { AuditModule } from '../common/audit/audit.module';
import { AuditWriter } from '../common/audit/audit.service';
import { AccessModule } from '../common/access/access.module';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { TemplatesModule } from '../modules/templates/templates.module';
import { TemplateStore } from '../modules/templates/templates.store';
import { TemplateBindingStore } from '../modules/templates/templates-binding.store';
import { TemplateBindingService } from '../modules/templates/templates-binding.service';
import { TemplateGovernanceService } from '../modules/templates/templates-governance.service';
import { PlatformRegistryModule } from '../modules/platform-registry/platform-registry.module';
import { PlatformRegistryService } from '../modules/platform-registry/platform-registry.service';
import { TeachingTeamCaptureService } from '../modules/platform-registry/teaching-team-capture.service';
import { CopilotResources } from '../modules/admin-copilot/copilot.resources';
import { loadTutorRuntimeSource } from '../common/tutor-runtime/runtime-source';
import { runOpticsTemplateBootstrap } from './optics-template-bootstrap';

@Module({ imports: [DatabaseModule, AuditModule, AccessModule, IdempotencyModule, TemplatesModule, PlatformRegistryModule] })
class CoursewareBootstrapModule {}

/** Audited opt-in publication. Never edits a historical binding or creates student learning facts. */
export async function bootstrapCourseware(sourceBindingId: string, adminUserId: string) {
  if (!sourceBindingId || !adminUserId) throw new Error('Explicit --source-binding-id and --admin-user-id are required');
  const app = await NestFactory.createApplicationContext(CoursewareBootstrapModule, { logger: ['warn', 'error'] });
  try {
    const db = app.get<Database>(DATABASE_TOKEN);
    const [user] = await db.select({ id: users.id, role: users.role, disabledAt: users.disabledAt }).from(users).where(eq(users.id, adminUserId));
    if (!user || user.role !== 'admin' || user.disabledAt) throw new Error('ADMIN_IDENTITY_UNAVAILABLE');
    const actor: CurrentUser = { id: user.id, role: 'admin', email: '', displayName: '' };
    const bindingStore = app.get(TemplateBindingStore), source = await bindingStore.findBinding(sourceBindingId);
    if (!source?.bundlePayload || !source.bundleDraft || source.status !== 'active'
      || source.bundlePayload.template.id !== 'pbl-wave-interference-diffraction') throw new Error('SOURCE_WAVE_BINDING_REQUIRED');
    const sourceTeam = await bindingStore.findTeamVersion(source.teamVersionId, source.id);
    if (!sourceTeam) throw new Error('SOURCE_TEAM_VERSION_REQUIRED');
    const owner = new CopilotResources(db, app.get(AuditWriter));
    const input = JSON.parse(readFileSync(resolve('tooling/courseware-skill.json'), 'utf8')) as { id: string; content: string };
    const existing = loadTutorRuntimeSource().skills.find(skill => skill.id === input.id);
    if (!existing) {
      const draft = await owner.createSkill(actor, input, 'courseware-guidance-v1');
      await owner.publishSkill(actor, { id: draft.id, digest: draft.digest }, 'courseware-guidance-v1');
    } else if (existing.publicationStatus !== 'published' || !existing.content.includes(input.content)) throw new Error('SKILL_SOURCE_CHANGED');
    const skill = loadTutorRuntimeSource().skills.find(skill => skill.id === input.id);
    if (!skill?.version || skill.status !== 'ready') throw new Error('COURSEWARE_SKILL_UNAVAILABLE');
    const registry = app.get(PlatformRegistryService);
    const tools = ['tutor.propose_lesson_activity', 'tutor.propose_wave_activity', 'tutor.propose_courseware_activity', 'knowledge_search', 'knowledge_read'];
    const assistants = await registry.listAssistants();
    for (const role of source.bundlePayload.roles) {
      const assistant = assistants.find(a => a.id === role.assistantId);
      if (!assistant?.enabled) throw new Error('SOURCE_ASSISTANT_UNAVAILABLE');
      const enabledSkills = [...new Set([...assistant.enabledSkills, skill.id])];
      const toolIds = [...new Set([...assistant.toolIds, ...tools])];
      if (enabledSkills.length !== assistant.enabledSkills.length || toolIds.length !== assistant.toolIds.length) {
        await registry.updateAssistant(actor, assistant.id, { enabledSkills, toolIds }, assistant.updatedAt);
      }
      const fresh = (await registry.listAssistants()).find(a => a.id === role.assistantId);
      if (!fresh?.enabledSkills.includes(skill.id) || tools.some(id => !fresh.toolIds.includes(id))) throw new Error('ASSISTANT_GRANT_READBACK_FAILED');
    }
    const { teamVersionPublication: _publication, ...workflow } = sourceTeam.pblSpec;
    const members = sourceTeam.members.map(raw => {
      const member = raw as AdminTeamMemberInput;
      return { assistantId: member.assistantId, role: member.role, roleLabel: member.roleLabel, pblPhase: member.pblPhase };
    });
    const teamInput: AdminTeamCreateInput = { name: `${sourceTeam.name} · 零基础课件`, description: '基于已发布专题团队的独立零基础教学版本',
      leaderAssistantId: sourceTeam.leaderAssistantId, members, enabled: true, workspaceMode: 'shared', sessionMode: 'supervised',
      pblSpec: workflow as unknown as AdminTeamPblSpecInput };
    const teamId = WAVE_TEACHING_TEMPLATE_SPEC.teamId;
    const team = await registry.createTeam(actor, teamInput, teamId);
    const published = await app.get(TeachingTeamCaptureService).capture(actor, team.id, { expectedUpdatedAt: team.updatedAt }, `courseware-team:${sourceBindingId}`);
    const draft: Omit<TeachingBundleDraft, 'templateVersionId' | 'teamVersionId'> = {
      ...source.bundleDraft, scheduleProfileId: WAVE_TEACHING_PROFILE_ID,
      roleMap: source.bundleDraft.roleMap.map(role => {
        const oldMember = source.bundlePayload!.roles.find(value => value.roleSlotId === role.roleSlotId);
        const member = team.members.find(value => value.assistantId === oldMember?.assistantId);
        if (!member) throw new Error('COURSEWARE_ROLE_MEMBER_UNRESOLVED');
        return { ...role, memberId: member.slotId };
      }),
      skillPins: [...source.bundleDraft.skillPins, ...source.bundleDraft.roleMap.filter(role =>
        !source.bundleDraft!.skillPins.some(pin => pin.roleSlotId === role.roleSlotId && pin.canonicalId === skill.id))
        .map(role => ({ roleSlotId: role.roleSlotId, canonicalId: skill.id, version: skill.version!, packageDigest: skill.contentHash }))],
      toolIds: [...source.bundleDraft.toolIds, ...source.bundleDraft.roleMap.flatMap(role => tools.filter(toolId =>
        !source.bundleDraft!.toolIds.some(pin => pin.roleSlotId === role.roleSlotId && pin.toolId === toolId)).map(toolId => ({ roleSlotId: role.roleSlotId, toolId })))],
    };
    const report = await runOpticsTemplateBootstrap({ governance: app.get(TemplateGovernanceService), bindings: app.get(TemplateBindingService),
      templates: app.get(TemplateStore), bindingStore }, { zeroBase: true, actor, teamVersionId: published.id, capturedTeam: published,
      pilotReason: '零基础讲解、课件恢复与审核复用的受治理试点；课堂效果尚待真实试点。', teachingBundle: draft });
    const binding = report.bindingId ? await bindingStore.findBinding(report.bindingId) : null;
    if (binding?.status !== 'active' || !binding.bundlePayload) throw new Error('BINDING_READBACK_FAILED');
    return { ...report, skill: { id: skill.id, digest: skill.contentHash }, teamVersionId: published.id, status: 'pilot',
      sourceBindingId, classroomValidated: false };
  } finally { await app.close(); }
}
if (require.main === module) {
  const arg = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? '' : process.argv[index + 1] ?? ''; };
  void bootstrapCourseware(arg('--source-binding-id'), arg('--admin-user-id')).then(report => console.log(JSON.stringify(report)))
    .catch(error => { console.error(error instanceof Error ? error.message : 'COURSEWARE_BOOTSTRAP_FAILED'); process.exitCode = 1; });
}
