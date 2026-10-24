import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coursewareVisual } from './coursewareVisual';

test('a thinking prompt retains the closest preceding visual without changing saved steps', () => {
  const steps = [{ tex: 'y=y_1+y_2' }, { nodes: [{ id: 'source', label: 'Source' }] }, {}];
  const saved = JSON.stringify(steps);
  assert.deepEqual(coursewareVisual(steps, 2), { step: steps[1], index: 1 });
  assert.equal(JSON.stringify(steps), saved);
  assert.deepEqual(coursewareVisual(steps, 0), { step: steps[0], index: 0 });
});

test('a current visual replaces the retained one; no future or fabricated visual is returned', () => {
  const steps = [{}, { mermaid: 'flowchart LR\na-->b' }, { svg: '<svg />' }];
  assert.equal(coursewareVisual(steps, 0), null);
  assert.deepEqual(coursewareVisual(steps, 2), { step: steps[2], index: 2 });
  for (const position of [-1, 3, 0.5, NaN]) assert.equal(coursewareVisual(steps, position), null);
});
