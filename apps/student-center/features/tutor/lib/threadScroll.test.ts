import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextThreadScroll, type ThreadScrollState } from './threadScroll.js';

const fresh = (): ThreadScrollState => ({ sessionId: null, following: true });
const assistant = (turnId: string) => ({ turnId, role: 'assistant' as const });
const update = (turn = assistant('opening')) => ({ sessionId: 'project', ready: true, openingOnly: false, turn });

test('a project opening reveals its actual message rather than trailing records or learning controls', () => {
  const result = nextThreadScroll(fresh(), update());
  assert.deepEqual(result.target, { kind: 'turn', turnId: 'opening' });
  assert.deepEqual(nextThreadScroll(fresh(), { ...update(), openingOnly: true }).target, { kind: 'opening' });
});

test('streaming and subsequent courseware/progress refreshes keep the reading position', () => {
  const first = nextThreadScroll(fresh(), update()).state;
  assert.equal(nextThreadScroll(first, update()).target, null);
  assert.equal(nextThreadScroll({ ...first, following: false }, update()).target, null);
  assert.equal(nextThreadScroll(first, { ...update(), ready: false }).target, null);
});

test('a new reply does not pull a learner away from older messages', () => {
  const readingHistory = { ...nextThreadScroll(fresh(), update()).state, following: false };
  const incoming = nextThreadScroll(readingHistory, update(assistant('reply-2')));
  assert.equal(incoming.target, null);
  assert.equal(nextThreadScroll(incoming.state, update(assistant('reply-2'))).target, null);
});

test('an explicit new submission resumes following and reveals the next reply once', () => {
  const readingHistory = { ...nextThreadScroll(fresh(), update()).state, following: false };
  const sent = nextThreadScroll(readingHistory, { ...update(), turn: { turnId: 'answer', role: 'student' } });
  assert.deepEqual(sent.target, { kind: 'turn', turnId: 'answer' });
  const reply = nextThreadScroll(sent.state, update(assistant('reply')));
  assert.deepEqual(reply.target, { kind: 'turn', turnId: 'reply' });
  assert.equal(nextThreadScroll(reply.state, update(assistant('reply'))).target, null);
});

test('loading another session waits for its own messages and resets the history-reading preference', () => {
  const readingHistory = { ...nextThreadScroll(fresh(), update()).state, following: false };
  const pending = nextThreadScroll(readingHistory, { ...update(), sessionId: 'other', ready: false });
  assert.equal(pending.target, null);
  assert.equal(pending.state.turnId, undefined);
  assert.deepEqual(nextThreadScroll(pending.state, { ...update(assistant('other-opening')), sessionId: 'other' }).target,
    { kind: 'turn', turnId: 'other-opening' });
});
