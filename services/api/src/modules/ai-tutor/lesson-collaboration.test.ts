import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertDomainLeader } from '../../common/intake-boundary';
import { startTutorTeamRun } from './tutor-team-run';
import { coordinateLessonCollaboration } from './tutor-lesson-collaboration';
import { teachingContextFixture } from './tutor-teaching-context.test-fixture';
import { resolveTutorTeachingContext } from './tutor-teaching-context';
import type { TeamRuntimeService } from '../team-runtime/team-runtime.service';
import type { PlatformRegistryService, EffectiveAgentRuntime } from '../platform-registry/platform-registry.service';
import type { TeamRunGraph } from '../team-runtime/team-runtime.service';

test('intake cannot lead teams; exploration never starts a Team Run, formal teaching uses its domain leader', async () => {
  assert.throws(() => assertDomainLeader('qitu-intake-assistant'));
  let calls = 0;
  const runtime = { startRun: async (_actor: unknown, input: { leaderAgentId: string }) => {
    calls++; return { id: 'run', leaderAgentId: input.leaderAgentId };
  } } as Pick<TeamRuntimeService, 'startRun'>;
  const input = { runtime, studentId: 'owner', tutorSessionId: 'chat', leaderAgentId: 'qitu-intake-assistant',
    turnCount: 1, pedagogicMove: null, key: 'turn', onFailure: () => { throw Error('unexpected'); } };
  assert.equal((await startTutorTeamRun({ ...input, projectId: null })).id, null);
  assert.equal((await startTutorTeamRun({ ...input, projectId: 'project' })).id, null);
  assert.equal(calls, 0);
  assert.equal((await startTutorTeamRun({ ...input, projectId: 'project', leaderAgentId: 'optics-leader' })).id, 'run');
  assert.equal(calls, 1);
});

async function fixture() {
  const f = teachingContextFixture();
  const lesson = f.teaching.template.curriculum!.profiles[0]!.sessions[0]!;
  lesson.collaborators = [{ assistantId: 'reviewer', activity: 'reflect', trigger: 'after_evidence', purpose: 'critique', requiredSkillIds: ['tutor-guided-learning'] }];
  const pin = { canonicalId: 'tutor-guided-learning', version: '1', packageDigest: 'digest' };
  const role = { ...f.teaching.roles[0]!, assistantId: 'reviewer', roleSlotId: 'review', memberId: 'member-review', skills: [pin] };
  f.teaching.roles = [...f.teaching.roles, role];
  const teaching = await resolveTutorTeachingContext(f.store, f.project, f.teaching);
  teaching.lesson.currentActivity = { activityId: `${teaching.session.id}:activity:reflect`, kind: 'reflect', guidance: 'reflect', minutes: 5,
    status: 'current', evidence: 'session_response', evidenceRefs: [] };
  teaching.lesson.evidenceRefs = ['task_submission:saved'];
  const tasks: Record<string, unknown>[] = [];
  const runtime = { listLessonCollaborationTasksForProject: async () => tasks, delegateLessonCollaboration: async (_actor: unknown, _run: string, input: Record<string, unknown>) => {
    tasks.push({ id: 'task', agentId: 'reviewer', taskType: 'lesson.collaborate', input: input.input, status: 'queued' } as TeamRunGraph['tasks'][number]);
  } } as unknown as Pick<TeamRuntimeService, 'delegateLessonCollaboration' | 'listLessonCollaborationTasksForProject'>;
  const live = { agent: { id: 'reviewer', enabled: true, capabilities: ['teach'], skillIds: [pin.canonicalId], label: '评议导师' },
    skills: [{ id: pin.canonicalId, version: pin.version, contentHash: pin.packageDigest, status: 'ready', publicationStatus: 'published' }],
    tools: [], mcpServers: [] } as unknown as EffectiveAgentRuntime;
  const registry = { getAssistantRuntime: async () => live, isModelAvailable: () => true } as Pick<PlatformRegistryService, 'getAssistantRuntime' | 'isModelAvailable'>;
  return { tasks, teaching, live, input: { runtime, registry, teaching, runId: 'run', studentId: f.project.studentId, projectId: f.project.id,
    requested: false, assessmentPending: false, resolve: async () => teaching, hasResult: () => false } };
}

test('collaboration queues scoped evidence once, accepts only matching current results and never marks a lesson complete', async () => {
  const h = await fixture();
  assert.deepEqual(await coordinateLessonCollaboration(h.input), []);
  assert.equal(h.tasks.length, 1);
  await coordinateLessonCollaboration(h.input); assert.equal(h.tasks.length, 1);
  await coordinateLessonCollaboration({ ...h.input, runId: 'a-later-run' }); assert.equal(h.tasks.length, 1);
  const task = h.tasks[0]!; task.status = 'succeeded'; task.output = { suggestion: '为结论补充一组对照。', question: '哪一个变量保持不变？' };
  const blocks = await coordinateLessonCollaboration(h.input);
  assert.equal(blocks[0]?.kind, 'aside'); assert.equal(h.teaching.lesson.status, 'current');
  assert.deepEqual(await coordinateLessonCollaboration({ ...h.input, hasResult: () => true }), []);
  assert.deepEqual(await coordinateLessonCollaboration({ ...h.input, assessmentPending: true }), []);
  (task.input as Record<string, unknown>).scope = { altered: true };
  assert.deepEqual(await coordinateLessonCollaboration(h.input), []);
  h.live.agent.enabled = false;
  await assert.rejects(coordinateLessonCollaboration(h.input));
});
