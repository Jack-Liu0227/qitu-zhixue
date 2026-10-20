import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TutorExperimentService } from './tutor-experiment.service';
import type { LearningPlanStore } from '../learning-plan/learning-plan.store';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import type { MasteryDomainService } from '../mastery/mastery-domain.service';
import type { TutorSessionRecord } from './tutor.service';
import type { EffectiveAgentRuntime } from '../platform-registry/platform-registry.service';
import { builtinToolRegistry } from '../platform-registry/built-in-tools';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';

function fixture() {
  const project = { id: 'project', studentId: 'student', templateVersionId: 'template', status: 'practice_ready' };
  const plan = { id: 'plan', projectId: 'project', studentUserId: 'student', templateVersion: 'template', version: 3 };
  const session = { id: 'plan:session-11', lessonIndex: 11, theoryObjectiveIds: ['plan:theory'] };
  const scope = { projectId: project.id, planId: plan.id, planRevision: plan.version, learningSessionId: session.id,
    objectiveId: 'plan:measure', tutorSessionId: 'chat' };
  const lesson = { id: 'session-11', sessionIndex: 11, objectiveIds: ['measure'], interactiveSpec: { enabled: true, domainTopic: 'diffraction_slit' } };
  const store = { findProject: async () => project, listPlansByStudent: async () => [plan], findBundle: async () => ({ plan, sessions: [session] }) } as unknown as LearningPlanStore;
  const teaching = { templateVersionId: 'template', scheduleProfileId: 'frozen', template: { rubricId: 'rubric',
    curriculum: { profiles: [{ id: 'frozen', sessions: [lesson] }] } } };
  const bindings = { getFrozenTeachingBundle: async () => teaching } as unknown as TemplateBindingService;
  let mastered = true;
  const mastery = { checkRequiredObjectives: async (_actor: unknown, student: string, planId: string, ids: string[]) => {
    assert.equal(student, 'student'); assert.equal(planId, 'plan'); assert.deepEqual(ids, ['plan:theory']); return mastered;
  } } as unknown as MasteryDomainService;
  const owner = new TutorExperimentService(store, bindings, {} as never, {} as never, {} as never, null, mastery);
  const candidate = { title: 'Compare the slit', summary: 'Predict then observe the model.', mode: 'diffraction' as const,
    parameters: { wavelength: 532, slitWidth: 80, screenDistance: 1 } };
  return { owner, scope, candidate, project, lesson, teaching, revokeMastery: () => { mastered = false; } };
}

test('optics candidate is owned by actual frozen lesson/model and bounded parameters with stable action identity', async () => {
  const h = fixture();
  const block = await h.owner.propose('student', h.scope, h.candidate, 'key');
  assert.deepEqual(block.initialParameters, h.candidate.parameters);
  assert.deepEqual(block.allowedModels, ['diffraction']);
  assert.equal(block.scope?.learningSessionId, 'plan:session-11');
  assert.equal(block.scope?.planRevision, 3);
  assert.equal(block.scope?.objectiveId, 'plan:measure');
  assert.equal(block.experimentId, (await h.owner.propose('student', h.scope, h.candidate, 'key')).experimentId);
  await assert.rejects(h.owner.propose('other-student', h.scope, h.candidate, 'key'));
  await assert.rejects(h.owner.propose('student', { ...h.scope, planRevision: 2 }, h.candidate, 'key'));
  await assert.rejects(h.owner.propose('student', h.scope, { ...h.candidate, mode: 'scattering' }, 'key'));
  await assert.rejects(h.owner.propose('student', h.scope, { ...h.candidate, parameters: { ...h.candidate.parameters, slitWidth: 1 } }, 'key'));
  h.lesson.interactiveSpec.enabled = false;
  await assert.rejects(h.owner.propose('student', h.scope, h.candidate, 'key'));
});

test('multi-objective lessons require the explicit frozen target and never infer it from model domain', async () => {
  const h = fixture();
  h.lesson.objectiveIds.push('compare');
  assert.equal(await h.owner.scope('project', 'student', 11), undefined);
  assert.equal((await h.owner.propose('student', { ...h.scope, objectiveId: 'plan:compare' }, h.candidate, 'selected')).scope?.objectiveId, 'plan:compare');
  await assert.rejects(h.owner.propose('student', { ...h.scope, objectiveId: 'optics.wave.diffraction' }, h.candidate, 'domain-is-not-target'));
});

test('practice stage labels cannot substitute for current mastery owner evidence', async () => {
  const h = fixture(); h.revokeMastery();
  await assert.rejects(h.owner.propose('student', h.scope, h.candidate, 'key'));
  h.project.status = 'theory_learning';
  await assert.rejects(h.owner.propose('student', h.scope, h.candidate, 'key'));
});


test('later dynamic experiment actions refresh the frozen role permissions before acceptance and immediately before write', async () => {
  const h = fixture();
  const tool = builtinToolRegistry.listForAgentIds(['tutor.propose_lesson_activity'])[0]!;
  const skill = { id: 'pbl-dynamic-lesson', version: '1.0.0', contentHash: 'synthetic-skill-digest', runtime: 'teaching', publicationStatus: 'reviewed', status: 'ready' };
  const role = { roleSlotId: 'slot', assistantId: 'mentor', assistantConfigDigest: 'digest',
    instructions: { roleDefinition: 'Mentor', agentDefinition: 'Guide investigation' },
    modelByPurpose: { dialogue: { modelProviderId: 'provider', modelId: 'model' } },
    skills: [{ canonicalId: skill.id, version: skill.version, packageDigest: skill.contentHash }],
    tools: [{ toolId: tool.id, handlerVersion: tool.version, schemaDigest: teachingValueDigest(tool), mcpServerId: null }] };
  Object.assign(h.teaching, { roles: [role], sessionRoutes: [{ sessionIndex: 11, roleSlotId: 'slot' }] });
  let enabled = true; let revokeAtRead = 0; let reads = 0; let writes = 0;
  const registry = { isModelAvailable: () => true, getAssistantRuntime: async () => {
    reads++; if (reads === revokeAtRead) enabled = false;
    return { agent: { id: 'mentor', enabled: true, capabilities: ['teach'], skillIds: [skill.id] }, skills: [skill],
      tools: enabled ? [tool] : [], mcpServers: [], policy: {} } as unknown as EffectiveAgentRuntime;
  } };
  Object.assign(h.owner, { registry, idempotency: { execute: async (_scope: unknown, _key: unknown, _hash: unknown, work: () => unknown) => work() },
    audit: { write: async () => { writes++; return 'audit'; } } });
  const block = await h.owner.propose('student', h.scope, h.candidate, 'activity');
  const record = { ownerId: 'student', projectId: 'project', sessionId: 'chat', turns: [{ blocks: [block] }] } as unknown as TutorSessionRecord;
  const action = { action: 'submit_prediction' as const, payload: { mode: 'diffraction', hypothesis: 'The band widens' }, idempotencyKey: 'prediction' };
  assert.equal((await h.owner.submit('student', record, block.experimentId, action)).accepted, true);
  assert.equal(writes, 1);
  enabled = false;
  await assert.rejects(h.owner.submit('student', record, block.experimentId, { ...action, idempotencyKey: 'revoked' }));
  assert.equal(writes, 1);
  enabled = true; revokeAtRead = reads + 2;
  await assert.rejects(h.owner.submit('student', record, block.experimentId, { ...action, idempotencyKey: 'revoked-during-read' }));
  assert.equal(writes, 1);
});
