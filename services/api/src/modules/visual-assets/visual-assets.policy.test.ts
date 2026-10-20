import test from 'node:test';
import assert from 'node:assert/strict';
import { VISUAL_ASSETS, type VisualBinding } from '@qitu/contracts';
import { parseVisualPatch, resolveVisualBinding, visualBindingKey } from './visual-assets.policy';

test('catalog contains ten reusable avatars and unique immutable IDs', () => {
  assert.equal(VISUAL_ASSETS.filter((asset) => asset.usages.includes('avatar')).length, 10);
  assert.equal(new Set(VISUAL_ASSETS.map((asset) => asset.id)).size, 55);
});

test('visual selection rejects URL injection, unknown assets, slot mismatch and unsafe revisions', () => {
  const base = { owner: { kind: 'assistant', id: 'real-assistant' }, usage: 'avatar', expectedRevision: 0 };
  assert.throws(() => parseVisualPatch({ ...base, selection: { kind: 'asset', assetId: 'https://example.com/picture.png' } }));
  assert.throws(() => parseVisualPatch({ ...base, selection: { kind: 'asset', assetId: 'team-optics-v1' } }));
  assert.throws(() => parseVisualPatch({ ...base, expectedRevision: 0.5, selection: { kind: 'inherit' } }));
  assert.throws(() => parseVisualPatch({ ...base, selection: { kind: 'inherit', assetId: 'avatar-data-v1' } }));
  assert.throws(() => parseVisualPatch({ ...base, selection: { kind: 'inherit' }, modelId: 'forbidden' }));
  assert.deepEqual(parseVisualPatch({ ...base, selection: { kind: 'asset', assetId: 'avatar-data-v1' } }).selection, { kind: 'asset', assetId: 'avatar-data-v1' });
});

test('new assistants inherit one platform default; explicit choices survive default changes', () => {
  const defaults: VisualBinding = { owner: { kind: 'platform', id: 'assistant' }, usage: 'avatar', selection: { kind: 'asset', assetId: 'avatar-data-v1' }, revision: 2, effectiveAssetId: 'avatar-data-v1' };
  const custom: VisualBinding = { owner: { kind: 'assistant', id: 'custom' }, usage: 'avatar', selection: { kind: 'asset', assetId: 'avatar-growth-v1' }, revision: 1, effectiveAssetId: 'avatar-growth-v1' };
  assert.equal(resolveVisualBinding({ kind: 'assistant', id: 'new-one' }, 'avatar', [defaults, custom]).effectiveAssetId, 'avatar-data-v1');
  assert.equal(resolveVisualBinding({ kind: 'assistant', id: 'new-two' }, 'avatar', [defaults, custom]).effectiveAssetId, 'avatar-data-v1');
  assert.equal(resolveVisualBinding(custom.owner, 'avatar', [defaults, custom]).effectiveAssetId, 'avatar-growth-v1');
  assert.equal(resolveVisualBinding(custom.owner, 'avatar', [defaults, { ...custom, selection: { kind: 'inherit' } }]).effectiveAssetId, 'avatar-data-v1');
});

test('version bindings and escaped owner IDs cannot collide with other objects', () => {
  assert.notEqual(visualBindingKey({ kind: 'template', id: 'same' }, 'icon'), visualBindingKey({ kind: 'template-version', id: 'same' }, 'icon'));
  assert.notEqual(visualBindingKey({ kind: 'assistant', id: 'a:b' }, 'avatar'), visualBindingKey({ kind: 'assistant', id: 'a%3Ab' }, 'avatar'));
});
