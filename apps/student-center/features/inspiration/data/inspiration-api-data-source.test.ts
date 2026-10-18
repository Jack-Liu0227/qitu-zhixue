import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InspirationApiDataSource } from './inspiration-api-data-source';
import type { InspirationTemplate } from '../types';

const template: InspirationTemplate = {
  id: 'template-fixture', templateVersionId: 'tplv-fixture', title: 'Synthetic inquiry', summary: '',
  subject: 'physics', tags: ['observation'], difficulty: null, durationWeeks: null, stages: [], outcome: '',
};
const reply = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });

test('recommended project starts through server-owned exploration and confirmation with stable keys', async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/confirm-intent')) return reply({ project: { id: 'project-fixture' }, exploration: { id: 'exploration-fixture' }, replayed: false });
    return reply({ id: 'exploration-fixture' });
  };
  try {
    const source = new InspirationApiDataSource();
    const result = await source.startRecommendedProject(template, 'stable-start');
    assert.equal(result.project.id, 'project-fixture');
    assert.deepEqual(calls.map(({ url, init }) => [url, init?.method]), [
      ['/api/v1/explorations', 'POST'],
      ['/api/v1/explorations/exploration-fixture', 'PATCH'],
      ['/api/v1/explorations/exploration-fixture/confirm-intent', 'POST'],
    ]);
    assert.equal(new Headers(calls[0]!.init?.headers).get('idempotency-key'), 'stable-start:exploration');
    assert.equal(new Headers(calls[2]!.init?.headers).get('idempotency-key'), 'stable-start:confirm');
    assert.deepEqual(JSON.parse(String(calls[2]!.init?.body)), { templateVersionId: 'tplv-fixture' });
    assert.doesNotMatch(JSON.stringify(calls), /teamId|advance_stage|TheoryMastered/);
  } finally { globalThis.fetch = original; }
});

test('missing template version and failed confirmation never report a created project', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (String(url).endsWith('/confirm-intent')) return new Response(JSON.stringify({ message: 'Synthetic denial', code: 'FORBIDDEN' }), { status: 403 });
    return reply({ id: 'exploration-fixture' });
  };
  try {
    const source = new InspirationApiDataSource();
    await assert.rejects(source.startRecommendedProject({ ...template, templateVersionId: null }, 'key'), /模板版本/);
    assert.equal(calls, 0);
    await assert.rejects(source.startRecommendedProject(template, 'key'), /Synthetic denial/);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});
