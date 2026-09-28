import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ARTIFACT_STATUSES,
  ArtifactTransitionError,
  assertArtifactEditable,
  isArtifactEditable,
  isArtifactStatus,
  publishFromReview,
  submitForReview,
  withdrawArtifact,
} from './artifact-state-machine';

describe('artifact-state-machine（作品状态机）', () => {
  it('状态集合与服务端 schema 一致', () => {
    assert.deepEqual([...ARTIFACT_STATUSES], [
      'draft',
      'submitted',
      'in_review',
      'published',
      'changes_requested',
      'archived',
    ]);
    assert.equal(isArtifactStatus('published'), true);
    assert.equal(isArtifactStatus('approved'), false);
  });

  it('仅 draft / changes_requested 可编辑', () => {
    assert.equal(isArtifactEditable('draft'), true);
    assert.equal(isArtifactEditable('changes_requested'), true);
    for (const status of ['submitted', 'in_review', 'published', 'archived'] as const) {
      assert.equal(isArtifactEditable(status), false);
      assert.throws(
        () => assertArtifactEditable(status),
        (error: unknown) =>
          error instanceof ArtifactTransitionError && error.code === 'ARTIFACT_NOT_EDITABLE',
      );
    }
  });

  it('提交审核：draft / changes_requested / archived → submitted', () => {
    assert.equal(submitForReview('draft'), 'submitted');
    assert.equal(submitForReview('changes_requested'), 'submitted');
    assert.equal(submitForReview('archived'), 'submitted');
    assert.equal(submitForReview('submitted'), 'submitted');
  });

  it('已发布不能再次提交', () => {
    assert.throws(
      () => submitForReview('published'),
      (error: unknown) =>
        error instanceof ArtifactTransitionError && error.code === 'ARTIFACT_TRANSITION_INVALID',
    );
  });

  it('批准后发布：不能从 archived 直接发布', () => {
    assert.equal(publishFromReview('submitted'), 'published');
    assert.equal(publishFromReview('in_review'), 'published');
    assert.equal(publishFromReview('draft'), 'published');
    assert.throws(
      () => publishFromReview('archived'),
      (error: unknown) =>
        error instanceof ArtifactTransitionError && error.code === 'ARTIFACT_TRANSITION_INVALID',
    );
  });

  it('撤回可逆：任意状态进 archived，archived 幂等', () => {
    assert.equal(withdrawArtifact('published'), 'archived');
    assert.equal(withdrawArtifact('draft'), 'archived');
    assert.equal(withdrawArtifact('archived'), 'archived');
  });
});
