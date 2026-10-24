import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parentAcceptedProfile, ParentAcceptedProfileService, type ParentProfileCandidate } from './accepted-profile.service';
import type { DirectoryService } from '../directory/directory.service';
import type { AuditWriter } from '../../common/audit';
import type { CurrentUser } from '@qitu/contracts';

const candidate: ParentProfileCandidate = {
  studentUserId: 'child-1', status: 'accepted', projectionType: 'growth_trajectory', agentId: 'growth-analyst',
  reviewedBy: 'owner', reviewedAt: new Date('2026-10-21T00:00:00Z'),
  payload: { result: { version: 1, milestones: ['private milestone'], strengths: ['private strength'],
    nextQuestions: ['private question'], studentSummary: 'private summary', evidenceRefs: ['help_request:opaque'], confidence: 'medium' } },
};

test('parent projection exposes only reviewed aggregates and approved fixed wording', () => {
  const result = parentAcceptedProfile('child-1', candidate);
  assert.equal(result.freshness, 'fresh');
  assert.equal(result.milestonesRecorded, 1);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('help_request'), false);
  assert.deepEqual(Object.keys(result).sort(), ['childId', 'conversationPrompt', 'freshness', 'milestonesRecorded', 'updatedAt', 'version']);
});

test('pending, rejected, superseded, unreviewed and cross-student projections are excluded', () => {
  for (const patch of [
    { status: 'proposed' }, { status: 'rejected' }, { status: 'superseded' }, { reviewedAt: null },
    { reviewedBy: null }, { studentUserId: 'other' }, { payload: { result: { rawText: 'secret' } } },
  ]) assert.equal(parentAcceptedProfile('child-1', { ...candidate, ...patch }).freshness, 'unavailable');
});

test('reviewed history uses the actual canonical producer instead of a legacy alias', () => {
  assert.equal(parentAcceptedProfile('child-1', { ...candidate, agentId: 'qitu-growth-analyst' }).freshness, 'fresh');
});

test('parent permission is checked on every read before accessing storage and denials are audited', async () => {
  const logs: unknown[] = [];
  const service = new ParentAcceptedProfileService(
    { childrenOfParent: async () => [{ userId: 'child-1' }] } as unknown as DirectoryService,
    { write: async (entry: unknown) => { logs.push(entry); return 'audit'; } } as AuditWriter,
    null,
  );
  const actor = { id: 'parent-1', role: 'parent' } as CurrentUser;
  await assert.rejects(service.read(actor, 'other'), (error: unknown) => (error as { getStatus(): number }).getStatus() === 403);
  assert.equal(logs.length, 1);
  await assert.rejects(service.read(actor, 'child-1'), (error: unknown) => (error as { getStatus(): number }).getStatus() === 503);
});
