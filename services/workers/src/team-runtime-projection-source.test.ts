import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkerInput, type TeamEventPayload } from './team-runtime-projection-source';

test('projection worker input keeps opaque refs and bounded metadata, not learner content', () => {
  const event: TeamEventPayload = {
    eventId: 'event-1',
    topic: 'artifact.published',
    payload: {
      studentUserId: 'student-1',
      projectId: 'project-1',
      evidenceRefs: ['artifact:work-1', 'raw_conversation:turn-1'],
      stage: 'artifact_review',
      assistantSeq: 4,
      transcript: 'private transcript',
      rawConversation: 'private conversation',
      prompt: 'internal prompt',
    },
  };
  const input = buildWorkerInput(event, 'student-1', 'project-1');
  assert.deepEqual(input.evidenceRefs, ['artifact:work-1']);
  assert.deepEqual(input.sourceMetadata, { stage: 'artifact_review', assistantSeq: 4 });
  assert.equal('transcript' in input, false);
  assert.equal('rawConversation' in input, false);
  assert.equal('prompt' in input, false);
});

test('projection worker has no usable evidence when events only identify raw tutor turns', () => {
  const input = buildWorkerInput({
    eventId: 'event-2',
    topic: 'tutor.turn.completed',
    payload: { evidenceRef: 'tutor_turn:session-1:4', transcript: 'private text' },
  }, 'student-1', null);
  assert.deepEqual(input.evidenceRefs, []);
  assert.deepEqual(input.sourceMetadata, {});
});
