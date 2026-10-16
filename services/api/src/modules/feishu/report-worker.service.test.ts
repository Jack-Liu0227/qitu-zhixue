import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeishuReportWorker } from './report-worker.service';
import type { FeishuReportDocument } from '@qitu/contracts';

const report: FeishuReportDocument = {
  summary: { studentCount: 2, parentCount: 1, teacherCount: 1, projectCount: 3, stalledStudentCount: 1, pendingInterventionCount: 0 },
  range: { from: '2026-10-16T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z' },
  sources: ['projects'],
  generatedAt: '2026-10-17T00:00:00.000Z',
  redacted: true,
  students: [],
  parents: [],
  teachers: [],
};

test('FeishuReportWorker sends once per assistant/idempotency key and hashes recipients', async () => {
  let sends = 0;
  const feishu = {
    getRecipientHashes: async () => ['ou-admin-1', 'ou-admin-2'],
    sendReport: async () => { sends += 1; return { requestId: 'req-1' }; },
  };
  const worker = new FeishuReportWorker(feishu as never);
  const first = await worker.deliver({ idempotencyKey: 'daily-1', assistantId: 'assistant-a', report });
  const second = await worker.deliver({ idempotencyKey: 'daily-1', assistantId: 'assistant-a', report });
  const otherAssistant = await worker.deliver({ idempotencyKey: 'daily-1', assistantId: 'assistant-b', report });

  assert.equal(first.status, 'sent');
  assert.equal(first.recipientCount, 2);
  assert.equal(first.recipientHashes.every((hash) => /^[a-f0-9]{16}$/.test(hash)), true);
  assert.equal(first.requestId, 'req-1');
  assert.equal(second.status, 'already_sent');
  assert.equal(otherAssistant.status, 'sent');
  assert.equal(sends, 2);
});

test('FeishuReportWorker does not send with an empty recipient projection', async () => {
  let sends = 0;
  const worker = new FeishuReportWorker({
    getRecipientHashes: async () => [],
    sendReport: async () => { sends += 1; return {}; },
  } as never);
  const result = await worker.deliver({ idempotencyKey: 'daily-empty', report });
  assert.deepEqual(result, { status: 'failed', recipientCount: 0, recipientHashes: [] });
  assert.equal(sends, 0);
});

test('FeishuReportWorker classifies network, timeout, and rate-limit errors as retryable', async () => {
  for (const message of ['network disconnected', 'request timeout', 'HTTP 429', 'upstream unavailable']) {
    const worker = new FeishuReportWorker({
      getRecipientHashes: async () => ['ou-admin'],
      sendReport: async () => { throw new Error(message); },
    } as never);
    const result = await worker.deliver({ idempotencyKey: `retry-${message}`, report });
    assert.equal(result.status, 'retryable', message);
  }
});

test('FeishuReportWorker rejects empty or overlong idempotency keys', async () => {
  const worker = new FeishuReportWorker({ getRecipientHashes: async () => ['ou-admin'], sendReport: async () => ({}) } as never);
  await assert.rejects(() => worker.deliver({ idempotencyKey: '', report }));
  await assert.rejects(() => worker.deliver({ idempotencyKey: 'x'.repeat(161), report }));
});

