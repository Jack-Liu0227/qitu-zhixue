import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EffectiveAgentRuntime } from '../platform-registry/platform-registry.service';
import { buildActivityBoard, createLessonActivityChannel, LESSON_ACTIVITY_FUNCTION, LESSON_ACTIVITY_TOOL } from './tutor-lesson-activity';
import { teachingContextFixture } from './tutor-teaching-context.test-fixture';
import { resolveTutorTeachingContext } from './tutor-teaching-context';
import { GatewayTutorProvider } from './gateway-tutor.provider';
import type { TutorStreamEvent, TutorTurnInput } from './tutor.provider';
import { prepareTutorLessonActivities, verifyLessonEvidence } from './tutor-activity-context';
import type { ImaReadEvidence } from './ima-project-scope';
import { LESSON_ACTIVITY_SCHEMA } from '../../common/tutor-runtime/lesson-activity.schema';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';
import { freezeTutorRuntime } from './tutor-frozen-runtime';

const board = { kind: 'board', title: 'Compare predictions', steps: [{ caption: 'Which link needs evidence?',
  nodes: [{ id: 'slit', label: 'Slit width' }, { id: 'band', label: 'Central band' }], edges: [{ from: 'slit', to: 'band' }], tex: 'a = b' }] };
async function fixture() {
  const f = teachingContextFixture();
  const teaching = await resolveTutorTeachingContext(f.store, f.project, f.teaching);
  const runtime = { agent: { id: teaching.role.assistantId, enabled: true, capabilities: ['teach'], skillIds: ['pbl-dynamic-lesson'] }, mcpServers: [], skills: [{ id: 'pbl-dynamic-lesson', publicationStatus: 'reviewed' }],
    tools: [{ id: LESSON_ACTIVITY_TOOL, version: 'tutor.propose_lesson_activity.v1', inputSchemaDigest: teachingValueDigest(LESSON_ACTIVITY_SCHEMA) }] } as unknown as EffectiveAgentRuntime;
  const scope = { projectId: f.project.id, planId: teaching.planId, planRevision: teaching.planRevision,
    learningSessionId: teaching.session.id, objectiveId: teaching.objective!.id, tutorSessionId: 'synthetic-chat' };
  let questionWrites = 0;
  const input = { teaching, runtime, scope, idempotencyKey: 'synthetic-turn', refresh: async () => ({ teaching, runtime }),
    verifyEvidence: async () => [],
    acceptQuestion: async () => { questionWrites++; return { kind: 'quiz' as const, questionId: 'owner-question', stem: 'Which prediction fits?', options: [{ key: 'owner-a', text: 'One' }, { key: 'owner-b', text: 'Two' }] }; },
    proposeOptics: async () => { throw new Error('not used'); } };
  return { input, runtime, teaching, questionWrites: () => questionWrites };
}

test('activity tool requires reviewed skill plus canonical pinned tool; revoked or changed lesson rejects before owner writes', async () => {
  const h = await fixture();
  h.runtime.skills[0]!.publicationStatus = 'quarantined';
  assert.equal(createLessonActivityChannel(h.input).tools.length, 0);
  h.runtime.skills[0]!.publicationStatus = 'reviewed';
  const channel = createLessonActivityChannel(h.input);
  h.runtime.agent.enabled = false;
  await assert.rejects(channel.tools[0]!.execute(board));
  h.runtime.agent.enabled = true;
  h.input.refresh = async () => ({ runtime: h.runtime, teaching: { ...h.teaching, planRevision: h.teaching.planRevision + 1 } });
  await assert.rejects(channel.tools[0]!.execute(board));
  assert.equal(channel.blocks().length, 0);
  assert.equal(h.questionWrites(), 0);
  h.runtime.tools = [];
  assert.equal(createLessonActivityChannel(h.input).tools.length, 0);
});

test('model activity tool receives frozen guidance, activity minutes and required evidence', async () => {
  const h = await fixture();
  const description = createLessonActivityChannel(h.input).tools[0]!.description;
  assert.match(description, /FROZEN_LESSON_GUIDANCE_1/);
  assert.match(description, /FROZEN_LESSON_EVIDENCE_1/);
  assert.match(description, /"minutes":30/);
  assert.match(description, /"planRevision":7/);
});

test('board construction uses a closed graph/TeX shape and rejects executable or external content', () => {
  const block = buildActivityBoard(board, 'stable-board');
  assert.match(block.steps[0]!.mermaid!, /slit --> band/);
  for (const bad of [
    { ...board, html: '<script>run()</script>' },
    { ...board, steps: [{ caption: 'bad', tex: '\\href{https://example.invalid}{link}' }] },
    { ...board, steps: [{ caption: '<img src=x>', tex: 'x' }] },
    { ...board, steps: [{ caption: 'bad', nodes: [{ id: 'x; click x', label: 'x' }], edges: [] }] },
    { ...board, steps: [{ caption: 'bad', nodes: [{ id: 'x', label: 'x' }], edges: [{ from: 'x', to: 'missing' }] }] },
  ]) assert.throws(() => buildActivityBoard(bad, 'stable-board'));
});

test('concurrent duplicate candidates reuse one accepted owner instance; another activity cannot replace it', async () => {
  const h = await fixture(); const channel = createLessonActivityChannel(h.input);
  const question = { kind: 'choice_question', question: { prompt: 'private', options: [{ text: 'A' }, { text: 'B' }],
    correctOptionIndex: 1, explanation: 'PRIVATE_KEY', difficulty: 'easy', sourceRefs: ['verified-source'] } };
  const answers = await Promise.all([channel.tools[0]!.execute(question), channel.tools[0]!.execute(question)]);
  assert.equal(h.questionWrites(), 1);
  assert.equal(channel.blocks().length, 1);
  assert.equal(channel.suppressNarration(), true);
  assert.doesNotMatch(JSON.stringify(answers), /PRIVATE_KEY/);
  await assert.rejects(channel.tools[0]!.execute(board));
});

const turn: TutorTurnInput = { projectId: 'synthetic-project', sessionId: 'synthetic-chat', projectTitle: 'Investigation',
  projectStage: 'theory_learning', currentTaskTitle: 'Compare', content: 'I think the width matters', previousHintLevel: null, turnCount: 0 };
async function drain(provider: GatewayTutorProvider, input: TutorTurnInput) {
  const events: TutorStreamEvent[] = []; for await (const event of provider.generateTurn(input)) events.push(event); return events;
}
function modelResult(text: string) { return { providerId: 'fixture', modelId: 'fixture', api: 'openai-completions' as const,
  text, finishReason: 'stop' as const, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }; }

test('gateway exposes the authorized candidate tool and emits its structured board only when the agent chooses it', async () => {
  const h = await fixture(); const channel = createLessonActivityChannel(h.input);
  const gateway = new GatewayTutorProvider({ complete: async (_usage, request) => {
    assert.equal(request.tools?.[0]?.name, LESSON_ACTIVITY_FUNCTION);
    await request.tools![0]!.execute(board);
    return modelResult('Which relationship would you test?');
  } });
  const events = await drain(gateway, { ...turn, lessonActivities: channel });
  assert.equal(events.filter((event) => event.type === 'block' && event.block.kind === 'board').length, 1);
  const idle = createLessonActivityChannel((await fixture()).input);
  await drain(new GatewayTutorProvider({ complete: async () => modelResult('What do you predict?') }), { ...turn, content: 'experiment optics', lessonActivities: idle });
  assert.deepEqual(idle.blocks(), []);
});

test('accepted quiz suppresses model answer text; accepted owner block survives later model failure', async () => {
  for (const fail of [false, true]) {
    const h = await fixture(); const channel = createLessonActivityChannel(h.input);
    const provider = new GatewayTutorProvider({ complete: async (_usage, request) => {
      await request.tools![0]!.execute({ kind: 'choice_question', question: {} });
      if (fail) throw new Error('private provider body');
      return modelResult('PRIVATE_ANSWER_KEY and complete solution');
    } });
    const events = await drain(provider, { ...turn, lessonActivities: channel });
    assert.equal(events.filter((event) => event.type === 'block' && event.block.kind === 'quiz').length, 1);
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE_ANSWER_KEY|private provider body/);
  }
});

test('question source verification requires this turn actual read, frozen/current grant intersection and unexpired metadata', async () => {
  const evidence: ImaReadEvidence = { sourceRef: 'source-1', knowledgeBaseId: 'kb-1', documentRefHash: 'a'.repeat(64), expiresAt: 2000 };
  let permitted = true; let current = ['kb-1'];
  const access = { authorize: async () => permitted, readEvidence: new Map([[evidence.sourceRef, evidence]]),
    scope: { projectId: 'project', studentId: 'student', knowledgeBaseIds: ['kb-1'], toolPins: [], refreshAllowedKnowledgeBaseIds: async () => current } };
  assert.deepEqual(await verifyLessonEvidence(access, ['source-1'], 1000), [evidence]);
  await assert.rejects(verifyLessonEvidence(access, ['model-asserted-source'], 1000));
  await assert.rejects(verifyLessonEvidence(access, ['source-1'], 2000));
  current = []; await assert.rejects(verifyLessonEvidence(access, ['source-1'], 1000));
  current = ['kb-1']; permitted = false; await assert.rejects(verifyLessonEvidence(access, ['source-1'], 1000));
});


test('recovered pending question is publicly restored without replacement; help can still propose a board', async () => {
  const h = await fixture();
  const pending = { kind: 'quiz' as const, questionId: 'existing-owner-question', stem: 'Existing question', options: [{ key: 'stable-a', text: 'A' }] };
  const channel = createLessonActivityChannel({ ...h.input, pendingQuestion: pending, restorePending: true });
  assert.deepEqual(channel.blocks(), [pending]);
  await assert.rejects(channel.tools[0]!.execute({ kind: 'choice_question', question: {} }));
  await channel.tools[0]!.execute(board);
  assert.equal(h.questionWrites(), 0);
  assert.equal(channel.blocks()[0], pending);
  assert.equal(channel.blocks()[1]?.kind, 'board');
});


test('actual candidate schema digest participates in frozen tool pins and detects drift without widening permissions', async () => {
  const h = await fixture();
  const tool = h.runtime.tools[0]!;
  const role = { ...h.teaching.role, skills: [], tools: [{ toolId: LESSON_ACTIVITY_TOOL, mcpServerId: null,
    handlerVersion: tool.version, schemaDigest: teachingValueDigest(tool) }] };
  assert.equal(freezeTutorRuntime(h.runtime, role, true).tools.length, 1);
  const drifted = { ...h.runtime, tools: [{ ...tool, inputSchemaDigest: teachingValueDigest({ arbitraryHtml: true }) }] };
  assert.equal(freezeTutorRuntime(drifted, role, true).tools.length, 0);
  assert.equal(createLessonActivityChannel({ ...h.input, runtime: drifted }).tools.length, 0);
});

test('an observation objective can guide a turn without entering the assessment owner scope', async () => {
  const h = await fixture();
  h.teaching.session.theoryObjectiveIds = [];
  h.teaching.session.practiceObjectiveIds = [];
  const channel = await prepareTutorLessonActivities({ teaching: h.teaching, runtime: h.runtime,
    projectId: 'synthetic-project', studentId: 'synthetic-owner', tutorSessionId: 'synthetic-chat', idempotencyKey: 'observation',
    knowledgeAccess: {}, registry: { getAssistantRuntime: async () => h.runtime, isModelAvailable: () => true },
    questions: { readPendingQuestionCandidate: async () => { throw Error('observation is not an assessment target'); },
      acceptQuestionCandidate: async () => { throw Error('no assessment submitted'); } },
    resolve: async () => h.teaching, hasQuestion: () => false });
  assert.ok(channel);
});

