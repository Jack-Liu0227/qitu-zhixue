import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TutorTurn } from '@qitu/contracts';
import { firstExperimentTurns, retainCoursewareSelection } from './timelinePresentation.js';

test('refresh preserves an older selected courseware; newly delivered material follows the current last item', () => {
  assert.equal(retainCoursewareSelection('first', ['first', 'second'], ['first', 'second']), 'first');
  assert.equal(retainCoursewareSelection('first', ['first', 'second'], ['first', 'second', 'third']), 'first');
  assert.equal(retainCoursewareSelection('second', ['first', 'second'], ['first', 'second', 'third']), 'third');
  assert.equal(retainCoursewareSelection('removed', ['removed'], ['new']), 'new');
});

test('repeated references share an experiment anchor; distinct lesson experiments remain separate', () => {
  const turns = [
    { turnId: 'one', blocks: [{ kind: 'optics_experiment', experimentId: 'lesson3' }] },
    { turnId: 'two', blocks: [{ kind: 'optics_experiment', experimentId: 'lesson3' }] },
    { turnId: 'three', blocks: [{ kind: 'optics_experiment', experimentId: 'lesson4' }] },
  ] as unknown as TutorTurn[];
  assert.deepEqual([...firstExperimentTurns(turns)], [['lesson3', 'one'], ['lesson4', 'three']]);
});
