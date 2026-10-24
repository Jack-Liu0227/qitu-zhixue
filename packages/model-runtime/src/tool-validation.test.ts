import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeToolArguments } from './tool-validation.js';

const schema = { type: 'object', properties: { kind: { type: 'string' }, use: { type: 'string' }, title: { type: 'string' },
  steps: { type: 'array', items: { type: 'object', properties: { tex: { type: 'string' } } } } }, oneOf: [
  { type: 'object', additionalProperties: false, properties: { kind: { const: 'find' }, use: { type: 'string' } }, required: ['kind', 'use'] },
  { type: 'object', additionalProperties: false, properties: { kind: { const: 'board' }, title: { type: 'string' },
    steps: { type: 'array', items: { type: 'object', properties: { tex: { type: 'string' } } } } }, required: ['kind', 'title', 'steps'] },
] };

test('repair guidance describes the actual variant, not unrelated union branches', () => {
  const result = describeToolArguments(schema, { kind: 'board', title: 'retain title', steps: [{ tex: 'x>0' }], use: 'explain' });
  assert.deepEqual(result.fields, ['kind', 'title', 'steps']);
  assert.ok(result.issues.some(issue => issue.path === '/use'));
  assert.ok(result.issues.every(issue => !['/title', '/steps', '/kind'].includes(issue.path)));
  const missing = describeToolArguments(schema, { kind: 'board', steps: [{ tex: null }] });
  assert.ok(missing.issues.some(issue => issue.path === '/title' && issue.rule === 'required'));
  assert.ok(missing.issues.some(issue => issue.path === '/steps/0/tex'));
});

test('diagnostics expose only schema field paths, never caller values or invented sensitive keys', () => {
  const result = describeToolArguments(schema, { kind: 'board', title: 'private student text', secretChildName: 'secret', steps: [] });
  assert.doesNotMatch(JSON.stringify(result), /private student text|secretChildName|secret/);
  assert.ok(result.issues.some(issue => issue.path === '/$extra'));
});
