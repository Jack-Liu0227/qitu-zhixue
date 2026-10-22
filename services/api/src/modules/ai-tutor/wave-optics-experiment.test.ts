import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GetTutorSessionResponse } from '@qitu/contracts';
import { WAVE_OPTICS_TEMPLATE_SPEC, WAVE_OPTICS_READINESS_IDS } from '@qitu/ai-client/quiz-bank';
import type { AuditWriter } from '../../common/audit';
import type { IdempotencyStore } from '../../common/idempotency';
import type { LearningPlanStore } from '../learning-plan/learning-plan.store';
import type { LearningSessionProgressService } from '../learning-plan/learning-session-progress.service';
import type { MasteryDomainService } from '../mastery/mastery-domain.service';
import { builtinToolRegistry } from '../platform-registry/built-in-tools';
import type { EffectiveAgentRuntime, PlatformRegistryService } from '../platform-registry/platform-registry.service';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import { FakeAuditWriter, FakeIdempotencyStore } from '../templates/templates.test-support';
import { ProjectEvidenceMaterializer } from '../works/project-evidence.service';
import { InMemoryProjectEvidenceStore, EmptyProjectEvidenceSource } from '../works/project-evidence.store';
import { TutorExperimentService } from './tutor-experiment.service';
import type { TutorSessionRecord } from './tutor.service';

function fixture() {
  const template = structuredClone(WAVE_OPTICS_TEMPLATE_SPEC);
  const profile = template.curriculum?.profiles[0]; assert.ok(profile);
  const lesson = profile.sessions[2]; assert.ok(lesson?.leadAssistantId);
  const project = { id: 'wave-project', studentId: 'wave-student', templateVersionId: 'wave-template', status: 'practice_ready' };
  const plan = { id: 'wave-plan', projectId: project.id, studentUserId: project.studentId, templateVersion: project.templateVersionId, version: 1 };
  const sessions = profile.sessions.map(lesson => ({ id: `${plan.id}:${lesson.id}`, index: lesson.sessionIndex - 1,
    lessonIndex: lesson.sessionIndex, theoryObjectiveIds: [...WAVE_OPTICS_READINESS_IDS].map(id => `${plan.id}:${id}`) }));
  const session = sessions[2]; assert.ok(session);
  const activityId = `${session.id}:activity:practice`;
  const scope = { projectId: project.id, planId: plan.id, planRevision: 1, learningSessionId: session.id,
    objectiveId: `${plan.id}:wave-double-paths`, tutorSessionId: 'wave-chat', activityId };
  const store = { findProject: async () => project, listPlansByStudent: async () => [plan], findBundle: async () => ({ plan, sessions }),
    listSessionCompletions: async () => sessions.slice(0, 2).map(entry => ({ learningSessionId: entry.id })) } as unknown as LearningPlanStore;
  const tools = builtinToolRegistry.listForAgentIds(['tutor.propose_lesson_activity', 'tutor.propose_wave_activity']);
  const pin = { canonicalId: 'pbl-dynamic-lesson', version: '1.0.0', packageDigest: 'a'.repeat(64) };
  const role = { roleSlotId: 'concept', memberId: 'concept-member', assistantId: lesson.leadAssistantId, assistantConfigDigest: 'b'.repeat(64),
    instructions: { roleDefinition: 'Synthetic concept coach', agentDefinition: 'Use bounded candidates.' },
    skills: [pin], tools: tools.map(tool => ({ toolId: tool.id, schemaDigest: teachingValueDigest(tool), handlerVersion: tool.version, mcpServerId: null })),
    modelByPurpose: { dialogue: { modelProviderId: 'fixture', modelId: 'fixture', policyVersion: 'fixture-v1' } } };
  const teaching = { templateVersionId: project.templateVersionId, template, scheduleProfileId: profile.id,
    roles: [role], sessionRoutes: [{ sessionIndex: lesson.sessionIndex, roleSlotId: role.roleSlotId }] };
  const bindings = { getFrozenTeachingBundle: async () => teaching } as unknown as TemplateBindingService;
  const runtime = { agent: { id: lesson.leadAssistantId, enabled: true, capabilities: ['teach'], skillIds: [pin.canonicalId] }, tools,
    skills: [{ id: pin.canonicalId, version: pin.version, contentHash: pin.packageDigest, status: 'ready', publicationStatus: 'published' }],
    mcpServers: [] } as unknown as EffectiveAgentRuntime;
  const registry = { getAssistantRuntime: async () => runtime, isModelAvailable: () => true } as unknown as PlatformRegistryService;
  let mastered = true;
  const mastery = { checkRequiredObjectives: async (_actor: unknown, student: string, id: string, objectives: string[]) => {
    assert.equal(student, project.studentId); assert.equal(id, plan.id); assert.deepEqual(objectives, session.theoryObjectiveIds); return mastered;
  } } as unknown as MasteryDomainService;
  let active = true;
  const progress = { readProgress: async () => ({ currentSessionId: session.id, sessions: [{ sessionId: session.id,
    activities: [{ activityId, kind: active ? 'practice' : 'reflect', status: 'current' }] }] }) } as unknown as LearningSessionProgressService;
  const audit = new FakeAuditWriter();
  const evidenceStore = new InMemoryProjectEvidenceStore();
  const evidence = new ProjectEvidenceMaterializer(evidenceStore, new EmptyProjectEvidenceSource());
  const owner = new TutorExperimentService(store, bindings, evidence, new FakeIdempotencyStore() as unknown as IdempotencyStore,
    audit as unknown as AuditWriter, null, mastery, registry, progress);
  const candidate = { mode: 'interference' as const, title: '双缝比较', summary: '预测后保存模拟观察',
    parameters: { wavelength: 550, slitWidth: 20, slitSeparation: 150, screenDistance: 2 } };
  return { owner, candidate, project, plan, scope, runtime, evidenceStore, revokeMastery: () => { mastered = false; },
    endPractice: () => { active = false; } };
}

test('v2 owner persists prediction/run/observation idempotently and restores scoped physical results without granting mastery', async () => {
  const h = fixture();
  const block = await h.owner.propose('wave-student', h.scope, h.candidate, 'activity');
  assert.equal(block.specVersion, '2.0.0'); assert.equal(block.scope?.activityId, h.scope.activityId);
  const record = { ownerId: 'wave-student', projectId: h.project.id, sessionId: h.scope.tutorSessionId, turns: [{ blocks: [block] }] } as unknown as TutorSessionRecord;
  const call = (action: 'submit_prediction' | 'run' | 'record_observation', payload: unknown, key: string) =>
    h.owner.submit('wave-student', record, block.experimentId, { action, payload, idempotencyKey: key });
  await assert.rejects(call('run', { mode: 'interference', parameters: h.candidate.parameters }, 'run-before-prediction'));
  await call('submit_prediction', { mode: 'interference', hypothesis: '改变缝间距后比较条纹间距。' }, 'prediction');
  const run = await call('run', { mode: 'interference', parameters: h.candidate.parameters }, 'run');
  assert.equal(run.simulationResult?.waveProjection?.mode, 'interference');
  const input = { mode: 'interference', parameters: h.candidate.parameters, runActionId: run.actionId, observation: '保留固定参数，记录图样作为模拟观察。' };
  const saved = await call('record_observation', input, 'observation');
  const replay = await call('record_observation', input, 'observation');
  assert.deepEqual(replay, saved);
  assert.equal(saved.observationReceipt?.activityId, h.scope.activityId);
  assert.equal((await h.evidenceStore.listByProject(h.project.id)).filter(item => item.sourceKind === 'experiment_observation').length, 1);
  const response = { turns: [{ blocks: [block] }] } as unknown as GetTutorSessionResponse;
  const restored = await h.owner.restore(record, response);
  const restoredBlock = restored.turns[0]?.blocks[0]; assert.ok(restoredBlock?.kind === 'optics_experiment');
  assert.equal(restoredBlock.savedExperiment?.predictionSubmitted, true);
  assert.equal(restoredBlock.savedExperiment?.runs[0]?.actionId, run.actionId);
  assert.deepEqual(restoredBlock.savedExperiment?.runs[0]?.projection, run.simulationResult?.waveProjection);
  assert.equal(h.project.status, 'practice_ready');
  await assert.rejects(call('record_observation', { ...input, parameters: { ...h.candidate.parameters, slitSeparation: 160 } }, 'wrong-run'));
  h.endPractice();
  await assert.rejects(call('run', { mode: 'interference', parameters: h.candidate.parameters }, 'late-run'));
});

test('new model requires exact project/lesson/activity and live tool/mastery grants', async () => {
  const h = fixture();
  await assert.rejects(h.owner.propose('other-student', h.scope, h.candidate, 'other'));
  await assert.rejects(h.owner.propose('wave-student', { ...h.scope, planRevision: 2 }, h.candidate, 'stale'));
  await assert.rejects(h.owner.propose('wave-student', { ...h.scope, activityId: 'different-activity' }, h.candidate, 'wrong-activity'));
  await assert.rejects(h.owner.propose('wave-student', h.scope, { ...h.candidate, mode: 'diffraction' }, 'wrong-model'));
  h.runtime.tools = h.runtime.tools.filter(tool => tool.id !== 'tutor.propose_wave_activity');
  await assert.rejects(h.owner.propose('wave-student', h.scope, h.candidate, 'revoked'));
  const another = fixture(); another.revokeMastery();
  await assert.rejects(another.owner.propose('wave-student', another.scope, another.candidate, 'mastery-required'));
});
