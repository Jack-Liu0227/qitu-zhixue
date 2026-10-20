import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const cache = new Map();
// Compile this small browser-data boundary in memory; no server or credential required.
function loadModule(relative) {
  const path = resolve(root, relative);
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  cache.set(path, exports);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', code)((name) => {
    if (!name.startsWith('.')) throw new Error(`Unexpected runtime dependency: ${name}`);
    return loadModule(resolve(path, '..', name) + '.ts');
  }, exports);
  return exports;
}

test('owned tutor uses real session API and never stores conversations or calls an upstream from the browser', () => {
  const page = readFileSync(resolve(root, 'apps/student-center/features/tutor/TutorPage.tsx'), 'utf8');
  assert.match(page, /session\.submitText/);
  assert.match(page, /session\.turns/);
  assert.match(page, /session\.sessionError/);
  for (const forbidden of ['generateFallbackPblReply', 'KINETIC_ENERGY_TURNS', 'localStorage.setItem', 'chat/completions', 'setInterval', 'kind: \'think\'']) assert.equal(page.includes(forbidden), false, forbidden);
});

test('session load preserves exploration identity; confirmation can retry after a lost response', async () => {
  const { TutorApiDataSource } = loadModule('apps/student-center/features/tutor/data/tutorApiDataSource.ts');
  const original = globalThis.fetch;
  const calls = [];
  let confirmed = false;
  let failConfirmation = true;
  const session = { sessionId: 'session-owned', explorationId: 'exploration-owned', projectId: null, turns: [], lastSeq: 0 };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/tutor/session?')) return Response.json({ data: session });
    if (url.endsWith('/confirm-intent')) {
      confirmed = true;
      if (failConfirmation) { failConfirmation = false; throw new TypeError('connection lost'); }
      return Response.json({ data: { project: { id: 'project-owned' }, replayed: true } });
    }
    return Response.json({ data: { id: 'exploration-owned', status: confirmed ? 'confirmed' : 'exploring' } });
  };
  try {
    const source = new TutorApiDataSource();
    await source.createSession({ source: 'exploration', explorationId: 'exploration-owned', idempotencyKey: 'create-key' });
    assert.equal(calls.some((call) => call.url === '/api/v1/explorations'), false);
    const loaded = await source.getSession('session-owned');
    assert.equal(loaded.explorationId, 'exploration-owned');
    await assert.rejects(source.confirmExploration('exploration-owned', { goal: 'synthetic goal', interest: 'motion' }, 'confirm-key'));
    const result = await source.confirmExploration('exploration-owned', { goal: 'synthetic goal', interest: 'motion' }, 'confirm-key');
    assert.equal(result.project.id, 'project-owned');
    assert.equal(calls.filter((call) => call.init.method === 'PATCH').length, 1);
    assert.deepEqual(JSON.parse(calls.find((call) => call.init.method === 'PATCH').init.body), { goalUser: 'synthetic goal', coreInterests: ['motion'] });
    assert.deepEqual(calls.filter((call) => call.url.endsWith('/confirm-intent')).map((call) => call.init.headers['idempotency-key']), ['confirm-key', 'confirm-key']);
    assert.ok(calls.every((call) => call.init.credentials === 'same-origin'));
  } finally { globalThis.fetch = original; }
});

test('intent confirmation rejects overlong fields before any network write', async () => {
  const { TutorApiDataSource } = loadModule('apps/student-center/features/tutor/data/tutorApiDataSource.ts');
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('unexpected network write'); };
  try {
    const source = new TutorApiDataSource();
    for (const draft of [{ goal: 'a'.repeat(121), interest: 'motion' }, { goal: 'goal', interest: 'a'.repeat(25) }, { goal: '', interest: 'motion' }]) {
      await assert.rejects(source.confirmExploration('owned', draft, 'key'), (error) => error.code === 'INTENT_DRAFT_INCOMPLETE');
    }
  } finally { globalThis.fetch = original; }
});

test('completed hint replaces identical streamed text but preserves distinct context and tools', () => {
  const { applyServerEventToTurns } = loadModule('apps/student-center/features/tutor/state.ts');
  const turn = { turnId: 'reply', role: 'assistant', blocks: [{ kind: 'text', text: 'context' }, { kind: 'text', text: 'one question?' }, { kind: 'tool', call: { callId: 'tool' } }] };
  const [updated] = applyServerEventToTurns([turn], { type: 'tutor.block', turnId: 'reply', seq: 2, block: { kind: 'hint', level: 1, text: 'one question?' } });
  assert.deepEqual(updated.blocks.map((block) => block.kind), ['text', 'tool', 'hint']);
  assert.equal(updated.blocks[0].text, 'context');
});

test('authorization failures stay explicit and do not fabricate successful replies', async () => {
  const { TutorApiDataSource } = loadModule('apps/student-center/features/tutor/data/tutorApiDataSource.ts');
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 'FORBIDDEN', detail: 'Not your session' }, { status: 403 });
  try { await assert.rejects(new TutorApiDataSource().createSession({ source: 'exploration', explorationId: 'other', idempotencyKey: 'key' }), (error) => error.status === 403 && error.code === 'FORBIDDEN'); }
  finally { globalThis.fetch = original; }
});

test('student tutor optics flow keeps exploration, frozen project, lessons, team, quiz and experiment boundaries', async () => {
  const { TutorApiDataSource } = loadModule('apps/student-center/features/tutor/data/tutorApiDataSource.ts');
  const original = globalThis.fetch;
  const requests = [];
  let explorationStatus = 'awaiting_confirmation';
  let theoryMastered = false;
  let quizAttempts = 0;
  const frozen = {
    templateVersionId: 'optics-physical-inquiry:v1.16',
    bindingId: 'binding-optics-v1',
    teamVersionId: 'team-optics-v3',
    bindingHash: 'sha256:binding-optics',
    bundleDigest: 'sha256:bundle-optics',
  };
  const project = {
    id: 'project-optics-1',
    title: 'Optics physical inquiry',
    stage: 'intent_confirmed',
    progress: 8,
    ...frozen,
  };
  const projectContext = {
    project,
    progress: { currentStageIndex: 1, stageTotal: 4, progressPercent: 8 },
    stages: [
      { id: 'exploration', title: 'Explore', status: 'completed' },
      { id: 'concept_mastery', title: 'Theory', status: 'active' },
      { id: 'guided_practice', title: 'Practice', status: 'locked' },
      { id: 'deliverable_review', title: 'Review', status: 'locked' },
    ],
    currentTask: null,
    team: { teamId: 'team-optics', teamName: 'Optics inquiry team', assistantId: 'assistant-lead', assistantName: 'Optics mentor' },
    phases: [
      { phaseId: 'exploration', orderIndex: 0, name: 'Explore', gateRule: 'none', requiresGateApproval: false, gateStatus: 'not_required', status: 'completed', requiredDeliverables: [] },
      { phaseId: 'concept_mastery', orderIndex: 1, name: 'Theory', gateRule: 'TheoryMastered', requiresGateApproval: true, gateStatus: theoryMastered ? 'passed' : 'pending', status: 'active', requiredDeliverables: [] },
      { phaseId: 'guided_practice', orderIndex: 2, name: 'Practice', gateRule: 'TheoryMastered', requiresGateApproval: true, gateStatus: theoryMastered ? 'passed' : 'pending', status: theoryMastered ? 'active' : 'locked', requiredDeliverables: [] },
      { phaseId: 'deliverable_review', orderIndex: 3, name: 'Review', gateRule: 'review', requiresGateApproval: true, gateStatus: 'pending', status: 'locked', requiredDeliverables: [] },
    ],
    lesson: { lessonIndex: 1, lessonCount: 16, title: 'Single-slit diffraction', status: 'current', checkpoint: 'predict before run' },
  };
  const teamGraph = {
    team: projectContext.team,
    runId: 'run-optics-1',
    agents: [{
      slotId: 'slot-coach', assistantId: 'assistant-coach', name: 'Simulation coach', role: 'coach', roleLabel: 'Simulation coach',
      status: 'running', currentTaskSummary: 'Checking the diffraction prediction', pblPhase: 'concept_mastery',
      messages: [{ messageId: 'msg-1', summary: 'Asked for a prediction', direction: 'outbound', createdAt: '2026-10-21T00:00:00.000Z' }],
      toolCalls: [{ callId: 'call-1', name: 'optics.simulate', label: 'Run diffraction model', status: 'done', summary: 'Model result is ready', startedAt: '2026-10-21T00:00:00.000Z', finishedAt: '2026-10-21T00:00:01.000Z' }],
    }],
  };
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    requests.push({ url: String(url), method, init });
    if (url === '/api/v1/explorations' && method === 'POST') return Response.json({ data: { id: 'exp-optics-1' } });
    if (String(url).includes('/api/v1/explorations/exp-optics-1') && method === 'GET') {
      return Response.json({ data: { id: 'exp-optics-1', status: explorationStatus, intentDraft: { goalUser: null, coreInterests: [] } } });
    }
    if (String(url).endsWith('/api/v1/explorations/exp-optics-1') && method === 'PATCH') return Response.json({ data: { id: 'exp-optics-1', status: 'awaiting_confirmation' } });
    if (String(url).endsWith('/confirm-intent') && method === 'POST') {
      explorationStatus = 'confirmed';
      return Response.json({ data: { exploration: { id: 'exp-optics-1', status: 'confirmed' }, project, replayed: requests.filter((item) => item.url.endsWith('/confirm-intent')).length > 1 } });
    }
    if (String(url).includes('/api/v1/tutor/session?explorationId=')) return Response.json({ data: { sessionId: 'session-explore', projectId: null, explorationId: 'exp-optics-1', source: 'exploration', context: { kind: 'exploration', label: 'exploration', status: explorationStatus === 'confirmed' ? 'confirmed' : 'active', projectId: null }, turns: [], lastSeq: 0 } });
    if (String(url).includes('/api/v1/tutor/session?projectId=')) return Response.json({ data: { sessionId: 'session-optics', projectId: project.id, explorationId: 'exp-optics-1', source: 'project', context: { kind: 'project', label: 'project', status: 'confirmed', projectId: project.id }, turns: [], lastSeq: 0 } });
    if (String(url).includes('/api/v1/tutor/project-context')) return Response.json({ data: { ...projectContext, phases: projectContext.phases.map((phase) => phase.phaseId === 'concept_mastery' || phase.phaseId === 'guided_practice' ? { ...phase, gateStatus: theoryMastered ? 'passed' : 'pending', status: phase.phaseId === 'guided_practice' && !theoryMastered ? 'locked' : phase.status } : phase) } });
    if (String(url).includes('/api/v1/tutor/team-graph')) return Response.json({ data: teamGraph });
    if (String(url).includes('/interactive/quiz-diffraction/answer')) {
      quizAttempts += 1;
      return Response.json({ data: { quizId: 'quiz-diffraction', correct: true, attempts: quizAttempts, hintLevel: 0, explanation: null, correctKeys: null, conceptDeltas: [], nextGuidance: 'Explain the relation in your own words.', replayed: quizAttempts > 1 } });
    }
    if (String(url).includes('/interactive/experiments/exp-diffraction/action')) {
      if (!theoryMastered) return Response.json({ code: 'THEORY_MASTERED_REQUIRED', detail: 'Theory gate is not passed' }, { status: 409 });
      return Response.json({ data: { accepted: true, actionId: 'action-1', experimentId: 'exp-diffraction', action: JSON.parse(init.body).action, simulationResult: { mode: 'diffraction', summary: 'bounded model result' } } });
    }
    return Response.json({ data: {} });
  };
  try {
    const source = new TutorApiDataSource();
    const explorationSession = await source.createSession({ source: 'exploration', idempotencyKey: 'create-exploration' });
    assert.equal(explorationSession.projectId, null);
    assert.equal(explorationSession.explorationId, 'exp-optics-1');
    assert.equal(requests.some((item) => item.url.includes('/projects')), false);
    const streamedQuestion = [];
    source.sockets.set(explorationSession.sessionId, { startTurn: (input) => { streamedQuestion.push(input); return 1; } });
    const acceptedQuestion = await source.submitTurn(explorationSession.sessionId, { content: 'Why does a narrower slit widen the pattern?', pedagogicMove: 'ask', idempotencyKey: 'question-1' });
    assert.equal(acceptedQuestion.accepted, true);
    assert.deepEqual(streamedQuestion, [{ content: 'Why does a narrower slit widen the pattern?', pedagogicMove: 'ask', optionLabel: undefined, idempotencyKey: 'question-1' }]);

    const firstConfirmation = await source.confirmExploration('exp-optics-1', { goal: 'Understand diffraction', interest: 'optics', templateVersionId: frozen.templateVersionId }, 'confirm-optics');
    const secondConfirmation = await source.confirmExploration('exp-optics-1', { goal: 'Understand diffraction', interest: 'optics', templateVersionId: frozen.templateVersionId }, 'confirm-optics');
    assert.equal(firstConfirmation.project.id, project.id);
    assert.equal(secondConfirmation.replayed, true);
    assert.deepEqual(Object.fromEntries(Object.entries(secondConfirmation.project).filter(([key]) => key in frozen)), frozen);

    const projectSession = await source.createSession({ source: 'project', projectId: project.id, idempotencyKey: 'create-project' });
    const context = await source.getProjectContext(project.id);
    const graph = await source.getTeamGraph(project.id);
    assert.equal(projectSession.projectId, project.id);
    assert.equal(context.lesson.lessonCount, 16);
    assert.deepEqual(context.phases.map((phase) => phase.name), ['Explore', 'Theory', 'Practice', 'Review']);
    assert.equal(graph.agents[0].toolCalls[0].summary, 'Model result is ready');
    assert.equal(graph.agents[0].messages[0].summary, 'Asked for a prediction');

    const quiz = await source.answerInteractiveQuiz(projectSession.sessionId, 'quiz-diffraction', { selectedKeys: ['b'], idempotencyKey: 'quiz-key' });
    const replayedQuiz = await source.answerInteractiveQuiz(projectSession.sessionId, 'quiz-diffraction', { selectedKeys: ['b'], idempotencyKey: 'quiz-key' });
    assert.equal(quiz.correct, true);
    assert.equal(replayedQuiz.replayed, true);
    await assert.rejects(source.submitExperimentAction(projectSession.sessionId, 'exp-diffraction', { action: 'run', payload: { slitWidth: 0.4 }, idempotencyKey: 'run-before-theory' }), (error) => error.status === 409 && error.code === 'THEORY_MASTERED_REQUIRED');
    assert.equal(requests.some((item) => /\/stage|\/mastery|\/growth/.test(item.url)), false);
    theoryMastered = true;
    const run = await source.submitExperimentAction(projectSession.sessionId, 'exp-diffraction', { action: 'run', payload: { slitWidth: 0.4 }, idempotencyKey: 'run-after-theory' });
    assert.equal(run.accepted, true);
    assert.equal(run.simulationResult.mode, 'diffraction');
  } finally { globalThis.fetch = original; }
});
