import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readLessonCollaborationEvidence, projects, projectBindingSnapshots, pblTemplateTeamBindings,
  learningPlans, learningSessions, learningSessionProgress, projectEvidence, artifacts, artifactVersions, type Database } from '@qitu/database';
import type { LessonCollaborationScope } from '@qitu/contracts';
import { teachingValueDigest } from '../templates/teaching-bundle.canonical';

function fixture() {
  const scope: LessonCollaborationScope = { projectId: 'p', studentId: 's', templateVersionId: 'v', teamVersionId: 't',
    planId: 'plan', planRevision: 2, learningSessionId: 'lesson', activityId: 'lesson:activity:reflect', recipientAssistantId: 'reviewer',
    purpose: 'critique', evidenceRefs: ['task_submission:submission'] };
  const template = { curriculum: { profiles: [{ id: 'profile', sessions: [{ sessionIndex: 1, title: 'Wave comparison', learningGoal: 'Control one variable',
    collaborators: [{ assistantId: 'reviewer', purpose: 'critique', activity: 'reflect', trigger: 'after_evidence', requiredSkillIds: ['tutor-guided-learning'] }] }] }] } };
  const text = 'I compared two slit separations while keeping wavelength and slit width fixed.';
  const receipt = { schema: 'qitu.learning-submission.v1', kind: 'session_response', scope, artifactId: 'artifact', artifactVersionId: 'version', contentDigest: createHash('sha256').update(text).digest('hex') };
  const rows = new Map<unknown, Record<string, unknown>[]>([
    [projects, [{ id: 'p', studentUserId: 's', templateVersionId: 'v' }]],
    [projectBindingSnapshots, [{ templateVersionId: 'v', teamVersionId: 't', bindingId: 'binding', bindingHash: 'hash', bundleDigest: 'bundle' }]],
    [pblTemplateTeamBindings, [{ bindingHash: 'hash', bundleDigest: 'bundle', teamVersionId: 't', templateVersionId: 'v', bundlePayload: {
      template, scheduleProfileId: 'profile', teamVersion: { leaderAssistantId: 'leader' }, roles: [{ assistantId: 'reviewer',
        instructions: { roleDefinition: 'review', agentDefinition: 'suggest' }, skills: [{ canonicalId: 'tutor-guided-learning' }] }] } }]],
    [learningPlans, [{ id: 'plan', projectId: 'p', studentUserId: 's', templateVersionId: 'v', version: 2, status: 'active' }]],
    [learningSessions, [{ id: 'lesson', lessonIndex: 1 }]], [learningSessionProgress, []],
    [projectEvidence, [{ sourceKind: 'task_submission', sourceId: 'submission', label: 'Saved response', detail: JSON.stringify(receipt) }]],
    [artifacts, [{ id: 'artifact', projectId: 'p', studentUserId: 's' }]],
    [artifactVersions, [{ artifactId: 'artifact', note: `qitu:inline-text:v1:${JSON.stringify({ text })}` }]],
  ]);
  const chain = (table: unknown) => ({ where: () => chain(table), limit: () => chain(table), orderBy: () => chain(table),
    then: (resolve: (rows: Record<string, unknown>[]) => unknown) => Promise.resolve(rows.get(table) ?? []).then(resolve) });
  const db = { select: () => ({ from: (table: unknown) => chain(table) }) } as unknown as Database;
  return { db, rows, scope, text };
}

test('worker collaboration reads only actual versioned project evidence and frozen lesson participants', async () => {
  const h = fixture();
  const result = await readLessonCollaborationEvidence(h.db, h.scope, 'reviewer');
  assert.equal(result.evidence[0]?.text, h.text);
  for (const scope of [{ ...h.scope, studentId: 'other' }, { ...h.scope, planRevision: 1 },
    { ...h.scope, activityId: 'lesson:activity:theory' }, { ...h.scope, evidenceRefs: ['task_submission:invented'] }]) {
    await assert.rejects(readLessonCollaborationEvidence(h.db, scope, 'reviewer'));
  }
  await assert.rejects(readLessonCollaborationEvidence(h.db, h.scope, 'unconfigured-member'));
  h.rows.set(learningSessionProgress, [{ learningSessionId: 'lesson' }]);
  await assert.rejects(readLessonCollaborationEvidence(h.db, h.scope, 'reviewer'));
});

test('modified artifact text is not silently substituted for the cited version', async () => {
  const h = fixture(); h.rows.set(artifactVersions, [{ artifactId: 'artifact', note: 'qitu:inline-text:v1:{"text":"changed"}' }]);
  await assert.rejects(readLessonCollaborationEvidence(h.db, h.scope, 'reviewer'));
});

test('worker resolves the current lesson team under the original project binding and rejects altered team content', async () => {
  const h = fixture();
  const binding = h.rows.get(pblTemplateTeamBindings)![0]!;
  const root = binding.bundlePayload as Record<string, unknown>;
  const other = structuredClone(root);
  Object.assign(other, { templateVersionId: 'v', templateDigest: 'frozen-template', teamVersion: { teamVersionId: 't2', leaderAssistantId: 'lesson-leader' } });
  Object.assign(root, { templateVersionId: 'v', templateDigest: 'frozen-template', teamVersion: { teamVersionId: 't', leaderAssistantId: 'default-leader' }, roles: [],
    sessionAssignments: [{ sessionIndex: 1, teamVersionId: 't2', kind: 'team' }], sessionTeamBundles: [other] });
  binding.bundleDigest = teachingValueDigest(root);
  h.rows.get(projectBindingSnapshots)![0]!.bundleDigest = binding.bundleDigest;
  const result = await readLessonCollaborationEvidence(h.db, h.scope, 'reviewer');
  assert.equal(result.leaderAssistantId, 'lesson-leader');
  assert.equal(result.role.assistantId, 'reviewer');
  assert.equal(h.scope.teamVersionId, 't');
  other.teamVersion = { teamVersionId: 't2', leaderAssistantId: 'unfrozen-leader' };
  await assert.rejects(readLessonCollaborationEvidence(h.db, h.scope, 'reviewer'));
});
