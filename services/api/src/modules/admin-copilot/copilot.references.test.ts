import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { ADMIN_COPILOT_CONTRACT_VERSION, ADMIN_COPILOT_OPERATIONS } from '@qitu/contracts';
import { createCopilotReferenceReader, loadCopilotReferences, referenceCatalog } from './copilot.references';
import { MANAGEMENT_OPERATIONS_DIGEST } from './copilot.resources';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'qitu-copilot-references-'));
  const directory = join(root, '.agents', 'skills', 'qitu-project-configurator', 'references');
  await mkdir(directory, { recursive: true });
  const manifest = { contractVersion: ADMIN_COPILOT_CONTRACT_VERSION, operationsDigest: MANAGEMENT_OPERATIONS_DIGEST,
    resources: [{ resource: 'references/module.md', description: 'Synthetic module owner reference',
      operations: ADMIN_COPILOT_OPERATIONS.map(item => item.kind) }] };
  const manifestPath = join(directory, 'catalog.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(directory, 'module.md'), '# Synthetic owner reference\nUse real IDs and owner receipts.\n');
  return { root, directory, manifest, manifestPath, async cleanup() {
    const path = relative(tmpdir(), root);
    assert.ok(path.startsWith('qitu-copilot-references-') && !isAbsolute(path) && !path.includes('..'));
    await rm(root, { recursive: true, force: true });
  } };
}

test('published configurator resources cover the live operations and batched reads preserve the full text', async () => {
  const bundle = await loadCopilotReferences();
  assert.equal(bundle.resources.length, 10);
  assert.equal(new Set(bundle.resources.flatMap(entry => entry.operations)).size, ADMIN_COPILOT_OPERATIONS.length);
  assert.equal('content' in referenceCatalog(bundle).resources[0]!, false);
  const reader = createCopilotReferenceReader(bundle);
  assert.throws(() => reader.assertRead(['assistant.create', 'knowledge.bind']), /手册/);
  const output = await reader.tool.execute({ skill_id: 'qitu-project-configurator', resources: bundle.resources.map(item => item.resource) });
  for (const entry of bundle.resources) assert.ok(output.text.includes(JSON.stringify(entry.content).slice(1, -1)));
  reader.assertRead(ADMIN_COPILOT_OPERATIONS.map(item => item.kind));
  for (const args of [
    { skill_id: 'other-skill', resources: ['references/assistants.md'] },
    { skill_id: 'qitu-project-configurator', resources: ['../outside.md'] },
    { skill_id: 'qitu-project-configurator', resources: ['C:/private.txt'] },
    { skill_id: 'qitu-project-configurator', resources: ['references/assistants.md'], command: 'ignored' },
    { skill_id: 'qitu-project-configurator', resources: ['references/assistants.md', 'references/assistants.md'] },
  ]) await assert.rejects(reader.tool.execute(args));
});

test('reference file edits change the bundle identity even when SKILL.md is unchanged', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const first = await loadCopilotReferences(f.root);
  const path = join(f.directory, 'module.md');
  await writeFile(path, `${await readFile(path, 'utf8')}Additional valid owner detail.\n`);
  const second = await loadCopilotReferences(f.root);
  assert.notEqual(first.digest, second.digest);
  assert.notEqual(first.resources[0]?.digest, second.resources[0]?.digest);
});

test('missing, oversized, stale, uncovered and escaped resources fail before the model can read', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  for (const manifest of [
    { ...f.manifest, contractVersion: 'stale' },
    { ...f.manifest, operationsDigest: '0'.repeat(64) },
    { ...f.manifest, resources: [{ ...f.manifest.resources[0], resource: '../outside.md' }] },
    { ...f.manifest, resources: [{ ...f.manifest.resources[0], operations: [] }] },
    { ...f.manifest, resources: [...f.manifest.resources, f.manifest.resources[0]] },
  ]) {
    await writeFile(f.manifestPath, JSON.stringify(manifest));
    await assert.rejects(loadCopilotReferences(f.root), /资源包/);
  }
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await writeFile(join(f.directory, 'module.md'), 'x'.repeat(8001));
  await assert.rejects(loadCopilotReferences(f.root), /资源包/);
  await rm(join(f.directory, 'module.md'));
  await assert.rejects(loadCopilotReferences(f.root), /资源包/);
});

test('directory links cannot redirect the reference reader outside the declared skill', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const outside = join(f.root, 'outside');
  await mkdir(outside);
  await rm(f.directory, { recursive: true });
  await symlink(outside, f.directory, 'junction');
  await assert.rejects(loadCopilotReferences(f.root), /资源包/);
});
