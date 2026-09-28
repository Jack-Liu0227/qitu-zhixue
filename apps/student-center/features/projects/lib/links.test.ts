import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProjectDeepLink, projectDetailHref, projectPracticeHref } from './links';

test('builds one canonical project deep link with task and mode', () => {
  assert.equal(
    projectDetailHref('project 1', { taskId: 'task/2', mode: 'practice' }),
    '/student/projects/project%201?task_id=task%2F2&mode=practice',
  );
});

test('parses only supported deep-link modes', () => {
  assert.deepEqual(
    parseProjectDeepLink('p-1', { task_id: ['task-1'], mode: ['learn'] }),
    { projectId: 'p-1', taskId: 'task-1', mode: 'learn' },
  );
  assert.deepEqual(
    parseProjectDeepLink('p-1', { task_id: ' ', mode: 'invalid' }),
    { projectId: 'p-1', taskId: null, mode: null },
  );
});

test('legacy helper points to the canonical container', () => {
  assert.equal(
    projectPracticeHref('p-1', 'task-1'),
    '/student/projects/p-1?task_id=task-1&mode=practice',
  );
});
