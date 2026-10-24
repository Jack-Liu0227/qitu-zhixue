import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLearningActivity } from './learning-activity';

const date = (value: string) => new Date(value);
test('a long-lived tutor thread produces separate visits, with bounded time estimates', () => {
  const activity = summarizeLearningActivity([
    date('2026-10-23T01:00:00Z'), date('2026-10-23T01:04:00Z'),
    date('2026-10-23T01:20:00Z'), date('2026-10-23T03:00:00Z'),
    date('2026-10-23T01:04:00Z'),
  ], [], date('2026-10-23T08:00:00Z'));
  assert.equal(activity.sessionsThisWeek, 2);
  assert.equal(activity.minutesThisWeek, 9);
  assert.equal(activity.activeDays, 1);
});
test('Shanghai Monday and midnight boundaries keep previous and current week separate', () => {
  const activity = summarizeLearningActivity([
    date('2026-10-18T15:59:00Z'), date('2026-10-18T16:01:00Z'),
    date('2026-10-19T15:59:00Z'), date('2026-10-19T16:01:00Z'),
    date('2026-10-26T00:00:00Z'),
  ], [date('2026-10-19T16:01:00Z')], date('2026-10-23T08:00:00Z'));
  assert.equal(activity.weekStart, '2026-10-18T16:00:00.000Z');
  assert.equal(activity.sessionsLastWeek, 1);
  assert.equal(activity.sessionsThisWeek, 3);
  assert.equal(activity.minutesThisWeek, 0);
  assert.equal(activity.completedSessionsThisWeek, 1);
  assert.equal(activity.lastActivityAt, '2026-10-19T16:01:00.000Z');
});
test('no evidence, singleton events and invalid dates never invent duration', () => {
  const now = date('2026-10-23T08:00:00Z');
  assert.equal(summarizeLearningActivity([], [], now).lastActivityAt, null);
  assert.equal(summarizeLearningActivity([date('invalid'), now], [], now).minutesThisWeek, 0);
  assert.equal(summarizeLearningActivity([now], [], now).sessionsThisWeek, 1);
});
