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
