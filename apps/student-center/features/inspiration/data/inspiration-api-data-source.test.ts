import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InspirationApiDataSource } from './inspiration-api-data-source';

test('the published server catalogue is authoritative, including an empty catalogue', async () => {
  const original = globalThis.fetch;
  let templates = [{ id: 'wave', title: 'Wave inquiry' }, { id: 'thunder', title: 'Thunder game' }];
  globalThis.fetch = async url => Response.json({ data: String(url).endsWith('/api/v1/project-templates') ? templates : { stages: [] } });
  try {
    const source = new InspirationApiDataSource();
    assert.deepEqual((await source.listTemplates()).map(item => item.id), ['wave', 'thunder']);
    templates = [];
    assert.deepEqual(await source.listTemplates(), [], 'Demo fixtures must never be appended to the live catalogue');
  } finally { globalThis.fetch = original; }
});

test('template lesson duration follows server schedule metadata and stays unknown without it', async () => {
  const original = globalThis.fetch;
  let scheduling: Record<string, unknown> = { lessonCount: 8, lessonMinutes: 60 };
  globalThis.fetch = async url => Response.json({ data: String(url).endsWith('/api/v1/project-templates')
    ? [{ id: 'wave', title: 'Wave inquiry', estimatedDurationMinutes: 480, latestPublishedVersionId: 'wave-v1', ...scheduling }]
    : { stages: [] } });
  try {
    const source = new InspirationApiDataSource();
    const item = (await source.listTemplates())[0]!;
    assert.equal(item.lessonCount, 8); assert.equal(item.lessonMinutes, 60);
    scheduling = { lessonCount: 4, lessonMinutes: 120 };
    assert.equal((await source.listTemplates())[0]!.lessonCount, 4);
    scheduling = {};
    const unknown = (await source.listTemplates())[0]!;
    assert.equal(unknown.lessonCount, null); assert.equal(unknown.lessonMinutes, null);
  } finally { globalThis.fetch = original; }
});

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

test('confirming recommended exploration patches draft and creates formal project', async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/confirm-intent')) {
      return new Response(JSON.stringify({ data: { project: { id: 'proj-optics-101' } } }), { status: 201 });
    }
    return new Response(JSON.stringify({ data: { id: 'exp-123', status: 'awaiting_confirmation' } }), { status: 200 });
  };
  try {
    const source = new InspirationApiDataSource();
    const result = await source.confirmRecommendedExploration('exp-123', 'optics-16x60-v2', 'key-confirm', {
      goalUser: '波动光学双缝干涉',
      coreInterests: ['光的波动性', '杨氏双缝干涉'],
    });
    assert.equal(result.projectId, 'proj-optics-101');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, '/api/v1/explorations/exp-123');
    assert.equal(calls[0]?.init?.method, 'PATCH');
    const patchBody = JSON.parse(String(calls[0]?.init?.body));
    assert.equal(patchBody.goalUser, '波动光学双缝干涉');
    assert.deepEqual(patchBody.coreInterests, ['光的波动性', '杨氏双缝干涉']);

    assert.equal(calls[1]?.url, '/api/v1/explorations/exp-123/confirm-intent');
    assert.equal(calls[1]?.init?.method, 'POST');
    assert.equal(new Headers(calls[1]?.init?.headers).get('idempotency-key'), 'key-confirm');
  } finally { globalThis.fetch = original; }
});
