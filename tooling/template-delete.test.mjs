import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../apps/admin-console/lib/api/content.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });

function fixture() {
  const calls = [];
  let receipt = { success: true, id: 'archived-course' };
  let rows = [];
  let offline = false;
  const exports = {};
  runInNewContext(outputText, {
    exports,
    require: name => {
      if (name === '@qitu/api-client') return { createApiClient: () => ({ get: async path => {
        calls.push({ path, method: 'GET' });
        if (offline) throw new Error('Readback offline');
        return { data: rows };
      } }) };
      if (name !== './types') throw new Error(`Unexpected dependency ${name}`);
      return { newIdempotencyKey: () => 'generated-key', adminEnvelopeRequest: async request => {
        calls.push(request);
        return receipt;
      } };
    },
  });
  return { remove: exports.deleteAdminTemplate, removeWithRecords: exports.deleteTemplateWithRecords, preview: exports.fetchTemplateDeletionImpact, calls,
    receipt(value) { receipt = value; }, rows(value) { rows = value; }, offline(value) { offline = value; } };
}

test('deletion requires a matching successful receipt and an absence readback', async () => {
  const f = fixture();
  assert.equal((await f.remove('archived-course', 'stable-key')).success, true);
  assert.equal(f.calls[0].method, 'DELETE');
  assert.equal(f.calls[0].idempotencyKey, 'stable-key');
  assert.equal(f.calls[1].path, '/api/v1/admin/project-templates');
});

test('cascade deletion carries explicit confirmation and retains its key after readback failure', async () => {
  const f = fixture();
  const impact = { templateId: 'archived-course', title: 'Course', fingerprint: 'a'.repeat(64), counts: { projects: 2 } };
  await f.preview(impact.templateId);
  assert.equal(f.calls[0].method, 'GET');
  assert.ok(f.calls[0].path.endsWith('/deletion-impact'));
  f.offline(true);
  await assert.rejects(f.removeWithRecords(impact, impact.title, 'cascade-key'), /Readback offline/);
  f.offline(false);
  await f.removeWithRecords(impact, impact.title, 'cascade-key');
  const requests = f.calls.filter(call => call.method === 'DELETE');
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.ok(request.path.endsWith('/with-records'));
    assert.equal(request.idempotencyKey, 'cascade-key');
    assert.equal(request.body.includeLearningData, true);
    assert.equal(request.body.confirmedTitle, 'Course');
    assert.equal(request.body.expectedFingerprint, impact.fingerprint);
  }
});

test('unsuccessful receipts and a course still in the catalog never report deletion success', async () => {
  for (const receipt of [{ success: false, id: 'archived-course' }, { success: true, id: 'different-course' }]) {
    const f = fixture(); f.receipt(receipt);
    await assert.rejects(f.remove('archived-course', 'key'), /回读确认/);
  }
  const f = fixture(); f.rows([{ id: 'archived-course' }]);
  await assert.rejects(f.remove('archived-course', 'key'), /回读确认/);
});

test('readback outage fails visibly; retry uses the same deletion key and confirms absence', async () => {
  const f = fixture(); f.offline(true);
  await assert.rejects(f.remove('archived-course', 'retry-key'), /Readback offline/);
  f.offline(false);
  assert.equal((await f.remove('archived-course', 'retry-key')).success, true);
  assert.deepEqual(f.calls.filter(call => call.method === 'DELETE').map(call => call.idempotencyKey), ['retry-key', 'retry-key']);
});
