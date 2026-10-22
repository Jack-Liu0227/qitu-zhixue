import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Some deployed Node builds omit native TS support; use the workspace compiler.
const source = readFileSync(
  new URL(
    '../apps/admin-console/lib/components/knowledge-library/connection-checks.ts',
    import.meta.url,
  ),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { connectionDiagnostic, remoteLibraries } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

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
