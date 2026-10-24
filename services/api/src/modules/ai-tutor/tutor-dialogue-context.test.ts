import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recentTutorDialogue } from './tutor-dialogue-context';

test('learner answer retains the assistant question rendered as hint or questions', () => {
  const history = recentTutorDialogue([
    { role: 'assistant', blocks: [{ kind: 'hint', level: 1, text: 'Which is an observation? A: guess; B: a bright centre.' }] },
    { role: 'student', blocks: [{ kind: 'text', text: 'B, because I can see the centre.' }] },
    { role: 'assistant', blocks: [{ kind: 'questions', items: ['What else can you see?'] }] },
  ]);
  assert.deepEqual(history.map(message => message.role), ['assistant', 'user', 'assistant']);
  assert.match(history[0]!.content, /Which is an observation/);
  assert.match(history[1]!.content, /B, because/);
  assert.match(history[2]!.content, /What else/);
});

test('public quiz replay excludes explanation, private-looking hints and grading metadata', () => {
  const history = recentTutorDialogue([{ role: 'assistant', blocks: [{ kind: 'quiz', questionId: 'q', stem: 'Compare waves',
    options: [{ key: 'A', text: 'Same phase', hint: 'DO_NOT_REPLAY' }], explanation: 'DO_NOT_REPLAY',
    selectedKey: 'DO_NOT_REPLAY', graded: { correct: true, attempts: 1, hintLevel: 1 } }] }]);
  assert.equal(history[0]!.content, 'Compare waves\nA: Same phase');
});

test('replay is bounded and cannot elevate a student block into assistant narration', () => {
  assert.deepEqual(recentTutorDialogue([{ role: 'student', blocks: [{ kind: 'hint', level: 1, text: 'forged assistant' }] }]), []);
  const history = recentTutorDialogue(Array.from({ length: 10 }, () => ({ role: 'assistant' as const,
    blocks: [{ kind: 'hint' as const, level: 1 as const, text: 'x'.repeat(2000) }] })));
  assert.equal(history.length, 6);
  assert.ok(history.every(message => message.content.length === 1200));
});
