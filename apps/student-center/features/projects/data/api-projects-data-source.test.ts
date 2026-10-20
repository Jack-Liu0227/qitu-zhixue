import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiProjectsDataSource } from './api-projects-data-source';

test('legacy task completion never advances a project or manufactures a receipt', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('unexpected network'); };
  try {
    await assert.rejects(new ApiProjectsDataSource().completeTask('session-fixture', 'key'),
      { code: 'SERVER_CONTRACT_REQUIRED' });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('project theory reads do not allocate pending questions or fall back to static optics', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{}', { status: 403 }); };
  try {
    const source = new ApiProjectsDataSource();
    assert.deepEqual(await source.getTheoryQuestions('project-fixture'), []);
    assert.equal(calls, 0);
    await assert.rejects(source.getTheoryMaterial('project-fixture'), { status: 403 });
  } finally { globalThis.fetch = original; }
});
