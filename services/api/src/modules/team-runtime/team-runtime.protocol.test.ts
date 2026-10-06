import assert from 'node:assert/strict';
import test from 'node:test';
import { isExecutableTeamMessageType } from './team-runtime.service';

test('Team Runtime executes request messages but never result messages', () => {
  assert.equal(isExecutableTeamMessageType('task.request'), true);
  assert.equal(isExecutableTeamMessageType('projection.request'), true);
  assert.equal(isExecutableTeamMessageType('delegate.result'), false);
  assert.equal(isExecutableTeamMessageType('projection.result'), false);
  assert.equal(isExecutableTeamMessageType('leader.reply'), false);
});
