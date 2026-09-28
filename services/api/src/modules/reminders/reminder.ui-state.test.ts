import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReminderFetch, deriveReminderInboxState } from './reminder.ui-state';

/**
 * 五态投影验证（loading / empty / error / offline / permission-denied）。
 *
 * 覆盖 AGENTS.md 要求的五个页面状态，确保四个平台共用同一份判定。
 */

test('六种投影：loading / empty / ready / error / offline / permission-denied', () => {
  assert.equal(deriveReminderInboxState({ status: 'loading', reminderCount: 0 }), 'loading');
  assert.equal(deriveReminderInboxState({ status: 'ready', reminderCount: 0 }), 'empty');
  assert.equal(deriveReminderInboxState({ status: 'ready', reminderCount: 2 }), 'ready');
  assert.equal(deriveReminderInboxState({ status: 'error', reminderCount: 0 }), 'error');
  assert.equal(deriveReminderInboxState({ status: 'offline', reminderCount: 0 }), 'offline');
  assert.equal(deriveReminderInboxState({ status: 'denied', reminderCount: 0 }), 'permission-denied');
});

test('HTTP / 网络状态翻译：401 403 → denied，0 → offline，其它 → error', () => {
  assert.equal(classifyReminderFetch(401), 'denied');
  assert.equal(classifyReminderFetch(403), 'denied');
  assert.equal(classifyReminderFetch(0), 'offline');
  assert.equal(classifyReminderFetch(500), 'error');
  assert.equal(classifyReminderFetch(409), 'error');
  assert.equal(classifyReminderFetch(200), 'ready');
  assert.equal(classifyReminderFetch(204), 'ready');
});
