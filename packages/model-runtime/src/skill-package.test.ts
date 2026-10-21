import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { test } from 'node:test';
import { loadRuntimeSkillPackage } from './skill-package.js';

test('published packages retain long content and references and pin changes to either file', t => {
  const root = mkdtempSync(join(tmpdir(), 'qitu-skill-package-'));
  t.after(() => {
    const path = relative(tmpdir(), root);
    assert.ok(path.startsWith('qitu-skill-package-') && !isAbsolute(path) && !path.includes('..'));
    rmSync(root, { recursive: true });
  });
  mkdirSync(join(root, 'long', 'references'), { recursive: true });
  const main = '---\nname: long\nruntime: teaching\nstatus: published\nreferences: references/method.md\n---\n' + 'a'.repeat(300_000) + 'MAIN_END';
  writeFileSync(join(root, 'long', 'SKILL.md'), main);
  writeFileSync(join(root, 'long', 'references', 'method.md'), 'b'.repeat(70_000) + 'REFERENCE_END');
  const first = loadRuntimeSkillPackage(root, 'long');
  assert.equal(first.ready, true);
  assert.ok(first.content.includes('MAIN_END'));
  assert.ok(first.content.endsWith('REFERENCE_END'));
  writeFileSync(join(root, 'long', 'references', 'method.md'), 'changed reference');
  assert.notEqual(first.packageDigest, loadRuntimeSkillPackage(root, 'long').packageDigest);
  writeFileSync(join(root, 'long', 'SKILL.md'), main.replace('references/method.md', '../outside.md'));
  assert.equal(loadRuntimeSkillPackage(root, 'long').ready, false);
  writeFileSync(join(root, 'long', 'SKILL.md'), main.replace('status: published', 'status: revoked'));
  assert.equal(loadRuntimeSkillPackage(root, 'long').ready, false);
  const plain = main.replace('references: references/method.md\n', '');
  writeFileSync(join(root, 'long', 'SKILL.md'), plain);
  assert.equal(loadRuntimeSkillPackage(root, 'long').packageDigest, createHash('sha256').update(plain).digest('hex'));
});
