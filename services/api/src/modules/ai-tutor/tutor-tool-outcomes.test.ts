import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tutorToolEvent } from './tutor-tool-events';

test('tool timeline distinguishes empty retrieval, accepted activity and denied access', () => {
  const base = { type: 'result' as const, callId: 'synthetic', name: 'knowledge_search', isError: false };
  const empty = tutorToolEvent({ ...base, outcome: 'empty' });
  assert.equal(empty.type === 'tool_result' && empty.status, 'done');
  assert.match(empty.type === 'tool_result' ? empty.result : '', /未找到/);
  assert.doesNotMatch(empty.type === 'tool_result' ? empty.result : '', /已取得|已保存/);
  const denied = tutorToolEvent({ ...base, isError: true, errorCode: 'KNOWLEDGE_RETRIEVAL_DISABLED' });
  assert.equal(denied.type === 'tool_result' && denied.status, 'error');
  assert.match(denied.type === 'tool_result' ? denied.result : '', /已停用/);
  const accepted = tutorToolEvent({ ...base, name: 'tutor_propose_lesson_activity', outcome: 'accepted' });
  assert.match(accepted.type === 'tool_result' ? accepted.result : '', /已保存/);
  const unavailable = tutorToolEvent({ ...base, name: 'tutor.propose_lesson_activity', isError: true, errorCode: 'TOOL_NOT_ALLOWED' });
  assert.equal(unavailable.type === 'tool_result' && unavailable.status, 'error');
  assert.match(unavailable.type === 'tool_result' ? unavailable.result : '', /当前步骤未提供/);
  assert.doesNotMatch(unavailable.type === 'tool_result' ? unavailable.result : '', /可以重试|已保存/);
});
