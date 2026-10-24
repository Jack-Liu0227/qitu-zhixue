import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { pblTemplateTeamBindings } from '@qitu/database';
import type { AdminTeamConfig } from '@qitu/contracts';
import type { LearningPlanStore, LearningProjectRecord } from '../learning-plan/learning-plan.store';
import type { TemplateBindingService } from '../templates/templates-binding.service';
import { sanitizeTeamClientContext } from '../team-runtime/team-runtime.service';
import type { StartTeamRunInput, TeamRuntimeService } from '../team-runtime/team-runtime.service';
import type { ModelCompletionRequest, ModelRuntimeModelSelection } from '../model-registry/model-gateway.types';
import { assistantRuntimeFixture } from '../platform-registry/assistant-runtime.test-fixture';
import { ImaSettingsService } from '../platform-registry/ima-settings.service';
import { QituSDKFactory } from '../qitu-sdk/qitu-sdk.service';
import { TutorService } from './tutor.service';
import { teachingContextFixture } from './tutor-teaching-context.test-fixture';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';

function fixture(frozen = false) {
  const h = assistantRuntimeFixture();
  // A tempting old default exists, but it must not supply this phase's identity.
  h.configs.push(h.runtimeConfig('qitu-learning-partner'));
  const project: LearningProjectRecord = {
    id: 'synthetic-project', studentId: 'synthetic-owner', templateVersionId: 'synthetic-template-version',
    title: 'No role can be guessed from this title', subtitle: null, status: 'theory_learning',
    currentStageIndex: 2, stageTotal: 10, progressPercent: 20, tags: [], createdAt: new Date(), completedAt: null,
  };
  const phases: Array<NonNullable<AdminTeamConfig['pblSpec']>['phases'][number]> = [{
    phase: 'concept_mastery', title: 'Synthetic concept phase', assignedAssistantId: h.assistant.id,
    assignedRoleLabel: 'Synthetic concept role', gateCondition: 'TheoryMastered', learningObjectives: [],
  }];
  const team: import('../templates/templates-binding.types').TeamVersionRecord = {
    id: 'synthetic-team-version', teamId: 'synthetic-team', version: 1, name: 'Frozen actual team', description: '',
    workspaceMode: 'shared', sessionMode: 'supervised', leaderAssistantId: h.assistant.id,
    members: [{ assistantId: h.assistant.id, role: 'coach', roleLabel: 'Actual phase coach', pblPhase: 'concept_mastery' }],
    pblSpec: { phases }, enabled: true, createdBy: null, createdAt: new Date(),
  };
  h.extraRows.set(pblTemplateTeamBindings, [{ id: 'synthetic-binding', teamSnapshots: { [team.id]: { ...team, createdAt: team.createdAt.toISOString() } } }]);
  const teaching = teachingContextFixture(h.assistant.id);
  const store = {
    ...(frozen ? teaching.store : {}),
    findProject: async () => project, listProjectsByStudent: async () => [project], listPlansByStudent: async () => [],
  } as unknown as LearningPlanStore;
  if (frozen) store.listPlansByStudent = teaching.store.listPlansByStudent;
  const binding = { findFrozenSnapshotForProject: async () => ({
    projectId: project.id,
    templateVersionId: project.templateVersionId,
    bindingId: 'synthetic-binding',
    teamVersionId: team.id,
    bindingHash: 'synthetic-binding-hash',
    bundleDigest: frozen ? 'synthetic-bundle-digest' : null,
    boundAt: new Date().toISOString(),
    backfilled: false,
  }), getFrozenTeachingBundle: async () => teaching.teaching } as unknown as TemplateBindingService;
  const traces: Array<Parameters<TeamRuntimeService['recordEvent']>[0]> = [];
  const delegations: Array<Parameters<TeamRuntimeService['delegateIfAvailable']>[2]> = [];
  let starts = 0;
  const runtime = {
    startRun: async (input: StartTeamRunInput) => {
      sanitizeTeamClientContext(input.context);
      starts += 1;
      return { id: 'synthetic-run', leaderAgentId: teaching.teaching.teamVersion.leaderAssistantId };
    },
    recordEvent: async (input: Parameters<TeamRuntimeService['recordEvent']>[0]) => { traces.push(input); },
    delegateIfAvailable: async (_actor: unknown, _runId: string, input: Parameters<TeamRuntimeService['delegateIfAvailable']>[2]) => {
      delegations.push(input);
      return null;
    },
  } as unknown as TeamRuntimeService;
  const calls: Array<{ usage: string; request: ModelCompletionRequest; selection?: ModelRuntimeModelSelection }> = [];
  const gateway = { complete: async (usage: string, request: ModelCompletionRequest, selection?: ModelRuntimeModelSelection) => {
    calls.push({ usage, request, selection });
    return { providerId: 'chosen-provider', modelId: 'same-model-name', api: 'openai-completions' as const,
      text: 'What evidence would distinguish those predictions?', finishReason: 'stop' as const,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  } };
  const sdk = new QituSDKFactory({
    forActor: () => ({ getCurrent: async () => [], snapshot: async () => ({}) }),
    reassessProjectEvidence: async () => undefined,
  } as never, {} as never, {} as never, {
    resolvePurposeByModel: async (selection: { providerId: string; modelId: string }) => ({
      usageId: 'agent.model', available: selection.providerId === 'chosen-provider', input: ['text'], output: ['text'], modelId: selection.modelId,
    }),
  } as never, h.service, 'live');
  const tutor = new TutorService('live', gateway, undefined, undefined, undefined, undefined, undefined,
    undefined, sdk, undefined, h.service, runtime, store, undefined, new ImaSettingsService(h.db, {} as never),
    undefined, undefined, h.db, binding);
  const session = tutor.getOrCreateSession(project.id, project.studentId);
  // This isolated fixture starts empty, not with the demo plant transcript.
  session.turns = [];
  session.lastSeq = 0;
  session.lastHintLevel = null;
  const run = async (key = 'synthetic-turn') => {
    for await (const _event of tutor.runTurn(session, { content: 'Compare predictions', idempotencyKey: key, actorId: project.studentId })) { /* drain */ }
  };
  return { ...h, tutor, session, run, calls, traces, delegations, phases, team, teaching, starts: () => starts };
}

test('frozen phase identity drives real Tutor + SDK + gateway model, prompt, skills, tools, author and trace', async () => {
  const h = fixture();
  // Make the team leader distinct from the lesson member so this assertion
  // proves the project turn is delegated to the configured team member.
  h.teaching.teaching.teamVersion.leaderAssistantId = 'qitu-intake-assistant';
  // Disable the unrelated default to prove SDK no longer re-enters its route.
  h.configs[0]!.enabled = false;
  await h.run();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0]?.usage, 'agent.model');
  assert.deepEqual(h.calls[0]?.selection, { providerId: 'chosen-provider', modelId: 'same-model-name' });
  const prompt = h.calls[0]?.request.messages[0]?.content;
  assert.equal(typeof prompt, 'string');
  assert.match(String(prompt), /SYNTHETIC_ACTUAL_MENTOR_INSTRUCTION/);
  assert.match(String(prompt), /tutor-guided-learning/);
  assert.match(String(prompt), /tutor.context_packet/);
  assert.doesNotMatch(String(prompt), /UNRELATED_RUNTIME/);
  assert.equal(h.session.turns.find((turn) => turn.role === 'assistant')?.author?.id, h.assistant.id);
  assert.equal(h.session.turns.find((turn) => turn.role === 'assistant')?.author?.name, h.assistant.name);
  assert.equal(h.traces[0]?.payload?.assistantId, h.assistant.id);
  assert.equal(h.traces[0]?.payload?.modelProviderId, 'chosen-provider');
  assert.deepEqual(h.traces[0]?.payload?.skillIds, ['tutor-guided-learning']);
  assert.deepEqual(h.traces[0]?.payload?.toolIds, ['tutor.context_packet']);
  assert.deepEqual(h.delegations.map((entry) => ({
    senderAgentId: entry.senderAgentId,
    recipientAgentId: entry.recipientAgentId,
    taskType: entry.taskType,
  })), [{
    senderAgentId: 'qitu-intake-assistant',
    recipientAgentId: h.assistant.id,
    taskType: 'pbl.plan',
  }]);
  const lastSeq = h.session.lastSeq;
  await h.run();
  assert.equal(h.calls.length, 1, 'idempotent replay cannot invoke another assistant/model');
  assert.equal(h.session.lastSeq, lastSeq);
});

test('recommended exploration uses the exact published team leader for shell, SDK, model and author without creating a project', async () => {
  const h = fixture(true);
  const exploration = { id: 'opaque-exploration', templateVersionId: 'opaque-template-version', source: 'recommended' };
  h.session.projectId = null;
  h.session.explorationId = exploration.id;
  h.teaching.teaching.teamVersion.teamVersionId = h.team.id;
  Object.assign(h.tutor, {
    projects: { getExploration: async (owner: string, id: string) => {
      assert.equal(owner, 'synthetic-owner'); assert.equal(id, exploration.id); return exploration;
    } },
    templateBindings: { getExplorationBinding: async (owner: string, id: string) => {
      assert.equal(owner, 'synthetic-owner'); assert.equal(id, exploration.templateVersionId);
      return { title: 'Actual chosen course', content: {}, binding: { teamVersionId: h.team.id }, bundle: h.teaching.teaching };
    } },
  });
  const context = await h.tutor.getExplorationProjectContext(exploration.id, 'synthetic-owner');
  assert.equal(context.project, null);
  assert.equal(context.exploration?.handoff, 'ready');
  assert.equal(context.team?.assistantId, h.assistant.id);
  await h.run('recommended-turn');
  const dialogue = h.calls.filter(call => call.usage === 'agent.model');
  assert.equal(dialogue.length, 1);
  assert.deepEqual(dialogue[0]?.selection, { providerId: 'chosen-provider', modelId: 'same-model-name' });
  assert.match(String(dialogue[0]?.request.messages[0]?.content), /FROZEN_TEACHING_INSTRUCTION/);
  assert.equal(h.session.turns.find(turn => turn.role === 'assistant')?.author?.id, context.team?.assistantId);
  assert.equal(h.session.projectId, null);
  assert.equal(dialogue[0]?.request.tools, undefined, 'project knowledge is not granted by template preview');
  h.assistant.enabled = false;
  await assert.rejects(h.run('recommended-revoked'), ConflictException);
  assert.equal(h.calls.filter(call => call.usage === 'agent.model').length, 1);
});

test('missing phase or assigned non-member refuses the turn before any model or runtime task', async () => {
  for (const mode of ['phase', 'member'] as const) {
    const h = fixture();
    if (mode === 'phase') h.phases.splice(0);
    else h.phases[0]!.assignedAssistantId = 'not-a-team-member';
    await assert.rejects(h.run(), (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal((error.getResponse() as { code: string }).code, 'PROJECT_PHASE_ASSISTANT_UNAVAILABLE');
      return true;
    });
    assert.equal(h.calls.length, 0);
    assert.equal(h.starts(), 0);
    assert.equal(h.session.turns.length, 0);
  }
});

test('current assistant revocation blocks new turns rather than choosing intake or global partner', async () => {
  for (const frozen of [false, true]) {
    const h = fixture(frozen);
    await h.run();
    h.assistant.enabled = false;
    await assert.rejects(h.run('after-revocation'), ConflictException);
    assert.equal(h.calls.length, 1);
    assert.equal(h.starts(), 1);
  }
});

test('bundle route shares actual pending lesson with shell and pins instructions/model after Admin edits', async () => {
  const h = fixture(true);
  h.teaching.completed.add('plan-frozen:lesson-1');
  h.teaching.setPending(2);
  h.phases[0]!.assignedAssistantId = 'obsolete-stage-mentor';
  h.assistant.instructions = 'CHANGED_ADMIN_PROMPT_MUST_NOT_REPLACE_FROZEN';
  h.assistant.modelProviderId = 'other-provider';
  const context = await h.tutor.getProjectContext('synthetic-project', 'synthetic-owner');
  assert.equal(context?.lesson?.learningSessionId, 'plan-frozen:lesson-2');
  assert.equal(context?.lesson?.planRevision, 7);
  assert.equal(context?.currentTask?.id, 'plan-frozen:objective-2');
  assert.equal(context?.team?.assistantId, h.assistant.id);
  await h.run();
  assert.deepEqual(h.calls[0]?.selection, { providerId: 'chosen-provider', modelId: 'same-model-name' });
  assert.match(String(h.calls[0]?.request.messages[0]?.content), /FROZEN_TEACHING_INSTRUCTION/);
  assert.doesNotMatch(String(h.calls[0]?.request.messages[0]?.content), /CHANGED_ADMIN_PROMPT_MUST_NOT_REPLACE_FROZEN/);
  assert.equal(h.traces[0]?.payload?.learningSessionId, context?.lesson?.learningSessionId);
  assert.equal(h.traces[0]?.payload?.planRevision, 7);
  assert.equal(h.session.turns.find((turn) => turn.role === 'assistant')?.author?.id, context?.team?.assistantId);
  assert.ok(h.session.turns.some((turn) => turn.blocks.some((block) => block.kind === 'text' && block.text.includes('资料尚未核验'))));
  assert.equal(h.calls[0]?.request.tools, undefined, 'unscoped knowledge tools are not executable');
});

test('frozen skill/tool ceilings survive additions while current revocation removes access', async () => {
  const h = fixture(true);
  const runtime = await h.service.getAssistantRuntime(h.assistant.id);
  const role = h.teaching.teaching.roles[0]!;
  role.skills = runtime.skills.map((skill) => ({ canonicalId: skill.id, version: skill.version!, packageDigest: skill.contentHash }));
  role.tools = runtime.tools.map((tool) => ({ toolId: tool.id, handlerVersion: tool.version, schemaDigest: teachingValueDigest(tool), mcpServerId: null }));
  await h.run();
  assert.deepEqual(h.traces[0]?.payload?.skillIds, ['tutor-guided-learning']);
  assert.deepEqual(h.traces[0]?.payload?.toolIds, ['tutor.context_packet']);
  h.assistant.enabledSkills = [];
  h.assistant.toolIds = [];
  await h.run('capabilities-revoked');
  assert.deepEqual(h.traces[1]?.payload?.skillIds, []);
  assert.deepEqual(h.traces[1]?.payload?.toolIds, []);
});

test('actual SDK model request contains the complete current frozen lesson program and changes with the lesson', async () => {
  const h = fixture(true);
  await h.run('lesson-1-program');
  const first = String(h.calls[0]?.request.messages[0]?.content);
  assert.match(first, /FROZEN_LESSON_GUIDANCE_1/);
  assert.match(first, /FROZEN_LESSON_EVIDENCE_1/);
  assert.match(first, /"minutes":30/);
  assert.match(first, /"planRevision":7/);
  h.teaching.completed.add('plan-frozen:lesson-1');
  await h.run('lesson-2-program');
  const next = String(h.calls[1]?.request.messages[0]?.content);
  assert.match(next, /FROZEN_LESSON_GUIDANCE_2/);
  assert.match(next, /FROZEN_LESSON_EVIDENCE_2/);
  assert.match(next, /plan-frozen:lesson-2/);
});

test('frozen skill mismatch, model revocation and missing bundle refuse requests before model invocation', async () => {
  for (const mode of ['skill', 'model', 'bundle'] as const) {
    const h = fixture(true);
    if (mode === 'skill') h.teaching.teaching.roles[0]!.skills = [{ canonicalId: 'tutor-guided-learning', version: 'stale', packageDigest: 'stale' }];
    if (mode === 'model') h.teaching.teaching.roles[0]!.modelByPurpose = { dialogue: { modelProviderId: 'revoked-provider', modelId: 'same-model-name', policyVersion: '1' } };
    if (mode === 'bundle') h.teaching.teaching.templateVersionId = 'other-template-version';
    await assert.rejects(h.run(), ConflictException);
    assert.equal(h.calls.length, 0);
    assert.equal(h.starts(), 0);
  }
});
