import 'reflect-metadata';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { OPTICS_16_SESSION_TEMPLATE_SPEC } from '@qitu/ai-client/quiz-bank';
import { TeamRuntimeService } from './team-runtime.service';

it('routes from the actual profile and rejects invalid indices and non-member roles', () => {
  const profile = OPTICS_16_SESSION_TEMPLATE_SPEC.curriculum?.profiles[0];
  assert.ok(profile);
  const context = { profile, roleMap: { exploration: 'lead', concept_mastery: 'concept', guided_practice: 'lab', deliverable_review: 'review' }, memberAssistantIds: ['lead', 'concept', 'lab', 'review'] };
  const resolve = (index: number) => TeamRuntimeService.prototype.resolveSessionAgent(index, context);
  assert.equal(resolve(8).agentId, 'concept');
  assert.equal(resolve(8).gateCondition, 'TheoryMastered');
  for (const index of [0, -1, 1.5, 17, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => resolve(index));
  assert.throws(() => TeamRuntimeService.prototype.resolveSessionAgent(8, { ...context, memberAssistantIds: ['lead'] }));
  const first = profile.sessions[0];
  assert.ok(first);
  assert.equal(TeamRuntimeService.prototype.resolveSessionAgent(1, { ...context, profile: { ...profile, sessions: [{ ...first, phase: 'deliverable_review' }] } }).agentId, 'review');
  for (const index of [8, 14, 16]) {
    const route = resolve(index);
    for (const key of ['mastered', 'practiceUnlocked', 'artifactApproved', 'archived']) assert.equal(key in route, false);
  }
});
