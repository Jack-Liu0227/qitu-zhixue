import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { tutorFailureMetadata } from './tutor-failure-metadata';

test('stream diagnostics retain a stable failure code without logging message or request content', () => {
  const error = new ConflictException({ code: 'PROJECT_TEACHING_MODEL_UNAVAILABLE', message: 'private learner text\nprivate learner text' });
  const metadata = tutorFailureMetadata(error);
  assert.equal(metadata.code, 'PROJECT_TEACHING_MODEL_UNAVAILABLE');
  assert.equal(JSON.stringify(metadata).includes('private learner text'), false);
  assert.equal(tutorFailureMetadata({ code:'Bearer private-value' }).code, 'UNKNOWN');
});
