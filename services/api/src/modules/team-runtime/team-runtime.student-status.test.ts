import assert from 'node:assert/strict';
import { test } from 'node:test';
import { studentAgentStatus } from './team-runtime.service';

test('已有 run 未给该导师分配任务时保持 ready，不伪造执行或离线', () => {
  for (const runStatus of ['queued', 'running', 'completed', 'failed', 'cancelled']) {
    assert.equal(studentAgentStatus(runStatus, [], 0, false), 'ready');
  }
  assert.equal(studentAgentStatus('running', [], 0, true), 'running');
  assert.equal(studentAgentStatus('running', [], 1, false), 'waiting');
});

test('实际失败、执行、排队与完成的任务状态继续由运行记录决定', () => {
  for (const [taskStatus, expected] of [['failed', 'failed'], ['running', 'running'], ['queued', 'waiting'], ['succeeded', 'ready']] as const) {
    const tasks = [{ status: taskStatus }];
    assert.equal(studentAgentStatus('running', tasks, 0, false), expected);
  }
});
