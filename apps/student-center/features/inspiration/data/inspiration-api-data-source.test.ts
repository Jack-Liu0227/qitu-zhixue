import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InspirationApiDataSource } from './inspiration-api-data-source';

test('opening a recommended exploration never confirms or creates a formal project', async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: { id: 'exploration-fixture' } }), { status: 200 });
  };
  try {
    const source = new InspirationApiDataSource();
    const request = { source: 'recommended' as const, templateVersionId: 'tplv-fixture' };
    const result = await source.createRecommendedExploration(request, 'stable-start');
    assert.equal(result.id, 'exploration-fixture');
    assert.deepEqual(calls.map(({ url, init }) => [url, init?.method]), [['/api/v1/explorations', 'POST']]);
    assert.equal(new Headers(calls[0]!.init?.headers).get('idempotency-key'), 'stable-start');
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), request);
    assert.doesNotMatch(JSON.stringify(calls), /confirm-intent|teamId|advance_stage|TheoryMastered/);
  } finally { globalThis.fetch = original; }
});

test('lost exploration response is retryable with the same key; permission failures propagate', async () => {
  const original = globalThis.fetch;
  const keys: Array<string | null> = [];
  globalThis.fetch = async (_url, init) => {
    keys.push(new Headers(init?.headers).get('idempotency-key'));
    if (keys.length === 1) throw new Error('lost response');
    return new Response(JSON.stringify({ message: 'Synthetic denial', code: 'FORBIDDEN' }), { status: 403 });
  };
  try {
    const source = new InspirationApiDataSource();
    const request = { source: 'recommended' as const, templateVersionId: 'tplv-fixture' };
    await assert.rejects(source.createRecommendedExploration(request, 'retry-key'), { code: 'NETWORK_OFFLINE' });
    await assert.rejects(source.createRecommendedExploration(request, 'retry-key'), { status: 403, code: 'FORBIDDEN' });
    assert.deepEqual(keys, ['retry-key', 'retry-key']);
  } finally { globalThis.fetch = original; }
});
