import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configurationAdmin, configurationBindingFixture } from './configuration-binding.test-fixture';
import { actor } from './templates.test-support';

test('explicit reconfirmation repairs a missing snapshot, survives reload and is idempotent', async () => {
  const h = await configurationBindingFixture();
  await h.activate();
  const preview = () => h.recovery.preview(configurationAdmin, 'configuration-template', 'configuration-version');
  assert.deepEqual(await preview(), [{ projectId: 'synthetic-project', state: 'missing' }]);
  assert.equal(await h.bindings.findFrozenSnapshotForProject('synthetic-project', 'configuration-version'), null);
  const args = [configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id, 'synthetic-project', 'Restore reviewed configuration', 'reconfirm'] as const;
  const first = await h.recovery.reconfirm(...args);
  assert.equal(first.snapshot.backfilled, false);
  assert.equal(first.snapshot.bindingId, h.binding.id);
  assert.equal((await preview())[0]?.state, 'ready');
  assert.equal((await h.recovery.reconfirm(...args)).replayed, true);
  assert.equal(h.audit.entries.filter((entry) => entry.action === 'project.binding.reconfirm').length, 1);
  assert.equal(JSON.stringify(await preview()).includes('Private learner title'), false);
});

test('legacy snapshots require an explicit write, while complete frozen snapshots cannot be replaced', async () => {
  const h = await configurationBindingFixture();
  await h.activate();
  await h.store.insertSnapshot({ projectId: 'synthetic-project', templateVersionId: 'configuration-version', bindingId: 'old-binding',
    teamVersionId: 'legacy-team', bindingHash: 'old-hash', bundleDigest: null, backfilled: true, boundAt: new Date('2025-01-01') });
  await h.recovery.preview(configurationAdmin, 'configuration-template', 'configuration-version');
  assert.equal((await h.store.findSnapshot('synthetic-project'))?.bindingId, 'old-binding');
  await h.recovery.reconfirm(configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id, 'synthetic-project', 'Review legacy configuration', 'repair');
  const frozen = (await h.store.findSnapshot('synthetic-project'))!;
  assert.equal(frozen.backfilled, false);
  assert.equal(h.audit.entries.at(-1)?.detail?.previousBindingHash, 'old-hash');
  await assert.rejects(h.store.reconfirmLegacySnapshot({ ...frozen, bindingId: 'replacement' }, frozen));
  assert.equal((await h.store.findSnapshot('synthetic-project'))?.bindingId, h.binding.id);
});

test('reconfirmation rejects a foreign project, stale binding, unauthorized actor and uncompiled target', async () => {
  const h = await configurationBindingFixture();
  const confirm = (actorValue = configurationAdmin, project = 'synthetic-project', binding = h.binding.id) =>
    h.recovery.reconfirm(actorValue, 'configuration-template', 'configuration-version', binding, project, 'Reviewed', `${project}:${binding}:${actorValue.id}`);
  await assert.rejects(confirm());
  await h.activate();
  await assert.rejects(confirm(configurationAdmin, 'foreign-project'));
  await assert.rejects(confirm(configurationAdmin, 'synthetic-project', 'old-active'));
  await assert.rejects(confirm(actor('teacher', 'unrelated-teacher')));
  await assert.rejects(confirm(actor('student', 'synthetic-student')));
  assert.equal(await h.store.findSnapshot('synthetic-project'), null);
  assert.equal(h.audit.entries.some((entry) => entry.action === 'project.binding.reconfirm'), false);
});

test('a corrupt complete snapshot fails closed instead of granting the current binding', async () => {
  const h = await configurationBindingFixture();
  await h.activate();
  await h.store.insertSnapshot({ projectId: 'synthetic-project', templateVersionId: 'configuration-version', bindingId: 'corrupt-binding',
    teamVersionId: h.team.id, bindingHash: 'corrupt', bundleDigest: 'a'.repeat(64), backfilled: false, boundAt: new Date() });
  assert.equal((await h.recovery.preview(configurationAdmin, 'configuration-template', 'configuration-version'))[0]?.state, 'invalid');
  await assert.rejects(h.recovery.reconfirm(configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id, 'synthetic-project', 'Reviewed', 'corrupt'));
  assert.equal((await h.store.findSnapshot('synthetic-project'))?.bindingId, 'corrupt-binding');
});

test('a historical formal snapshot without a teaching digest can be explicitly reconfirmed', async () => {
  const h = await configurationBindingFixture();
  await h.activate();
  await h.store.insertSnapshot({ projectId: 'synthetic-project', templateVersionId: 'configuration-version', bindingId: 'historical-formal',
    teamVersionId: 'legacy-team', bindingHash: 'historical-hash', bundleDigest: null, backfilled: false, boundAt: new Date('2025-01-01') });
  assert.equal((await h.recovery.preview(configurationAdmin, 'configuration-template', 'configuration-version'))[0]?.state, 'legacy');
  const result = await h.recovery.reconfirm(configurationAdmin, 'configuration-template', 'configuration-version', h.binding.id, 'synthetic-project', 'Reviewed historical configuration', 'formal-legacy');
  assert.equal(result.snapshot.bindingId, h.binding.id);
  assert.match(result.snapshot.bundleDigest!, /^[a-f0-9]{64}$/);
});

test('activating a new binding never authorizes overwriting a complete historical project', async () => {
  const h = await configurationBindingFixture();
  await h.activate();
  await h.bindings.freezeProjectBinding({ projectId: 'synthetic-project', templateVersionId: 'configuration-version', boundAt: new Date() });
  const { binding: next } = await h.bindings.createBinding(configurationAdmin, 'configuration-template', 'configuration-version', { teamVersionId: h.team.id }, 'new-binding');
  await h.bindings.saveTeachingBundleDraft(configurationAdmin, 'configuration-template', 'configuration-version', next.id, h.draft, 'new-draft');
  await h.bindings.validateBinding(configurationAdmin, 'configuration-template', 'configuration-version', next.id, 'new-validate');
  await h.bindings.activateBinding(configurationAdmin, 'configuration-template', 'configuration-version', next.id, 'new-activate');
  await assert.rejects(h.recovery.reconfirm(configurationAdmin, 'configuration-template', 'configuration-version', next.id, 'synthetic-project', 'Reviewed', 'do-not-replace'));
  assert.equal((await h.bindings.findFrozenSnapshotForProject('synthetic-project', 'configuration-version'))?.bindingId, h.binding.id);
});
