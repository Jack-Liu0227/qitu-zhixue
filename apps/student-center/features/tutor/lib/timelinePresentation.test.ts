import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TutorTurn } from '@qitu/contracts';
import { firstExperimentTurns, learningActivityTurnId, retainCoursewareSelection } from './timelinePresentation.js';

const message = (turnId: string, role: TutorTurn['role'], blocks: TutorTurn['blocks'] = [{ kind: 'text', text: turnId }]): TutorTurn => ({
  turnId, role, blocks, seq: 1, createdAt: '2026-10-25T00:00:00.000Z',
  modality: 'text', hintLevel: null, stageBefore: null, stageAfter: null,
});

test('lesson controls follow the latest completed assistant reply, never a student message', () => {
  const turns = [message('opening', 'assistant'), message('question', 'student'), message('explanation', 'assistant')];
  assert.equal(learningActivityTurnId(turns, null), 'explanation');
  assert.equal(learningActivityTurnId([...turns, message('follow-up', 'student')], null), 'explanation');
  assert.equal(learningActivityTurnId([], null), null);
  assert.equal(learningActivityTurnId([message('question', 'student')], null), null);
});

test('streaming leaves the existing lesson controls beside the previous reply until the answer completes', () => {
  const turns = [message('opening', 'assistant'), message('question', 'student'), message('answer', 'assistant')];
  assert.equal(learningActivityTurnId(turns, 'answer'), 'opening');
  assert.equal(learningActivityTurnId(turns, null), 'answer');
  assert.equal(learningActivityTurnId([message('opening', 'assistant')], 'opening'), null);
  assert.equal(learningActivityTurnId([...turns, message('pending', 'assistant', [])], null), 'answer');
});

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
