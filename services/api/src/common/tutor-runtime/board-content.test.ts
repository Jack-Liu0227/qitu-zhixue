import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityBoard } from './board-content';

test('boards accept optical and programming comparisons while keeping graph labels escaped', () => {
  const board = buildActivityBoard({ kind: 'board', title: '比较与边界', steps: [
    { caption: '当 x < 0 或 x > 480 时，飞船碰到边界。', tex: '0 < x < 480' },
    { caption: '比较缝宽与波长', nodes: [{ id: 'a', label: 'a > 0 & λ < a' }], edges: [] },
  ] }, 'fixture');
  assert.equal(board.steps[0]?.tex, '0 < x < 480');
  assert.match(board.steps[1]!.mermaid!, /&gt;|&lt;/);
  for (const tex of ['<script>run()</script>', '\\href{https://bad.invalid}{x}', '\\htmlClass{bad}{x}']) {
    assert.throws(() => buildActivityBoard({ kind: 'board', title: 'Unsafe', steps: [{ caption: 'test', tex }] }, 'fixture'));
  }
});

test('a visual lesson can end with a learner question without inventing an irrelevant formula', () => {
  const steps = [{ caption: '两列波的位移相加', tex: 'y=y_1+y_2' }, { caption: '一个波峰与同样高的波谷相遇，你预测会怎样？' }];
  assert.equal(buildActivityBoard({ kind: 'board', title: '叠加与预测', steps }, 'fixture').steps.length, 2);
  assert.throws(() => buildActivityBoard({ kind: 'board', title: 'Text only', steps: [{ caption: 'Only static text' }] }, 'fixture'));
  assert.throws(() => buildActivityBoard({ kind: 'board', title: 'Orphan edges', steps: [{ caption: 'test', tex: 'x=1', edges: [] }] }, 'fixture'));
});
