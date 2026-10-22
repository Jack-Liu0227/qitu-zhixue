import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  connectionDiagnostic,
  remoteLibraries,
} from '../apps/admin-console/lib/components/knowledge-library/connection-checks.ts';

const checkedAt = '2026-10-22T13:00:00Z';
test('connection diagnostics distinguish missing credentials, rejected authorization and resource failures', () => {
  assert.equal(
    connectionDiagnostic('unauthorized', 'ENGINE_NEEDS_KEY', checkedAt).label,
    '缺少认证凭证',
  );
  for (const code of ['IMA_CREDENTIALS_REJECTED', 'REMOTE_AUTH_FAILED'])
    assert.equal(connectionDiagnostic('error', code, checkedAt).kind, 'auth');
  for (const code of ['IMA_KB_ID_INVALID', 'IMA_KB_ID_IS_CLIENT_ID', 'REMOTE_RESOURCE_NOT_FOUND'])
    assert.equal(connectionDiagnostic('error', code, checkedAt).kind, 'resource');
});

test('network, rate limit and incomplete checks never claim expired authentication or readiness', () => {
  assert.equal(connectionDiagnostic('unreachable', 'IMA_TIMEOUT', checkedAt).kind, 'network');
  assert.equal(connectionDiagnostic('error', 'IMA_RATE_LIMITED', checkedAt).kind, 'network');
  assert.equal(connectionDiagnostic('ready', null, null).label, '尚未检测');
  assert.equal(
    connectionDiagnostic('ready', 'REMOTE_CONNECTION_FAILED', checkedAt).kind,
    'unknown',
  );
  assert.equal(
    connectionDiagnostic('error', 'IMA_UPSTREAM_INVALID_RESPONSE', checkedAt).kind,
    'unknown',
  );
  assert.equal(connectionDiagnostic('ready', null, checkedAt).kind, 'ready');
});

test('batch scope includes all connected libraries, including disabled ones, but excludes local indexes', () => {
  const libraries = [
    { id: 'remote-enabled', connectionStatus: 'ready', enabled: true },
    { id: 'remote-disabled', connectionStatus: 'unauthorized', enabled: false },
    { id: 'local', connectionStatus: null },
    { id: 'not-connected', connectionStatus: 'not_applicable' },
  ];
  assert.deepEqual(
    remoteLibraries(libraries).map((library) => library.id),
    ['remote-enabled', 'remote-disabled'],
  );
});
