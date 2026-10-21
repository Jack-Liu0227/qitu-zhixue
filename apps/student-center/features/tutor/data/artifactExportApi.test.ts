import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ARTIFACT_EXPORT_MIME_TYPES } from '@qitu/contracts';
import { exportArtifactVersion } from './artifactExportApi';

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

test('artifact download preserves version identity, abort signal and credentials', async () => {
  const controller = new AbortController();
  globalThis.fetch = async (input, options) => {
    assert.equal(input, '/api/v1/artifacts/artifact%2Fone/versions/version%20one/export?format=pdf');
    assert.equal(options?.credentials, 'include');
    assert.equal(options?.signal, controller.signal);
    assert.equal(options?.cache, 'no-store');
    return new Response('%PDF-owned', { headers: { 'content-type': ARTIFACT_EXPORT_MIME_TYPES.pdf } });
  };
  assert.equal((await exportArtifactVersion('artifact/one', 'version one', 'pdf', controller.signal)).size, 10);
});

test('permission failures, unexpected content and empty files cannot become successful downloads', async () => {
  const controller = new AbortController();
  for (const response of [new Response('', { status: 403 }), new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('', { headers: { 'content-type': ARTIFACT_EXPORT_MIME_TYPES.pdf } })]) {
    globalThis.fetch = async () => response;
    await assert.rejects(exportArtifactVersion('artifact', 'version', 'pdf', controller.signal));
  }
});
