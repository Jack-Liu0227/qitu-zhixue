import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TeacherArtifactReviewItem } from '@qitu/contracts';
import { reviewVersion } from './review-version';

const review: TeacherArtifactReviewItem = { reviewId: 'review-fixture', artifactId: 'artifact-fixture', projectId: 'project-fixture',
  status: 'requested', artifactTitle: 'Fixture report', artifactVersionId: 'submitted-version', artifactVersionOrdinal: 1,
  versionAvailable: true, requestedAt: '2026-10-21T00:00:00.000Z' };
const original = { id: 'submitted-version', ordinal: 1, title: 'Fixture', inlineText: 'Synthetic submitted report.' };
const latest = { id: 'later-version', ordinal: 2, title: 'Fixture', inlineText: 'Synthetic later draft.' };

test('teacher reads the immutable submitted version even when a newer draft exists', () => {
  assert.equal(reviewVersion(review, [latest, original]), original);
  assert.throws(() => reviewVersion(review, [latest]));
});
test('missing binding, different ordinal and absent body cannot become a readable review', () => {
  assert.throws(() => reviewVersion({ ...review, versionAvailable: false }, [original]));
  assert.throws(() => reviewVersion({ ...review, artifactVersionOrdinal: 2 }, [original]));
  assert.throws(() => reviewVersion(review, [{ ...original, inlineText: null }]));
});
