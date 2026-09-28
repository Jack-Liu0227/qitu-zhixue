import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CurrentUser } from '@qitu/contracts';
import { canReadArtifact, canWriteArtifact, type ArtifactRef } from './works.access';

const STUDENT: CurrentUser = { id: 's1', email: 's@e.com', displayName: 'S', role: 'student' };
const TEACHER: CurrentUser = { id: 't1', email: 't@e.com', displayName: 'T', role: 'teacher' };
const PARENT: CurrentUser = { id: 'p1', email: 'p@e.com', displayName: 'P', role: 'parent' };
const ADMIN: CurrentUser = { id: 'a1', email: 'a@e.com', displayName: 'A', role: 'admin' };

const OWNER = { isOwner: true, isMentor: false, isGuardian: false };
const MENTOR = { isOwner: false, isMentor: true, isGuardian: false };
const GUARDIAN = { isOwner: false, isMentor: false, isGuardian: true };
const STRANGER = { isOwner: false, isMentor: false, isGuardian: false };

const draft: ArtifactRef = { studentId: 's1', status: 'draft', visibility: 'class' };
const published: ArtifactRef = { studentId: 's1', status: 'published', visibility: 'class' };
const privatePublished: ArtifactRef = {
  studentId: 's1',
  status: 'published',
  visibility: 'student_private',
};

describe('works.access — 读授权矩阵', () => {
  it('学生本人可读任意状态', () => {
    for (const status of ['draft', 'submitted', 'in_review', 'published', 'archived'] as const) {
      assert.equal(canReadArtifact(STUDENT, { ...draft, status }, OWNER), true);
    }
  });

  it('非本人学生不可读', () => {
    assert.equal(canReadArtifact(STUDENT, draft, STRANGER), false);
  });

  it('班主任仅可读在带学生的已发布作品', () => {
    assert.equal(canReadArtifact(TEACHER, draft, MENTOR), false);
    assert.equal(canReadArtifact(TEACHER, published, MENTOR), true);
    assert.equal(canReadArtifact(TEACHER, published, STRANGER), false);
  });

  it('家长仅可读已发布且非 student_private', () => {
    assert.equal(canReadArtifact(PARENT, published, GUARDIAN), true);
    assert.equal(canReadArtifact(PARENT, privatePublished, GUARDIAN), false);
    assert.equal(canReadArtifact(PARENT, draft, GUARDIAN), false);
    assert.equal(canReadArtifact(PARENT, published, STRANGER), false);
  });

  it('其它角色 fail closed', () => {
    assert.equal(canReadArtifact(ADMIN, published, STRANGER), false);
    assert.equal(canReadArtifact(ADMIN, published, OWNER), false);
  });
});

describe('works.access — 写授权矩阵', () => {
  it('仅本人在可编辑状态可写', () => {
    assert.equal(canWriteArtifact(STUDENT, draft, OWNER), true);
    assert.equal(canWriteArtifact(STUDENT, published, OWNER), false);
    assert.equal(canWriteArtifact(STUDENT, draft, STRANGER), false);
  });

  it('班主任 / 家长 / 管理员均不可写', () => {
    assert.equal(canWriteArtifact(TEACHER, draft, MENTOR), false);
    assert.equal(canWriteArtifact(PARENT, published, GUARDIAN), false);
    assert.equal(canWriteArtifact(ADMIN, draft, OWNER), false);
  });
});
