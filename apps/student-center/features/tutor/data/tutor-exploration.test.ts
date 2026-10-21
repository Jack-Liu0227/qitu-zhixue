import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TutorApiDataSource } from './tutorApiDataSource';

const context = { project: null, progress: { currentStageIndex: 0, stageTotal: 10, progressPercent: 0 }, stages: [], currentTask: null,
  exploration: { id: 'owned-exploration', templateVersionId: 'chosen-version', title: 'Synthetic course', handoff: 'ready' },
  team: { teamId: 'published-team', teamName: 'Synthetic team', assistantId: 'actual-mentor', assistantName: 'Synthetic mentor' } };

test('exploration adapter reads exact server context and rejects mismatched or forbidden scopes', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  let body: unknown = context;
  let status = 200;
  globalThis.fetch = async input => {
    calls.push(String(input));
    return new Response(JSON.stringify(status === 200 ? { data: body } : { code: 'FORBIDDEN', message: 'Denied' }), { status });
  };
  try {
    const source = new TutorApiDataSource();
    const result = await source.getExplorationContext('owned-exploration');
    assert.equal(result?.team?.assistantId, 'actual-mentor');
    assert.equal(calls[0], '/api/v1/tutor/project-context?explorationId=owned-exploration');
    body = { ...context, exploration: { ...context.exploration, id: 'other-exploration' } };
    await assert.rejects(source.getExplorationContext('owned-exploration'), { code: 'BAD_PROJECT_CONTEXT_PAYLOAD' });
    status = 403;
    await assert.rejects(source.getExplorationContext('owned-exploration'), { status: 403 });
  } finally { globalThis.fetch = original; }
});

test('history adapter only reads the requested project and never starts a teaching session', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  let body: unknown = { sessionId: 'existing', projectId: 'legacy', turns: [], lastSeq: 0 };
  globalThis.fetch = async (input, init) => {
    assert.ok(!init?.method || init.method === 'GET'); calls.push(String(input));
    return new Response(JSON.stringify({ data: body }));
  };
  try {
    const source = new TutorApiDataSource();
    assert.equal((await source.getProjectConversationHistory('legacy'))?.sessionId, 'existing');
    assert.equal(calls[0], '/api/v1/tutor/project-history?projectId=legacy');
    body = { sessionId: 'other', projectId: 'other-project', turns: [], lastSeq: 0 };
    await assert.rejects(source.getProjectConversationHistory('legacy'), { code: 'BAD_SESSION_PAYLOAD' });
    body = null;
    assert.equal(await source.getProjectConversationHistory('legacy'), null);
  } finally { globalThis.fetch = original; }
});
