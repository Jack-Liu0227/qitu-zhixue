import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const script = resolve(root, 'tooling/verify-knowledge-upstream.mjs');

function run(...args) {
  return execFileSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
}

test('knowledge upstream verification passes against the pinned checkout', () => {
  const output = run();
  assert.match(output, /通过/);
  assert.equal(readFileSync(resolve(root, 'services/knowledge/source/QITU_PIN'), 'utf8').trim(), '6cf793bd868ba5ecbe64722936d4be8fab5a01df');
});

test('knowledge upstream checksum is deterministic', () => {
  const first = run('--checksum').match(/deeptutor checksum: ([0-9a-f]{64})/)?.[1];
  const second = run('--checksum').match(/deeptutor checksum: ([0-9a-f]{64})/)?.[1];
  assert.match(first ?? '', /^[0-9a-f]{64}$/);
  assert.equal(second, first);
});
