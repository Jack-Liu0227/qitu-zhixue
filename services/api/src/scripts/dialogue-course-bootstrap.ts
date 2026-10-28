import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { users, type Database } from '@qitu/database';
import { WAVE_DIALOGUE_PROFILE_ID, WAVE_DIALOGUE_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import type { CurrentUser, TeachingBundleDraft, AdminTeamCreateInput, AdminTeamMemberInput } from '@qitu/contracts';
import { DatabaseModule, DATABASE_TOKEN } from '../database';
import { AuditModule } from '../common/audit/audit.module';
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
import { teachingValueDigest } from '../modules/templates/teaching-bundle.canonical';
import { loadTutorRuntimeSource } from '../common/tutor-runtime/runtime-source';
import { readPublishedAssistant } from '../modules/platform-registry/team-version.snapshot';
import { WAVE_DIALOGUE_BOOTSTRAP_KEY, WAVE_DIALOGUE_TEMPLATE_SLUG } from '../modules/templates/content/wave-dialogue';
import { runOpticsTemplateBootstrap } from './optics-template-bootstrap';

@Module({ imports: [DatabaseModule, AuditModule, AccessModule, IdempotencyModule, TemplatesModule, PlatformRegistryModule] })
class DialogueBootstrapModule {}

/** Admin owner commands only. Copies existing grants; no new model/KB/skill permission or student fact is invented. */
export async function bootstrapDialogueCourse(sourceBindingId: string, adminUserId: string) {
  if (!sourceBindingId || !adminUserId) throw new Error('Explicit --source-binding-id and --admin-user-id are required');
  const app = await NestFactory.createApplicationContext(DialogueBootstrapModule, { logger: ['warn', 'error'] });
  try {
    const db = app.get<Database>(DATABASE_TOKEN);
    const [user] = await db.select({ id: users.id, role: users.role, disabledAt: users.disabledAt }).from(users).where(eq(users.id, adminUserId));
    if (!user || user.role !== 'admin' || user.disabledAt) throw new Error('ADMIN_IDENTITY_UNAVAILABLE');
    const actor: CurrentUser = { id: user.id, role: 'admin', email: '', displayName: '' };
    const bindingStore = app.get(TemplateBindingStore), source = await bindingStore.findBinding(sourceBindingId);
    if (!source?.bundlePayload || !source.bundleDraft || source.status !== 'active'
      || source.bundlePayload.template.id !== 'pbl-wave-interference-diffraction'
      || source.bundlePayload.template.curriculum?.profiles.some(profile => profile.sessions.some(session => !session.teachingSpec))) throw new Error('SOURCE_ZERO_BASE_BINDING_REQUIRED');
    const sourceTeam = await bindingStore.findTeamVersion(source.teamVersionId, source.id);
    if (!sourceTeam) throw new Error('SOURCE_TEAM_REQUIRED');
    if (source.bundleDraft.sessionAssignments?.length) throw new Error('SOURCE_MULTI_TEAM_REQUIRES_EXPLICIT_MAPPING');
    const policy = loadTutorRuntimeSource().policy;
    if (policy.status !== 'ready') throw new Error('CURRENT_TEACHING_POLICY_UNAVAILABLE');
    const registry = app.get(PlatformRegistryService);
    const spec = WAVE_DIALOGUE_TEMPLATE_SPEC;
    const input: AdminTeamCreateInput = { name: '波动光学问答探究团队', description: '必要证据连续学习，末课正式交付。', enabled: true,
      leaderAssistantId: sourceTeam.leaderAssistantId, workspaceMode: 'shared', sessionMode: 'supervised',
      members: sourceTeam.members.map(raw => { const member = raw as AdminTeamMemberInput;
        return { assistantId: member.assistantId, role: member.role, roleLabel: member.roleLabel, pblPhase: member.pblPhase }; }),
      pblSpec: { projectId: spec.id, projectName: spec.title, targetDomain: spec.targetDomain, theoryMasteredGate: true, allowAutonomousAdvance: false,
        phases: spec.phases.map(phase => ({ phase: phase.phase, title: phase.title, assignedAssistantId: phase.assignedAssistantId!,
          gateCondition: phase.gateCondition, ...(phase.evidenceProfile ? { evidenceProfile: phase.evidenceProfile } : {}),
          ...(phase.deliverableType ? { deliverableType: phase.deliverableType } : {}),
          learningObjectives: phase.objectiveIds.map(id => spec.objectives.find(objective => objective.id === id)!.description) })) } };
    const team = await registry.createTeam(actor, input, spec.teamId);
    if (team.pblSpec?.phases.some(phase => spec.phases.find(expected => expected.phase === phase.phase)?.gateCondition !== phase.gateCondition)
      || team.members.length !== input.members.length) throw new Error('DIALOGUE_TEAM_READBACK_MISMATCH');
    const captured = await app.get(TeachingTeamCaptureService).capture(actor, team.id, { expectedUpdatedAt: team.updatedAt }, `dialogue-team:${sourceBindingId}`);
    const draft: Omit<TeachingBundleDraft, 'templateVersionId' | 'teamVersionId'> = { ...source.bundleDraft,
      scheduleProfileId: WAVE_DIALOGUE_PROFILE_ID,
      approvalPolicyVersion: policy.version,
      skillPins: source.bundleDraft.skillPins.map(pin => {
        const original = source.bundlePayload!.roles.find(role => role.roleSlotId === pin.roleSlotId);
        const member = captured.members.find(raw => raw && typeof raw === 'object' && 'assistantId' in raw
          && raw.assistantId === original?.assistantId) as { assistantId: string; runtimeSnapshot: unknown } | undefined;
        if (!member) throw new Error('DIALOGUE_MEMBER_UNRESOLVED');
        const published = readPublishedAssistant(member.runtimeSnapshot, member.assistantId).skills.find(skill => skill.canonicalId === pin.canonicalId);
        if (!published) throw new Error('DIALOGUE_SOURCE_SKILL_REVOKED');
        return { ...published, roleSlotId: pin.roleSlotId };
      }),
      roleMap: source.bundleDraft.roleMap.map(role => {
        const original = source.bundlePayload!.roles.find(item => item.roleSlotId === role.roleSlotId);
        const member = team.members.find(item => item.assistantId === original?.assistantId);
        if (!member) throw new Error('DIALOGUE_MEMBER_UNRESOLVED');
        return { ...role, memberId: member.slotId };
      }) };
    const templates = app.get(TemplateStore), bindings = app.get(TemplateBindingService);
    const existingTemplate = await templates.findTemplateBySlug(null, WAVE_DIALOGUE_TEMPLATE_SLUG);
    if (existingTemplate) for (const version of await templates.listVersions(existingTemplate.id)) {
      if (version.content.bootstrapKey !== WAVE_DIALOGUE_BOOTSTRAP_KEY) continue;
      if (teachingValueDigest(version.content.pbl) !== teachingValueDigest(spec)) throw new Error('DIALOGUE_TEMPLATE_CONTENT_CHANGED');
      const pending = (await bindingStore.listBindings(version.id)).find(binding => binding.teamVersionId === captured.id && binding.status === 'draft');
      if (!pending?.bundleDraft) continue;
      const candidate: TeachingBundleDraft = { ...draft, templateVersionId: version.id, teamVersionId: captured.id };
      const permissions = (value: TeachingBundleDraft) => ({ ...value, approvalPolicyVersion: '',
        skillPins: value.skillPins.map(pin => ({ canonicalId: pin.canonicalId, roleSlotId: pin.roleSlotId })) });
      if (teachingValueDigest(permissions(pending.bundleDraft)) !== teachingValueDigest(permissions(candidate))) throw new Error('DIALOGUE_DRAFT_CHANGED_REQUIRES_REVIEW');
      if (teachingValueDigest(pending.bundleDraft) !== teachingValueDigest(candidate)) await bindings.saveTeachingBundleDraft(actor,
        existingTemplate.id, version.id, pending.id, candidate, `dialogue-policy-refresh:${teachingValueDigest(candidate)}`);
    }
    const report = await runOpticsTemplateBootstrap({ governance: app.get(TemplateGovernanceService), bindings: app.get(TemplateBindingService),
      templates: app.get(TemplateStore), bindingStore }, { dialogue: true, actor, teamVersionId: captured.id, capturedTeam: captured,
      pilotReason: '问答自动留证与末课交付试点；学习效果须独立真实验收。', teachingBundle: draft });
    const binding = report.bindingId ? await bindingStore.findBinding(report.bindingId) : null;
    if (binding?.status !== 'active' || !binding.bundlePayload
      || teachingValueDigest(binding.bundlePayload.template) !== teachingValueDigest(spec)) throw new Error('DIALOGUE_BINDING_READBACK_FAILED');
    return { ...report, status: 'pilot', sourceBindingId, templateHash: teachingValueDigest(spec),
      approvalPolicyVersion: policy.version, refreshedSkillPins: draft.skillPins.filter(pin => source.bundleDraft!.skillPins.some(previous =>
        previous.roleSlotId === pin.roleSlotId && previous.canonicalId === pin.canonicalId && previous.packageDigest !== pin.packageDigest)).length,
      classroomValidated: false };
  } finally { await app.close(); }
}
if (require.main === module) {
  const arg = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? '' : process.argv[index + 1] ?? ''; };
  void bootstrapDialogueCourse(arg('--source-binding-id'), arg('--admin-user-id')).then(report => console.log(JSON.stringify(report)))
    .catch(error => { console.error(error instanceof Error ? error.message : 'DIALOGUE_BOOTSTRAP_FAILED'); process.exitCode = 1; });
}
