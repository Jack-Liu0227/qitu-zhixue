import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TutorApiDataSource } from './tutorApiDataSource';

test('confirmation retry reads confirmed exploration and never patches it again', async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const data = init?.method === 'POST'
      ? { project: { id: 'project-fixture' }, exploration: { id: 'exploration-fixture' }, replayed: true }
      : { id: 'exploration-fixture', status: 'confirmed' };
    return new Response(JSON.stringify({ data }));
  };
  try {
    const result = await new TutorApiDataSource().confirmExploration('exploration-fixture',
      { goal: 'Synthetic inquiry', interest: 'Optics', templateVersionId: 'version-fixture' }, 'confirm-key');
    assert.equal(result.replayed, true);
    assert.deepEqual(calls.map(({ init }) => init?.method ?? 'GET'), ['GET', 'POST']);
    assert.equal(new Headers(calls[1]!.init?.headers).get('idempotency-key'), 'confirm-key');
  } finally { globalThis.fetch = original; }
});
